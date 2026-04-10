export interface DiffCommCommonRegion {
  common: string[];
}

export interface DiffCommChangeRegion {
  left: string[];
  right: string[];
}

export type DiffCommRegion = DiffCommCommonRegion | DiffCommChangeRegion;

export interface Diff3OkRegion {
  ok: string[];
}

export interface Diff3ConflictRegion {
  conflict: {
    local: string[];
    base: string[];
    remote: string[];
  };
}

export type Diff3Region = Diff3OkRegion | Diff3ConflictRegion;

export interface Merge3Options {
  localLabel?: string;
  remoteLabel?: string;
}

export interface Merge3Result {
  merged: string;
  hasConflicts: boolean;
  conflictCount: number;
}

function lcs(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = new Array(n + 1);
  for (let i = 0; i <= n; i += 1) {
    dp[i] = new Uint32Array(m + 1);
  }

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = dp[i - 1][j] > dp[i][j - 1] ? dp[i - 1][j] : dp[i][j - 1];
      }
    }
  }

  const pairs: Array<[number, number]> = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      pairs.push([i - 1, j - 1]);
      i -= 1;
      j -= 1;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  pairs.reverse();
  return pairs;
}

function mergeAdjacentCommon(regions: DiffCommRegion[]): DiffCommRegion[] {
  if (regions.length === 0) return regions;
  const out = [regions[0]];
  for (let i = 1; i < regions.length; i += 1) {
    const prev = out[out.length - 1] as DiffCommRegion;
    const cur = regions[i] as DiffCommRegion;
    if ("common" in prev && "common" in cur) {
      prev.common = prev.common.concat(cur.common);
    } else {
      out.push(cur);
    }
  }
  return out;
}

export function diffComm(a: string[], b: string[]): DiffCommRegion[] {
  const pairs = lcs(a, b);
  const regions: DiffCommRegion[] = [];

  let ai = 0;
  let bi = 0;

  for (const [pa, pb] of pairs) {
    if (ai < pa || bi < pb) {
      regions.push({ left: a.slice(ai, pa), right: b.slice(bi, pb) });
    }
    regions.push({ common: [a[pa]] });
    ai = pa + 1;
    bi = pb + 1;
  }

  if (ai < a.length || bi < b.length) {
    regions.push({ left: a.slice(ai), right: b.slice(bi) });
  }

  return mergeAdjacentCommon(regions);
}

function computeEdits(base: string[], target: string[]): Array<{ baseStart: number; baseEnd: number; lines: string[] }> {
  const pairs = lcs(base, target);
  const edits: Array<{ baseStart: number; baseEnd: number; lines: string[] }> = [];

  let bi = 0;
  let ti = 0;

  for (const [pb, pt] of pairs) {
    if (bi < pb || ti < pt) {
      edits.push({
        baseStart: bi,
        baseEnd: pb,
        lines: target.slice(ti, pt)
      });
    }
    bi = pb + 1;
    ti = pt + 1;
  }

  if (bi < base.length || ti < target.length) {
    edits.push({
      baseStart: bi,
      baseEnd: base.length,
      lines: target.slice(ti)
    });
  }

  return edits;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
}

function pushOk(result: Diff3Region[], lines: string[]): void {
  if (lines.length === 0) return;
  const last = result.length > 0 ? result[result.length - 1] : null;
  if (last && "ok" in last) {
    last.ok = last.ok.concat(lines);
  } else {
    result.push({ ok: lines.slice() });
  }
}

function mergeAdjacentOk(regions: Diff3Region[]): Diff3Region[] {
  if (regions.length === 0) return regions;
  const out = [regions[0]];
  for (let i = 1; i < regions.length; i += 1) {
    const prev = out[out.length - 1];
    const cur = regions[i];
    if ("ok" in prev && "ok" in cur) {
      prev.ok = prev.ok.concat(cur.ok);
    } else {
      out.push(cur);
    }
  }
  return out;
}

