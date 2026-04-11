export interface DriveHeaders {
  get(name: string): string | null;
}

export interface DriveResponse {
  ok: boolean;
  status: number;
  headers: DriveHeaders;
  text(): Promise<string>;
  json(): Promise<any>;
  arrayBuffer?(): Promise<ArrayBuffer | Buffer>;
}

export type FetchImpl = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Buffer;
  }
) => Promise<DriveResponse>;

export interface RateLimiter {
  acquire(tokens?: number): Promise<void>;
}

export interface GoogleDriveClientOptions {
  fetchImpl?: FetchImpl;
  getAccessToken: () => Promise<string>;
  rootFolderName?: string;
  vaultName?: string;
  now?: () => number;
  deviceInactiveThresholdMs?: number;
  rateLimiter?: RateLimiter;
  resumableUploadThresholdBytes?: number;
}

export interface DriveFileRecord {
  id: string;
  name?: string;
  mimeType?: string;
  parents?: string[];
  appProperties?: Record<string, string>;
  createdTime?: string;
}

export interface ManifestDeviceRecord {
  name?: string;
  lastSeenAt?: number;
  opsHead?: number;
  status?: "active" | "inactive";
}

export interface ManifestFileRecord {
  fileId: string;
  blobHash?: string;
  size?: number;
  mtime?: number;
  lastModifiedBy?: string;
  version?: number;
  updatedAt?: number;
}

export interface ManifestRecord {
  version: number;
  devices: Record<string, ManifestDeviceRecord>;
  files: Record<string, ManifestFileRecord>;
}

export interface ManifestPatchFile {
  path: string;
  newPath?: string;
  op?: "create" | "modify" | "delete" | "rename";
  fileId?: string;
  blobHash?: string;
  size?: number;
  mtime?: number;
  lastModifiedBy?: string;
  updatedAt?: number;
  version?: number;
  expectedVersion?: number;
  seq?: number;
}

export interface ManifestPatch {
  deviceId: string;
  files: ManifestPatchFile[];
}

export interface OperationEntry {
  seq: number;
  device: string;
  op?: "create" | "modify" | "delete" | "rename";
  path?: string;
  newPath?: string;
  fileId?: string;
  blobHash?: string;
  parentBlobHashes?: string[];
  mtime?: number;
  ts?: number;
}

export interface SnapshotMetaRecord {
  generationId?: string | null;
  snapshotSeqs: Record<string, number>;
  updatedAt?: number;
}

class TokenBucketRateLimiter implements RateLimiter {
  private capacity: number;
  private refillPerSecond: number;
  private now: () => number;
  private sleep: (ms: number) => Promise<void>;
  private tokens: number;
  private lastRefillAt: number;

  constructor(options?: {
    capacity?: number;
    refillPerSecond?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  }) {
    this.capacity = options?.capacity ?? 100;
    this.refillPerSecond = options?.refillPerSecond ?? 200;
    this.now = options?.now ?? (() => Date.now());
    this.sleep = options?.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.tokens = this.capacity;
    this.lastRefillAt = this.now();
  }

  private refill(): void {
    const currentTime = this.now();
    const elapsedMs = Math.max(0, currentTime - this.lastRefillAt);
    if (elapsedMs <= 0) {
      return;
    }
    const refillTokens = (elapsedMs / 1000) * this.refillPerSecond;
    this.tokens = Math.min(this.capacity, this.tokens + refillTokens);
    this.lastRefillAt = currentTime;
  }

  async acquire(tokenCount = 1): Promise<void> {
    while (true) {
      this.refill();
      if (this.tokens >= tokenCount) {
        this.tokens -= tokenCount;
        return;
      }
      const missing = tokenCount - this.tokens;
      const waitMs = Math.ceil((missing / this.refillPerSecond) * 1000);
      await this.sleep(Math.max(waitMs, 1));
    }
  }
}

function toQueryString(query?: Record<string, string | number | undefined>): string {
  if (!query) {
    return "";
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value == null) {
      continue;
    }
    search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized ? `?${serialized}` : "";
}

function headerLookup(response: DriveResponse, name: string): string | null {
  return response.headers && typeof response.headers.get === "function"
    ? response.headers.get(name)
    : null;
}

export class GoogleDriveClient {
  private fetchImpl: FetchImpl;
  private readonly getAccessToken: () => Promise<string>;
  private readonly rootFolderName: string;
  private readonly vaultName: string;
  private readonly baseUrl: string;
  private readonly now: () => number;
  private readonly deviceInactiveThresholdMs: number;
  private readonly rateLimiter: RateLimiter;
  private readonly resumableUploadThresholdBytes: number;
  private manifestETag: string | null = null;
  private manifestFileId: string | null = null;

