import crypto from "crypto";

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  // Prefer Web Crypto API (Electron/browser), fall back to Node.js crypto
  if (typeof globalThis.crypto?.subtle?.digest === "function") {
    const data = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
    const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", data.buffer);
    return bufferToHex(hashBuffer);
  }
  const hash = crypto.createHash("sha256");
  hash.update(typeof input === "string" ? input : Buffer.from(input));
  return hash.digest("hex");
}

export async function computeBlobHash(input: string | Uint8Array): Promise<string> {
  return "sha256-" + await sha256Hex(input);
}