export function diff3Merge(localLines: string[], baseLines: string[], remoteLines: string[]): Diff3Region[] {
  const localEdits = computeEdits(baseLines, localLines);
  const remoteEdits = computeEdits(baseLines, remoteLines);

  const result: Diff3Region[] = [];
  let baseIdx = 0;
  let li = 0;
  let ri = 0;

  while (li < localEdits.length || ri < remoteEdits.length || baseIdx < baseLines.length) {
    const le = li < localEdits.length ? localEdits[li] : null;
    const re = ri < remoteEdits.length ? remoteEdits[ri] : null;

    const leStart = le ? le.baseStart : baseLines.length;
    const reStart = re ? re.baseStart : baseLines.length;
    const nextEdit = Math.min(leStart, reStart);

    if (baseIdx < nextEdit) {
      pushOk(result, baseLines.slice(baseIdx, nextEdit));
      baseIdx = nextEdit;
    }

    if (baseIdx >= baseLines.length && !le && !re) break;

    if (le && re && le.baseStart === re.baseStart) {
      const overlapEnd = Math.max(le.baseEnd, re.baseEnd);
      if (arraysEqual(le.lines, re.lines) && le.baseEnd === re.baseEnd) {
        pushOk(result, le.lines);
        baseIdx = le.baseEnd;
        li += 1;
        ri += 1;
      } else {
        let localConflictLines = le.lines.slice();
        let localEnd = le.baseEnd;
        li += 1;
        while (li < localEdits.length && localEdits[li].baseStart < overlapEnd) {
          if (localEdits[li].baseStart > localEnd) {
            localConflictLines = localConflictLines.concat(baseLines.slice(localEnd, localEdits[li].baseStart));
          }
          localConflictLines = localConflictLines.concat(localEdits[li].lines);
          localEnd = localEdits[li].baseEnd;
          li += 1;
        }

        let remoteConflictLines = re.lines.slice();
        let remoteEnd = re.baseEnd;
        ri += 1;
        while (ri < remoteEdits.length && remoteEdits[ri].baseStart < overlapEnd) {
          if (remoteEdits[ri].baseStart > remoteEnd) {
            remoteConflictLines = remoteConflictLines.concat(baseLines.slice(remoteEnd, remoteEdits[ri].baseStart));
          }
          remoteConflictLines = remoteConflictLines.concat(remoteEdits[ri].lines);
          remoteEnd = remoteEdits[ri].baseEnd;
          ri += 1;
        }

        result.push({
          conflict: {
            local: localConflictLines,
            base: baseLines.slice(le.baseStart, overlapEnd),
            remote: remoteConflictLines
          }
        });
        baseIdx = overlapEnd;
      }
    } else if (le && leStart <= reStart) {
      if (re && le.baseEnd > re.baseStart) {
        const overlapEnd = Math.max(le.baseEnd, re.baseEnd);
        result.push({
          conflict: {
            local: le.lines,
            base: baseLines.slice(le.baseStart, overlapEnd),
            remote: re.lines
          }
        });
        baseIdx = overlapEnd;
        li += 1;
        ri += 1;
      } else {
        pushOk(result, le.lines);
        baseIdx = le.baseEnd;
        li += 1;
      }
    } else if (re) {
      if (le && re.baseEnd > le.baseStart) {
        const overlapEnd = Math.max(le.baseEnd, re.baseEnd);
        result.push({
          conflict: {
            local: le.lines,
            base: baseLines.slice(re.baseStart, overlapEnd),
            remote: re.lines
          }
        });
        baseIdx = overlapEnd;
        li += 1;
        ri += 1;
      } else {
        pushOk(result, re.lines);
        baseIdx = re.baseEnd;
        ri += 1;
      }
    } else {
      if (baseIdx < baseLines.length) {
        pushOk(result, baseLines.slice(baseIdx));
        baseIdx = baseLines.length;
      }
      break;
    }
  }

  if (baseIdx < baseLines.length) {
    pushOk(result, baseLines.slice(baseIdx));
  }

  return mergeAdjacentOk(result);
}

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

export function merge3(localText: string, baseText: string, remoteText: string, options: Merge3Options = {}): Merge3Result {
  const localLabel = options.localLabel || "local";
  const remoteLabel = options.remoteLabel || "remote";

  const localLines = splitLines(localText);
  const baseLines = splitLines(baseText);
  const remoteLines = splitLines(remoteText);
  const regions = diff3Merge(localLines, baseLines, remoteLines);

  const outputParts: string[] = [];
  let conflictCount = 0;

  for (const region of regions) {
    if ("ok" in region) {
      outputParts.push(region.ok.join("\n"));
    } else if ("conflict" in region) {
      conflictCount += 1;
      outputParts.push(
        "<<<<<<< " + localLabel + "\n" +
        region.conflict.local.join("\n") + "\n" +
        "=======\n" +
        region.conflict.remote.join("\n") + "\n" +
        ">>>>>>> " + remoteLabel
      );
    }
  }

  let merged = outputParts.join("\n");
  if (
    (localText.length > 0 && localText[localText.length - 1] === "\n") ||
    (remoteText.length > 0 && remoteText[remoteText.length - 1] === "\n") ||
    (baseText.length > 0 && baseText[baseText.length - 1] === "\n")
  ) {
    if (merged.length > 0 && merged[merged.length - 1] !== "\n") {
      merged += "\n";
    }
  }

  return {
    merged,
    hasConflicts: conflictCount > 0,
    conflictCount
  };
}
