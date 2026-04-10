import crypto from "crypto";

export function createDeviceId(prefix = "device"): string {
  if (typeof crypto.randomUUID === "function") {
    return prefix + "-" + crypto.randomUUID();
  }
  return prefix + "-" + crypto.randomBytes(8).toString("hex");
}
