export const BUILT_IN_IGNORE_PATHS: string[] = [
  ".obsidian/plugins/obsidian-gdrive-sync/runtime-state.json",
  ".obsidian/plugins/obsidian-gdrive-sync/data.json",
  ".obsidian/workspace.json",
  ".obsidian/workspace-mobile.json",
  ".trash/**",
  ".DS_Store"
];

function globMatch(text: string, pattern: string): boolean {
  const re = "^" + pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "§DOUBLESTAR§")
    .replace(/\*/g, "[^/]*")
    .replace(/§DOUBLESTAR§/g, ".*")
    .replace(/\?/g, "[^/]") + "$";
  return new RegExp(re).test(text);
}

function matchesPattern(filePath: string, pattern: string): boolean {
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return filePath === prefix || filePath.indexOf(prefix + "/") === 0;
  }
  if (!pattern.includes("/") && pattern.includes("*")) {
    const fileName = filePath.split("/").pop() || "";
    return globMatch(fileName, pattern);
  }
  if (pattern.includes("*") || pattern.includes("?")) {
    return globMatch(filePath, pattern);
  }
  return filePath === pattern;
}

export function isIgnoredPath(filePath: string, extraPatterns: string[] = []): boolean {
  const patterns = BUILT_IN_IGNORE_PATHS.concat(extraPatterns || []);
  let ignored = false;
  patterns.forEach((pattern) => {
    if (!pattern) {
      return;
    }
    const negated = pattern.charAt(0) === "!";
    const candidate = negated ? pattern.slice(1) : pattern;
    if (matchesPattern(filePath, candidate)) {
      ignored = !negated;
    }
  });
  return ignored;
}
