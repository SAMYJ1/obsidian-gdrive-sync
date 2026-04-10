export interface GenerationRename {
  from: string;
  to: string;
}

export interface PlanVaultSnapshotPublishInput {
  previousGenerationId?: string | null;
  nextGenerationId: string;
  previousFiles?: string[];
  changedFiles?: string[];
  deletedFiles?: string[];
  renamedFiles?: GenerationRename[];
}

export interface VaultSnapshotPlan {
  previousGenerationId: string | null;
  nextGenerationId: string;
  copyPaths: string[];
  writePaths: string[];
  deletePaths: string[];
}

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths));
}

export function planVaultSnapshotPublish(input: PlanVaultSnapshotPublishInput): VaultSnapshotPlan {
  const previousFiles = input.previousFiles ?? [];
  const changedFiles = uniquePaths(input.changedFiles ?? []);
  const deletedFiles = uniquePaths(input.deletedFiles ?? []);
  const renamedFiles = input.renamedFiles ?? [];
  const renamedSources = renamedFiles.map((rename) => rename.from);
  const renamedTargets = renamedFiles.map((rename) => rename.to);

  const copyPaths = previousFiles.filter((filePath) =>
    !changedFiles.includes(filePath) &&
    !deletedFiles.includes(filePath) &&
    !renamedSources.includes(filePath)
  );

  return {
    previousGenerationId: input.previousGenerationId ?? null,
    nextGenerationId: input.nextGenerationId,
    copyPaths: uniquePaths(copyPaths),
    writePaths: uniquePaths(changedFiles.concat(renamedTargets)),
    deletePaths: deletedFiles
  };
}

// Alias for backward compatibility with lib/snapshot-plan.js API
export const planGenerationBuild = planVaultSnapshotPublish;

export function planGenerationGarbageCollection(options: {
  generationIds: string[];
  retentionCount?: number;
}): { keep: string[]; remove: string[] } {
  const generationIds = options.generationIds || [];
  const retentionCount = Math.max(1, options.retentionCount || 1);
  const keep = generationIds.slice(Math.max(0, generationIds.length - retentionCount));
  const remove = generationIds.slice(0, Math.max(0, generationIds.length - retentionCount));
  return { keep, remove };
}

export async function applyDownloadedSnapshot(
  vaultAdapter: { applySnapshot?(files: Array<{ path: string; content: string }>): Promise<void> },
  files: Array<{ path: string; content: string }>
): Promise<void> {
  if (vaultAdapter && typeof vaultAdapter.applySnapshot === "function") {
    await vaultAdapter.applySnapshot(files || []);
  }
}

export class GenerationPublisher {
  private readonly driveClient: any;
  private readonly generationRetentionCount: number;

  constructor(options: { driveClient: any; generationRetentionCount?: number }) {
    this.driveClient = options.driveClient;
    this.generationRetentionCount = options.generationRetentionCount || 3;
  }

  async publish(input: any): Promise<any> {
    const generationRoot = "snapshots/generations/" + input.nextGenerationId;
    const buildPlan = planGenerationBuild({
      previousGenerationId: input.previousGenerationId,
      nextGenerationId: input.nextGenerationId,
      previousFiles: input.previousFiles,
      changedFiles: (input.changedFiles || []).map((entry: any) => entry.path),
      deletedFiles: input.deletedFiles,
      renamedFiles: input.renamedFiles
    });

    await this.driveClient.ensureFolder(generationRoot);
    await this.driveClient.ensureFolder(generationRoot + "/vault");

    for (const copyPath of buildPlan.copyPaths) {
      const previousPath = this.mapGenerationPath(input.previousGenerationId, copyPath);
      const nextPath = this.mapGenerationPath(input.nextGenerationId, copyPath);
      await this.driveClient.copyFile(previousPath, nextPath);
    }

    for (const changedFile of input.changedFiles || []) {
      const destinationPath = this.mapGenerationPath(input.nextGenerationId, changedFile.path);
      await this.driveClient.writeFile(destinationPath, changedFile.content);
    }

    for (const renamedFile of input.renamedFiles || []) {
      const destinationPath = this.mapGenerationPath(input.nextGenerationId, renamedFile.to);
      const sourceContent = renamedFile.content != null ? renamedFile.content : "";
      await this.driveClient.writeFile(destinationPath, sourceContent);
    }

    await this.driveClient.writeJson(generationRoot + "/_meta.json", {
      generationId: input.nextGenerationId,
      snapshotSeqs: input.snapshotSeqs || {}
    });

    await this.driveClient.writeJson("snapshots/current.json", {
      generationId: input.nextGenerationId
    });

    const generationIds = await this.driveClient.listGenerationIds();
    const allGenerationIds = generationIds.indexOf(input.nextGenerationId) === -1
      ? generationIds.concat([input.nextGenerationId])
      : generationIds;
    const gcPlan = planGenerationGarbageCollection({
      generationIds: allGenerationIds,
      retentionCount: this.generationRetentionCount
    });

    for (const generationId of gcPlan.remove) {
      await this.driveClient.deletePath("snapshots/generations/" + generationId);
    }

    return {
      currentGenerationId: input.nextGenerationId,
      buildPlan,
      removedGenerationIds: gcPlan.remove
    };
  }

  mapGenerationPath(generationId: string, relativePath: string): string {
    return "snapshots/generations/" + generationId + "/" + relativePath;
  }
}
