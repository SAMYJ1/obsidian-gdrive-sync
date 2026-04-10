import crypto from "crypto";

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const hash = crypto.createHash("sha256");
  hash.update(typeof input === "string" ? input : Buffer.from(input));
  return hash.digest("hex");
}

export async function computeBlobHash(input: string | Uint8Array): Promise<string> {
  return "sha256:" + await sha256Hex(input);
}
