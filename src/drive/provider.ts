export const GOOGLE_DRIVE_BACKEND_CAPABILITIES = {
  providerId: "google-drive",
  publicProviderApi: false,
  snapshotModes: ["inplace", "generations"]
};

export function supportsSnapshotMode(capabilities: any, mode: string): boolean {
  return Array.isArray(capabilities.snapshotModes) && capabilities.snapshotModes.indexOf(mode) !== -1;
}
