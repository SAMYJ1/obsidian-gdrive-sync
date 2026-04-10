import crypto from "crypto";
import { merge3 } from "../utils/diff3";

export interface MergeOutcome {
  merged: string;
  hasConflicts: boolean;
  conflictCount: number;
  blobHash: string;
}

export function isBinaryPath(filePath: string): boolean {
  const ext = (filePath.split(".").pop() || "").toLowerCase();
  const binaryExts = ["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg", "ico", "pdf", "mp3", "mp4", "wav", "ogg", "zip", "tar", "gz", "7z", "rar", "woff", "woff2", "ttf", "otf", "eot"];
  return binaryExts.includes(ext);
}

export function computeBlobHashSync(content: string): string {
  // Synchronous hash for inline merge results; uses Node.js crypto (always available in Electron)
  return `sha256:${crypto.createHash("sha256").update(String(content || "")).digest("hex")}`;
}

export function mergeRemoteText(
  localContent: string,
  baseContent: string,
  remoteContent: string,
  remoteDevice: string
): MergeOutcome {
  const result = merge3(localContent, baseContent, remoteContent, {
    localLabel: "local",
    remoteLabel: `remote (${remoteDevice || "unknown"})`
  });
  return {
    ...result,
    blobHash: computeBlobHashSync(result.merged)
  };
}
