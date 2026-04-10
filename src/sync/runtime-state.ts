import fs from "fs";
import path from "path";

function defaultNow(): number {
  return Date.now();
}

export interface RuntimeState {
  phase: string;
  sessionId: string | null;
  startedAt: number;
  endedAt: number;
  paths: string[];
  source: string;
  cooldownUntil: number;
}

export function createIdleState(now?: number): RuntimeState {
  return {
    phase: "idle",
    sessionId: null,
    startedAt: 0,
    endedAt: now || 0,
    paths: [],
    source: "remote_sync",
    cooldownUntil: 0
  };
}

function writeJsonAtomically(targetPath: string, value: unknown): void {
  const dirPath = path.dirname(targetPath);
  const tempPath = targetPath + ".tmp";
  fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
  fs.renameSync(tempPath, targetPath);
}

export class RuntimeStateStore {
  private readonly statePath: string;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(options: { statePath: string; cooldownMs?: number; now?: () => number }) {
    this.statePath = options.statePath;
    this.cooldownMs = options.cooldownMs || 0;
    this.now = options.now || defaultNow;
  }

  readState(): RuntimeState {
    if (!fs.existsSync(this.statePath)) {
      return createIdleState(this.now());
    }
    return JSON.parse(fs.readFileSync(this.statePath, "utf8"));
  }

  writeState(state: RuntimeState): void {
    writeJsonAtomically(this.statePath, state);
  }

  beginRemoteApply(paths: string[]): RuntimeState {
    const startedAt = this.now();
    const state: RuntimeState = {
      phase: "remote_apply",
      sessionId: "remote-" + startedAt,
      startedAt,
      endedAt: 0,
      paths: Array.from(new Set(paths || [])),
      source: "remote_sync",
      cooldownUntil: 0
    };
    this.writeState(state);
    return state;
  }

  completeRemoteApply(): RuntimeState {
    const current = this.readState();
    const endedAt = this.now();
    const nextState: RuntimeState = {
      phase: "idle",
      sessionId: current.sessionId,
      startedAt: current.startedAt || 0,
      endedAt,
      paths: current.paths || [],
      source: "remote_sync",
      cooldownUntil: endedAt + this.cooldownMs
    };
    this.writeState(nextState);
    return nextState;
  }

  shouldSuppressPath(filePath: string, atTime?: number): boolean {
    const current = this.readState();
    const now = typeof atTime === "number" ? atTime : this.now();
    const matches = (current.paths || []).indexOf(filePath) !== -1;
    if (!matches) return false;
    if (current.phase === "remote_apply") return true;
    return now < (current.cooldownUntil || 0);
  }

  recoverIfStale(): void {
    const current = this.readState();
    const now = this.now();
    const staleRemoteApply =
      current.phase === "remote_apply" && current.startedAt + this.cooldownMs <= now;
    const staleCooldown =
      current.phase === "idle" &&
      (current.cooldownUntil || 0) <= now &&
      Array.isArray(current.paths) &&
      current.paths.length > 0;
    if (staleRemoteApply || staleCooldown) {
      this.writeState(createIdleState(now));
    }
  }
}