  constructor(options: GoogleDriveClientOptions) {
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchImpl).bind(globalThis);
    this.getAccessToken = options.getAccessToken;
    this.rootFolderName = options.rootFolderName ?? "ObsidianSync";
    this.vaultName = options.vaultName ?? "ObsidianVault";
    this.baseUrl = "https://www.googleapis.com";
    this.now = options.now ?? (() => Date.now());
    this.deviceInactiveThresholdMs = options.deviceInactiveThresholdMs ?? 30 * 24 * 60 * 60 * 1000;
    this.rateLimiter = options.rateLimiter ?? new TokenBucketRateLimiter();
    this.resumableUploadThresholdBytes = options.resumableUploadThresholdBytes ?? 5 * 1024 * 1024;
  }

  toManagedLogicalPath(logicalPath: string): string {
    const normalized = (logicalPath || "").replace(/^\/+|\/+$/g, "");
    return normalized ? `${this.vaultName}/${normalized}` : this.vaultName;
  }

  fromManagedLogicalPath(managedLogicalPath?: string | null): string | null {
    const normalized = (managedLogicalPath || "").replace(/^\/+|\/+$/g, "");
    if (!normalized) {
      return null;
    }
    if (normalized === this.vaultName) {
      return "";
    }
    const prefix = `${this.vaultName}/`;
    if (!normalized.startsWith(prefix)) {
      return null;
    }
    return normalized.slice(prefix.length);
  }

  private buildManagedAppProperties(managedLogicalPath: string, kind: string): Record<string, string> {
    return {
      logicalPath: managedLogicalPath,
      kind,
      vault: this.vaultName
    };
  }

  async request(
    method: string,
    resourcePath: string,
    options?: {
      query?: Record<string, string | number | undefined>;
      headers?: Record<string, string>;
      body?: string | Buffer;
    }
  ): Promise<DriveResponse> {
    const maxAttempts = 3;
    let lastError: any;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const accessToken = await this.getAccessToken();
      const headers = {
        ...(options?.headers ?? {}),
        Authorization: `Bearer ${accessToken}`
      };
      await this.rateLimiter.acquire(1);
      const response = await this.fetchImpl(`${this.baseUrl}${resourcePath}${toQueryString(options?.query)}`, {
        method,
        headers,
        body: options?.body
      });
      if (response.ok) {
        return response;
      }
      const text = await response.text();
      const error = new Error(`Google Drive request failed: ${method} ${resourcePath} ${text}`) as Error & {
        status?: number;
        retryAfter?: number;
      };
      error.status = response.status;
      const retryAfter = headerLookup(response, "retry-after");
      if (retryAfter != null) {
        error.retryAfter = Number(retryAfter);
      }
      lastError = error;
      // Retry on transient failures (429 rate limit, 5xx server errors)
      const isRetryable = response.status === 429 || (response.status >= 500 && response.status < 600);
      if (!isRetryable || attempt >= maxAttempts) {
        throw error;
      }
      const delay = error.retryAfter ? error.retryAfter * 1000 : 1000 * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    throw lastError;
  }

  async requestJson(
    method: string,
    resourcePath: string,
    options?: {
      query?: Record<string, string | number | undefined>;
      headers?: Record<string, string>;
      body?: string | Buffer;
    }
  ): Promise<any> {
    const response = await this.request(method, resourcePath, options);
    return response.status === 204 ? {} : response.json();
  }

  async batchMetadataRequests(
    requests: Array<{ method: string; path: string; body?: string }>
  ): Promise<Array<{ status: number; body: any }>> {
    if (requests.length === 0) return [];
    // Chunk into batches of 100 per Google Drive API limit
    const results: Array<{ status: number; body: any }> = [];
    for (let i = 0; i < requests.length; i += 100) {
      const chunk = requests.slice(i, i + 100);
      const chunkResults = await this.sendBatch(chunk);
      results.push(...chunkResults);
    }
    return results;
  }

  private async sendBatch(
    requests: Array<{ method: string; path: string; body?: string }>
  ): Promise<Array<{ status: number; body: any }>> {
    const accessToken = await this.getAccessToken();
    const boundary = `batch_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const parts: string[] = [];
    for (const req of requests) {
      parts.push(
        `--${boundary}\r\n` +
        `Content-Type: application/http\r\n\r\n` +
        `${req.method} ${req.path} HTTP/1.1\r\n` +
        `Content-Type: application/json\r\n` +
        (req.body ? `\r\n${req.body}\r\n` : `\r\n`)
      );
    }
    parts.push(`--${boundary}--\r\n`);
    const batchBody = parts.join("");
    await this.rateLimiter.acquire(requests.length);
    const response = await this.fetchImpl(`${this.baseUrl}/batch/drive/v3`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/mixed; boundary=${boundary}`
      },
      body: batchBody
    });
    const responseText = await response.text();
    return this.parseBatchResponse(responseText);
  }

  private parseBatchResponse(responseText: string): Array<{ status: number; body: any }> {
    const results: Array<{ status: number; body: any }> = [];
    const boundaryMatch = responseText.match(/^--([^\r\n]+)/);
    if (!boundaryMatch) return results;
    const boundary = boundaryMatch[1];
    const parts = responseText.split(`--${boundary}`).slice(1, -1);
    for (const part of parts) {
      const httpStart = part.indexOf("HTTP/1.1");
      if (httpStart === -1) {
        results.push({ status: 0, body: null });
        continue;
      }
      const statusMatch = part.slice(httpStart).match(/HTTP\/1\.1 (\d+)/);
      const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;
      const bodyStart = part.indexOf("\r\n\r\n", httpStart + 1);
      let body: any = null;
      if (bodyStart !== -1) {
        const bodyText = part.slice(bodyStart + 4).trim();
        try { body = JSON.parse(bodyText); } catch { body = bodyText; }
      }
      results.push({ status, body });
    }
    return results;
  }

  buildAppProperties(logicalPath: string, kind: string): Record<string, string> {
    return this.buildManagedAppProperties(this.toManagedLogicalPath(logicalPath), kind);
  }

  async listFiles(query: string): Promise<DriveFileRecord[]> {
    const allFiles: DriveFileRecord[] = [];
    let pageToken: string | undefined;
    do {
      const payload = await this.requestJson("GET", "/drive/v3/files", {
        query: {
          q: query,
          fields: "files(id,name,mimeType,parents,appProperties),nextPageToken",
          pageSize: 1000,
          pageToken
        }
      });
      allFiles.push(...((payload.files as DriveFileRecord[] | undefined) ?? []));
      pageToken = payload.nextPageToken;
    } while (pageToken);
    return allFiles;
  }

  async ensureRootFolder(): Promise<DriveFileRecord> {
    const existing = await this.listFiles(
      `mimeType='application/vnd.google-apps.folder' and name='${this.rootFolderName}' and trashed=false`
    );
    if (existing.length > 0) {
      return existing[0];
    }
    return this.requestJson("POST", "/drive/v3/files", {
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: this.rootFolderName,
        mimeType: "application/vnd.google-apps.folder",
        appProperties: {
          kind: "root"
        }
      })
    });
  }

  async ensureVaultFolder(): Promise<DriveFileRecord> {
    const existing = await this.findByManagedLogicalPath(this.vaultName);
    if (existing) {
      return existing;
    }
    const root = await this.ensureRootFolder();
    return this.createFolder(this.vaultName, root.id, this.vaultName, "vault-root");
  }

  async findByLogicalPath(logicalPath: string): Promise<DriveFileRecord | null> {
    return this.findByManagedLogicalPath(this.toManagedLogicalPath(logicalPath));
  }

  async findByManagedLogicalPath(managedLogicalPath: string): Promise<DriveFileRecord | null> {
    const files = await this.listFiles(
      `appProperties has { key='logicalPath' and value='${managedLogicalPath}' } and trashed=false`
    );
    return files[0] ?? null;
  }

  async listManagedFiles(): Promise<DriveFileRecord[]> {
    const files = await this.listFiles(`appProperties has { key='vault' and value='${this.vaultName}' } and trashed=false`);
    return files
      .map((file) => {
        const decodedLogicalPath = this.fromManagedLogicalPath(file.appProperties?.logicalPath);
        if (decodedLogicalPath == null) {
          return null;
        }
        return {
          ...file,
          appProperties: {
            ...(file.appProperties || {}),
            logicalPath: decodedLogicalPath
          }
        };
      })
      .filter(Boolean) as DriveFileRecord[];
  }

  async createFolder(name: string, parentId: string | undefined, managedLogicalPath: string, kind = "folder"): Promise<DriveFileRecord> {
    return this.requestJson("POST", "/drive/v3/files", {
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: parentId ? [parentId] : undefined,
        appProperties: this.buildManagedAppProperties(managedLogicalPath, kind)
      })
    });
  }

  async ensureFolder(logicalFolderPath: string): Promise<string> {
    const vaultRoot = await this.ensureVaultFolder();
    const parts = logicalFolderPath.split("/").filter(Boolean);
    let currentParentId = vaultRoot.id;
    let currentManagedPath = this.vaultName;

    for (const part of parts) {
      currentManagedPath = `${currentManagedPath}/${part}`;
      const existing = await this.findByManagedLogicalPath(currentManagedPath);
      if (existing) {
        currentParentId = existing.id;
      } else {
        const created = await this.createFolder(part, currentParentId, currentManagedPath);
        currentParentId = created.id;
      }
    }
    return currentParentId;
  }

  async createOrUpdateFile(
    logicalPath: string,
    content: string | Uint8Array | Buffer,
    mimeType = "application/octet-stream",
    kind = "file",
    options?: { ifMatch?: string }
  ): Promise<any> {
    const fileName = logicalPath.split("/").pop() ?? logicalPath;
    const parentPath = logicalPath.split("/").slice(0, -1).join("/");
    const parentId = parentPath ? await this.ensureFolder(parentPath) : (await this.ensureVaultFolder()).id;
    const existing = await this.findByLogicalPath(logicalPath);
    const contentBuffer = this.toContentBuffer(content);
    if (contentBuffer.length > this.resumableUploadThresholdBytes) {
      return this.createOrUpdateFileResumable(logicalPath, contentBuffer, mimeType, kind, {
        existing,
        parentId,
        fileName,
        ifMatch: options?.ifMatch
      });
    }

    const boundary = `ogds-${Date.now()}`;
    const metadata = {
      name: fileName,
      parents: [parentId],
      mimeType,
      appProperties: this.buildAppProperties(logicalPath, kind)
    };
    const body = this.buildMultipartBody(boundary, metadata, contentBuffer, mimeType);

    if (existing) {
      const updateBody = this.buildMultipartBody(boundary, {
        name: fileName,
        mimeType,
        appProperties: this.buildAppProperties(logicalPath, kind)
      }, contentBuffer, mimeType);
      return this.requestJson("PATCH", `/upload/drive/v3/files/${existing.id}`, {
        query: {
          uploadType: "multipart",
          fields: "id,name,appProperties",
          addParents: parentId
        },
        headers: {
          "Content-Type": `multipart/related; boundary=${boundary}`,
          ...(options?.ifMatch ? { "If-Match": options.ifMatch } : {})
        },
        body: updateBody
      });
    }

    return this.requestJson("POST", "/upload/drive/v3/files", {
      query: {
        uploadType: "multipart",
        fields: "id,name,appProperties"
      },
      headers: {
        "Content-Type": `multipart/related; boundary=${boundary}`
      },
      body
    });
  }

  toContentBuffer(content: string | Uint8Array | Buffer): Buffer {
    if (Buffer.isBuffer(content)) {
      return content;
    }
    if (content instanceof Uint8Array) {
      return Buffer.from(content);
    }
    return Buffer.from(typeof content === "string" ? content : String(content ?? ""), "utf8");
  }

  buildMultipartBody(
    boundary: string,
    metadata: Record<string, unknown>,
    contentBuffer: Buffer,
    mimeType: string
  ): Buffer {
    return Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
      contentBuffer,
      Buffer.from(`\r\n--${boundary}--`)
    ]);
  }

  async createOrUpdateFileResumable(
    logicalPath: string,
    contentBuffer: Buffer,
    mimeType: string,
    kind: string,
    options: {
      existing: DriveFileRecord | null;
      parentId: string;
      fileName: string;
      ifMatch?: string;
    }
  ): Promise<any> {
    const metadata = {
      name: options.fileName,
      parents: options.existing ? undefined : [options.parentId],
      mimeType,
      appProperties: this.buildAppProperties(logicalPath, kind)
    };
    const accessToken = await this.getAccessToken();
    const resourcePath = options.existing ? `/upload/drive/v3/files/${options.existing.id}` : "/upload/drive/v3/files";
    const query = options.existing
      ? { uploadType: "resumable", fields: "id,name,appProperties", addParents: options.parentId }
      : { uploadType: "resumable", fields: "id,name,appProperties" };
    await this.rateLimiter.acquire(1);
    const session = await this.fetchImpl(`${this.baseUrl}${resourcePath}${toQueryString(query)}`, {
      method: options.existing ? "PATCH" : "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mimeType,
        ...(options.ifMatch ? { "If-Match": options.ifMatch } : {})
      },
      body: JSON.stringify(metadata)
    });
    if (!session.ok) {
      const text = await session.text();
      const error = new Error(`Google Drive resumable upload init failed: ${text}`) as Error & { status?: number };
      error.status = session.status;
      throw error;
    }

    const uploadUrl = headerLookup(session, "location");
    if (!uploadUrl) {
      throw new Error("Missing resumable upload session URL");
    }

    // Chunked upload: 256KB chunks per Google's resumable upload protocol
    const chunkSize = 256 * 1024;
    const totalSize = contentBuffer.length;
    let offset = 0;
    while (offset < totalSize) {
      const end = Math.min(offset + chunkSize, totalSize);
      const chunk = contentBuffer.slice(offset, end);
      const isLastChunk = end === totalSize;
      await this.rateLimiter.acquire(1);
      const uploadResponse = await this.fetchImpl(uploadUrl, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": mimeType,
          "Content-Length": String(chunk.length),
          "Content-Range": `bytes ${offset}-${end - 1}/${totalSize}`
        },
        body: chunk
      });
      if (isLastChunk) {
        if (!uploadResponse.ok) {
          const text = await uploadResponse.text();
          const error = new Error(`Google Drive resumable upload failed: ${text}`) as Error & { status?: number };
          error.status = uploadResponse.status;
          throw error;
        }
        return uploadResponse.status === 204 ? {} : uploadResponse.json();
      }
      // For non-final chunks, Google responds with 308 Resume Incomplete
      if (uploadResponse.status !== 308 && !uploadResponse.ok) {
        const text = await uploadResponse.text();
        const error = new Error(`Google Drive resumable upload chunk failed: ${text}`) as Error & { status?: number };
        error.status = uploadResponse.status;
        throw error;
      }
      offset = end;
    }
    return {};
  }

  async writeFile(logicalPath: string, content: string | Uint8Array | Buffer): Promise<any> {
    return this.createOrUpdateFile(logicalPath, content, "application/octet-stream", "file");
  }

  async writeJson(logicalPath: string, value: unknown): Promise<any> {
    return this.createOrUpdateFile(logicalPath, JSON.stringify(value, null, 2), "application/json", "json");
  }

  async readJson<T>(logicalPath: string): Promise<T | null> {
    const body = await this.readFile(logicalPath);
    if (body == null || body === "") {
      return null;
    }
    return JSON.parse(body) as T;
  }

  async writeSnapshotFile(logicalPath: string, content: string | Uint8Array | Buffer): Promise<any> {
    return this.writeFile(logicalPath, content);
  }

  async readFile(logicalPath: string): Promise<string | null> {
    const existing = await this.findByLogicalPath(logicalPath);
    if (!existing) {
      return null;
    }
    const response = await this.request("GET", `/drive/v3/files/${existing.id}`, {
      query: {
        alt: "media"
      }
    });
    return response.text();
  }

  async readFileBinary(logicalPath: string): Promise<Uint8Array | null> {
    const existing = await this.findByLogicalPath(logicalPath);
    if (!existing) {
      return null;
    }
    const response = await this.request("GET", `/drive/v3/files/${existing.id}`, {
      query: { alt: "media" }
    });
    const buffer = await (response as any).arrayBuffer();
    return new Uint8Array(buffer);
  }

  async copyFile(sourceLogicalPath: string, destinationLogicalPath: string): Promise<any> {
    const source = await this.findByLogicalPath(sourceLogicalPath);
    if (!source) {
      throw new Error(`Source file not found for copy: ${sourceLogicalPath}`);
    }
    const fileName = destinationLogicalPath.split("/").pop() ?? destinationLogicalPath;
    const parentPath = destinationLogicalPath.split("/").slice(0, -1).join("/");
    const parentId = parentPath ? await this.ensureFolder(parentPath) : (await this.ensureRootFolder()).id;
    return this.requestJson("POST", `/drive/v3/files/${source.id}/copy`, {
      query: {
        fields: "id,name,appProperties"
      },
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: fileName,
        parents: [parentId],
        appProperties: this.buildAppProperties(destinationLogicalPath, "file")
      })
    });
  }

  async deletePath(logicalPath: string): Promise<void> {
    const files = await this.listManagedFiles();
    const toDelete = files.filter((file) => {
      const candidatePath = file.appProperties?.logicalPath;
      return candidatePath && (candidatePath === logicalPath || candidatePath.startsWith(`${logicalPath}/`));
    });
    // Concurrent deletes (up to 5 parallel)
    const concurrency = 5;
    let idx = 0;
    const worker = async () => {
      while (idx < toDelete.length) {
        const file = toDelete[idx++];
        await this.request("DELETE", `/drive/v3/files/${file.id}`, {});
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, toDelete.length) }, () => worker()));
  }

  async listGenerationIds(): Promise<string[]> {
    const files = await this.listManagedFiles();
    const ids = new Set<string>();
    for (const file of files) {
      const logicalPath = file.appProperties?.logicalPath;
      if (!logicalPath || !logicalPath.startsWith("snapshots/generations/")) {
        continue;
      }
      const generationId = logicalPath.split("/")[2];
      if (generationId) {
        ids.add(generationId);
      }
    }
    return Array.from(ids).sort();
  }

  async uploadBlob(change: { blobHash: string; content?: string | Uint8Array | Buffer }): Promise<{ blobHash: string }> {
    const logicalPath = `blobs/${change.blobHash}`;
    const existing = await this.findByLogicalPath(logicalPath);
    if (!existing) {
      await this.writeFile(logicalPath, change.content ?? "");
    }
    return { blobHash: change.blobHash };
  }

  async appendOperation(entry: OperationEntry): Promise<{ remoteOpLogId: string }> {
    const logicalPath = `ops/live/${entry.device}.jsonl`;
    const line = `${JSON.stringify(entry)}\n`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const existing = await this.findByLogicalPath(logicalPath);
      if (!existing) {
        await this.writeFile(logicalPath, line);
        return { remoteOpLogId: `${logicalPath}#${entry.seq}` };
      }

      const response = await this.request("GET", `/drive/v3/files/${existing.id}`, {
        query: { alt: "media" }
      });
      const etag = headerLookup(response, "etag");
      const currentBody = await response.text();
      const nextBody = currentBody ? `${currentBody.replace(/\s*$/, "")}\n${line}` : line;
      try {
        await this.createOrUpdateFile(logicalPath, nextBody, "application/octet-stream", "file", {
          ifMatch: etag ?? undefined
        });
        return { remoteOpLogId: `${logicalPath}#${entry.seq}` };
      } catch (error) {
        const driveError = error as Error & { status?: number };
        if (driveError.status !== 412 || attempt === 2) {
          throw error;
        }
      }
    }
    return { remoteOpLogId: `${logicalPath}#${entry.seq}` };
  }

  async readManifest(): Promise<ManifestRecord> {
    const existing = await this.findByLogicalPath("manifest.json");
    if (!existing) {
      this.manifestETag = null;
      this.manifestFileId = null;
      return { version: 2, devices: {}, files: {} };
    }
    this.manifestFileId = existing.id;
    const response = await this.request("GET", `/drive/v3/files/${existing.id}`, {
      query: { alt: "media" }
    });
    this.manifestETag = headerLookup(response, "etag");
    const body = await response.text();
    return JSON.parse(body) as ManifestRecord;
  }

  resetManifestETag(): void {
    this.manifestETag = null;
  }

  async writeManifest(patch: ManifestPatch): Promise<ManifestRecord> {
    // Re-read manifest to get fresh content and ETag atomically.
    // readManifest() updates this.manifestETag as a side-effect,
    // and we use that fresh ETag for the conditional write.
    const manifest = await this.readManifest();
    const casETag = this.manifestETag;
    const device = manifest.devices[patch.deviceId] ?? {};
    let opsHead = device.opsHead ?? 0;
    const now = this.now();

    for (const deviceId of Object.keys(manifest.devices ?? {})) {
      const current = manifest.devices[deviceId] ?? {};
      const nextStatus = current.lastSeenAt && now - current.lastSeenAt > this.deviceInactiveThresholdMs
        ? "inactive"
        : (current.status ?? "active");
      manifest.devices[deviceId] = {
        ...current,
        status: nextStatus
      };
    }

    for (const file of patch.files ?? []) {
      // Version-based optimistic lock: if expectedVersion is provided,
      // signal a conflict when the manifest has advanced past it (spec §2)
      if (typeof file.expectedVersion === "number") {
        const currentRecord = manifest.files[file.path];
        if (currentRecord && typeof currentRecord.version === "number" &&
            currentRecord.version > file.expectedVersion) {
          const error = new Error(
            `Version conflict on ${file.path}: expected ${file.expectedVersion}, manifest has ${currentRecord.version}`
          ) as Error & { status?: number; versionConflict?: boolean };
          error.status = 409;
          error.versionConflict = true;
          throw error;
        }
      }

      if (file.op === "delete") {
        // Spec §2: verify fileId before deleting — path reuse by different file should not be deleted
        const currentRecord = manifest.files[file.path];
        if (currentRecord && file.fileId && currentRecord.fileId && currentRecord.fileId !== file.fileId) {
          continue; // Different file at same path — skip this delete
        }
        delete manifest.files[file.path];
      } else if (file.op === "rename" && file.newPath) {
        const previousRecord = manifest.files[file.path] ?? { fileId: file.newPath };
        delete manifest.files[file.path];
        manifest.files[file.newPath] = {
          fileId: file.fileId ?? previousRecord.fileId ?? file.newPath,
          version: file.version ?? ((previousRecord.version ?? 0) + 1),
          blobHash: file.blobHash,
          size: file.size,
          mtime: file.mtime ?? now,
          lastModifiedBy: file.lastModifiedBy,
          updatedAt: file.updatedAt
        };
      } else {
        const previousRecord = manifest.files[file.path] ?? { fileId: file.path };
        manifest.files[file.path] = {
          fileId: file.fileId ?? previousRecord.fileId ?? file.path,
          version: file.version ?? ((previousRecord.version ?? 0) + 1),
          blobHash: file.blobHash,
          size: file.size,
          mtime: file.mtime ?? now,
          lastModifiedBy: file.lastModifiedBy,
          updatedAt: file.updatedAt
        };
      }

      if (typeof file.seq === "number" && file.seq > opsHead) {
        opsHead = file.seq;
      }
    }

    manifest.devices[patch.deviceId] = {
      ...(manifest.devices[patch.deviceId] ?? {}),
      name: (manifest.devices[patch.deviceId]?.name) ?? patch.deviceId,
      lastSeenAt: now,
      opsHead,
      status: "active"
    };
    manifest.version = (manifest.version ?? 0) + 1;

    await this.createOrUpdateFile("manifest.json", JSON.stringify(manifest, null, 2), "application/json", "json", {
      ifMatch: casETag ?? undefined
    });
    return manifest;
  }

  async writeCursor(deviceId: string, cursorVector: Record<string, number>): Promise<Record<string, number>> {
    await this.writeJson(`ops/cursors/${deviceId}.json`, {
      cursors: cursorVector,
      updatedAt: this.now()
    });
    return cursorVector;
  }

  async getRemoteHeads(): Promise<Record<string, number>> {
    const manifest = await this.readManifest();
    const heads: Record<string, number> = {};
    for (const deviceId of Object.keys(manifest.devices ?? {})) {
      heads[deviceId] = manifest.devices[deviceId]?.opsHead ?? 0;
    }
    return heads;
  }

  async listOperationsSince(cursorByDevice?: Record<string, number>): Promise<OperationEntry[]> {
    const manifest = await this.readManifest();
    const results: OperationEntry[] = [];
    for (const deviceId of Object.keys(manifest.devices ?? {})) {
      const since = cursorByDevice?.[deviceId] ?? 0;
      const committedHead = manifest.devices[deviceId]?.opsHead ?? 0;
      if (committedHead <= since) continue;
      const body = await this.readFile(`ops/live/${deviceId}.jsonl`);
      const liveEntries: OperationEntry[] = [];
      if (body) {
        for (const line of body.split("\n").filter(Boolean)) {
          const entry = JSON.parse(line) as OperationEntry;
          if (entry.seq > since && entry.seq <= committedHead) {
            liveEntries.push(entry);
          }
        }
      }
      // Check for gaps: if the live log doesn't contain all expected seqs, try archive
      const liveMinSeq = liveEntries.length > 0 ? Math.min(...liveEntries.map((e) => e.seq)) : committedHead + 1;
      if (liveMinSeq > since + 1) {
        console.warn(`obsidian-gdrive-sync: live log for ${deviceId} missing ops ${since + 1}..${liveMinSeq - 1}, checking archive`);
        const archiveEntries = await this.readArchiveOps(deviceId, since, liveMinSeq);
        results.push(...archiveEntries);
      }
      results.push(...liveEntries);
    }
    return results.sort((left, right) => (left.ts ?? 0) - (right.ts ?? 0));
  }

  private async readArchiveOps(deviceId: string, sinceSeq: number, beforeSeq: number): Promise<OperationEntry[]> {
    const files = await this.listManagedFiles();
    const archiveFiles = files.filter((file) => {
      const logicalPath = file.appProperties?.logicalPath;
      return Boolean(logicalPath && logicalPath.startsWith(`ops/archive/${deviceId}-`));
    });
    const results: OperationEntry[] = [];
    for (const file of archiveFiles) {
      const logicalPath = file.appProperties?.logicalPath ?? "";
      const body = await this.readFile(logicalPath);
      if (!body) continue;
      for (const line of body.split("\n").filter(Boolean)) {
        const entry = JSON.parse(line) as OperationEntry;
        if (entry.seq > sinceSeq && entry.seq < beforeSeq) {
          results.push(entry);
        }
      }
    }
    return results;
  }

  async fetchBlob(blobHash: string, binary?: boolean): Promise<string | Uint8Array> {
    if (binary) {
      const data = await this.readFileBinary(`blobs/${blobHash}`);
      if (data == null) {
        throw new Error(`Missing blob: ${blobHash}`);
      }
      return data;
    }
    const body = await this.readFile(`blobs/${blobHash}`);
    if (body == null) {
      throw new Error(`Missing blob: ${blobHash}`);
    }
    return body;
  }

  async getOpsForFile(fileId: string, limit?: number): Promise<OperationEntry[]> {
    const manifest = await this.readManifest();
    const results: OperationEntry[] = [];
    for (const deviceId of Object.keys(manifest.devices ?? {})) {
      // Read live log
      const body = await this.readFile(`ops/live/${deviceId}.jsonl`);
      if (body) {
        for (const line of body.split("\n").filter(Boolean)) {
          const entry = JSON.parse(line) as OperationEntry;
          if (entry.fileId === fileId) {
            results.push(entry);
          }
        }
      }
      // Fallback: also check archive logs for ancestry walking (spec §3)
      const allFiles = await this.listManagedFiles();
      const archiveFiles = allFiles.filter((f) => {
        const lp = f.appProperties?.logicalPath;
        return lp && lp.startsWith(`ops/archive/${deviceId}-`) && lp.endsWith(".jsonl");
      });
      for (const archiveFile of archiveFiles) {
        const archiveBody = await this.readFile(archiveFile.appProperties?.logicalPath || "");
        if (archiveBody) {
          for (const line of archiveBody.split("\n").filter(Boolean)) {
            try {
              const entry = JSON.parse(line) as OperationEntry;
              if (entry.fileId === fileId) {
                results.push(entry);
              }
            } catch { /* skip malformed */ }
          }
        }
      }
    }
    results.sort((left, right) => (right.ts ?? 0) - (left.ts ?? 0));
    return typeof limit === "number" ? results.slice(0, limit) : results;
  }

  async getStartPageToken(): Promise<string> {
    const result = await this.requestJson("GET", "/drive/v3/changes/startPageToken");
    return result.startPageToken;
  }

  async listChanges(pageToken: string): Promise<any> {
    return this.requestJson("GET", "/drive/v3/changes", {
      query: {
        pageToken,
        spaces: "drive",
        fields: "nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,appProperties))",
        pageSize: 100
      }
    });
  }

  async readSnapshotMeta(snapshotPublishMode?: string): Promise<SnapshotMetaRecord> {
    if (snapshotPublishMode === "generations") {
      const current = await this.readJson<{ generationId?: string }>("snapshots/current.json");
      if (!current?.generationId) {
        return {
          generationId: null,
          snapshotSeqs: {}
        };
      }
      const meta = await this.readJson<SnapshotMetaRecord>(`snapshots/generations/${current.generationId}/_meta.json`);
      return {
        ...(meta ?? { snapshotSeqs: {} }),
        generationId: current.generationId
      };
    }
    return (await this.readJson<SnapshotMetaRecord>("vault/_snapshot_meta.json")) ?? {
      snapshotSeqs: {}
    };
  }

  async downloadSnapshot(
    snapshotMeta: { generationId?: string | null } | null,
    snapshotPublishMode?: string
  ): Promise<Array<{ path: string; content: string | Uint8Array }>> {
    const prefix = snapshotPublishMode === "generations" && snapshotMeta?.generationId
      ? `snapshots/generations/${snapshotMeta.generationId}/vault/`
      : "vault/";
    const files = await this.listManagedFiles();
    const snapshotFiles = files.filter((file) => {
      const logicalPath = file.appProperties?.logicalPath;
      return Boolean(logicalPath && logicalPath.startsWith(prefix) && logicalPath.slice(prefix.length) !== "_snapshot_meta.json");
    });
    snapshotFiles.sort((left, right) =>
      (left.appProperties?.logicalPath ?? "").localeCompare(right.appProperties?.logicalPath ?? "")
    );

    const results: Array<{ path: string; content: string | Uint8Array }> = [];
    const downloadQueue = snapshotFiles.filter((f) => f.appProperties?.logicalPath);
    const concurrency = 5;
    const queue = downloadQueue.slice();
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length > 0) {
        const file = queue.shift()!;
        const logicalPath = file.appProperties!.logicalPath!;
        const filePath = logicalPath.slice(prefix.length);
        // Use binary download for binary file types
        const binaryExts = ["png", "jpg", "jpeg", "gif", "bmp", "svg", "mp3", "mp4", "wav", "ogg", "webm", "webp", "pdf", "zip", "tar", "gz", "woff", "woff2", "ttf", "otf", "ico"];
        const ext = (filePath.split(".").pop() || "").toLowerCase();
        if (binaryExts.includes(ext)) {
          const content = await this.readFileBinary(logicalPath);
          results.push({ path: filePath, content: content ?? new Uint8Array(0) });
        } else {
          const content = await this.readFile(logicalPath);
          results.push({ path: filePath, content: content ?? "" });
        }
      }
    });
    await Promise.all(workers);
    results.sort((a, b) => a.path.localeCompare(b.path));
    return results;
  }

  async readOperationLog(deviceId: string): Promise<OperationEntry[]> {
    const body = await this.readFile(`ops/live/${deviceId}.jsonl`);
    if (!body) {
      return [];
    }
    return body.split("\n").filter(Boolean).map((line) => JSON.parse(line) as OperationEntry);
  }

  async overwriteOperationLog(deviceId: string, entries: OperationEntry[]): Promise<void> {
    const body = entries.map((entry) => JSON.stringify(entry)).join("\n");
    await this.writeFile(`ops/live/${deviceId}.jsonl`, body ? `${body}\n` : "");
  }

  async writeArchiveLog(deviceId: string, startSeq: number, endSeq: number, entries: OperationEntry[]): Promise<void> {
    const body = entries.map((entry) => JSON.stringify(entry)).join("\n");
    await this.writeFile(`ops/archive/${deviceId}-${startSeq}-${endSeq}.jsonl`, body ? `${body}\n` : "");
  }

  async listCursorVectors(): Promise<Array<{ deviceId: string; cursors: Record<string, number> }>> {
    const files = await this.listManagedFiles();
    const vectors: Array<{ deviceId: string; cursors: Record<string, number> }> = [];
    for (const file of files) {
      const logicalPath = file.appProperties?.logicalPath;
      if (!logicalPath || !logicalPath.startsWith("ops/cursors/")) {
        continue;
      }
      const body = await this.readFile(logicalPath);
      if (!body) {
        continue;
      }
      const parsed = JSON.parse(body) as { cursors?: Record<string, number> };
      vectors.push({
        deviceId: logicalPath.replace(/^ops\/cursors\//, "").replace(/\.json$/, ""),
        cursors: parsed.cursors ?? {}
      });
    }
    return vectors;
  }

  async garbageCollectBlobs(options?: { maxAgeMs?: number }): Promise<{ deletedCount: number }> {
    const maxAgeMs = options?.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000;
    const now = this.now();
    const manifest = await this.readManifest();

    // Collect all referenced blob hashes from manifest files
    const referencedHashes = new Set<string>();
    for (const record of Object.values(manifest.files ?? {})) {
      if ((record as any).blobHash) {
        referencedHashes.add((record as any).blobHash);
      }
    }

    // Collect referenced hashes from all op-logs (live + archive)
    for (const deviceId of Object.keys(manifest.devices ?? {})) {
      const body = await this.readFile(`ops/live/${deviceId}.jsonl`);
      if (body) {
        for (const line of body.split("\n").filter(Boolean)) {
          try {
            const entry = JSON.parse(line);
            if (entry.blobHash) referencedHashes.add(entry.blobHash);
            if (entry.parentBlobHashes) {
              for (const h of entry.parentBlobHashes) referencedHashes.add(h);
            }
          } catch { /* skip malformed lines */ }
        }
      }
    }

    // Also scan archive logs for referenced hashes
    const archiveScanFiles = await this.listManagedFiles();
    const archiveFiles = archiveScanFiles.filter((f) => {
      const lp = f.appProperties?.logicalPath;
      return lp && lp.startsWith("ops/archive/") && lp.endsWith(".jsonl");
    });
    for (const archiveFile of archiveFiles) {
      const archiveBody = await this.readFile(archiveFile.appProperties?.logicalPath || "");
      if (archiveBody) {
        for (const line of archiveBody.split("\n").filter(Boolean)) {
          try {
            const entry = JSON.parse(line);
            if (entry.blobHash) referencedHashes.add(entry.blobHash);
            if (entry.parentBlobHashes) {
              for (const h of entry.parentBlobHashes) referencedHashes.add(h);
            }
          } catch { /* skip malformed lines */ }
        }
      }
    }

    // Find and delete unreferenced blobs older than maxAgeMs
    const allFiles = await this.listManagedFiles();
    const blobFiles = allFiles.filter((f) => {
      const lp = f.appProperties?.logicalPath;
      return lp && lp.startsWith("blobs/");
    });

    let deletedCount = 0;
    for (const file of blobFiles) {
      const blobHash = file.appProperties?.logicalPath?.replace("blobs/", "");
      if (blobHash && !referencedHashes.has(blobHash)) {
        const createdTime = file.createdTime ? new Date(file.createdTime).getTime() : 0;
        if (createdTime && now - createdTime > maxAgeMs) {
          await this.request("DELETE", `/drive/v3/files/${file.id}`, {});
          deletedCount++;
        }
      }
    }
    return { deletedCount };
  }
}
