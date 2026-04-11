function isUint8ArrayLikeObject(value: unknown): value is Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  if (keys.length === 0) {
    return false;
  }
  return keys.every((key) => /^\d+$/.test(key));
}

function toUint8Array(value: Uint8Array | Record<string, number>): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  const keys = Object.keys(value).sort((a, b) => Number(a) - Number(b));
  return new Uint8Array(keys.map((key) => value[key]));
}

function serializeContentContainer(container: any): any {
  if (!container || typeof container !== "object") {
    return container;
  }
  const next = { ...container };
  if (next.content instanceof Uint8Array) {
    next.content = Buffer.from(next.content).toString("base64");
    next._contentEncoding = "base64";
  }
  return next;
}

function restoreContentContainer(container: any): any {
  if (!container || typeof container !== "object") {
    return container;
  }
  const next = { ...container };
  if (next._contentEncoding === "base64" && typeof next.content === "string") {
    next.content = new Uint8Array(Buffer.from(next.content, "base64"));
    delete next._contentEncoding;
    return next;
  }
  if (isUint8ArrayLikeObject(next.content)) {
    next.content = toUint8Array(next.content);
  }
  return next;
}

export function prepareLocalStateForStorage(state: any): any {
  if (!state || typeof state !== "object") {
    return state;
  }
  const next = { ...state };
  if (Array.isArray(next.outbox)) {
    next.outbox = next.outbox.map((entry: any) => serializeContentContainer(entry));
  }
  if (next.files && typeof next.files === "object") {
    next.files = Object.fromEntries(
      Object.entries(next.files).map(([filePath, record]) => [filePath, serializeContentContainer(record)])
    );
  }
  return next;
}

export function restoreLocalStateFromStorage(state: any): any {
  if (!state || typeof state !== "object") {
    return state;
  }
  const next = { ...state };
  if (Array.isArray(next.outbox)) {
    next.outbox = next.outbox.map((entry: any) => restoreContentContainer(entry));
  }
  if (next.files && typeof next.files === "object") {
    next.files = Object.fromEntries(
      Object.entries(next.files).map(([filePath, record]) => [filePath, restoreContentContainer(record)])
    );
  }
  return next;
}

export function stripLocalStateContent(state: any): any {
  if (!state || typeof state !== "object") {
    return state;
  }
  const next = { ...state };
  if (Array.isArray(next.outbox)) {
    next.outbox = next.outbox.map((entry: any) => {
      if (!entry || typeof entry !== "object" || !("content" in entry)) {
        return entry;
      }
      const sanitized = { ...entry };
      delete sanitized.content;
      delete sanitized._contentEncoding;
      return sanitized;
    });
  }
  if (next.files && typeof next.files === "object") {
    next.files = Object.fromEntries(
      Object.entries(next.files).map(([filePath, record]) => {
        if (!record || typeof record !== "object" || !("content" in record)) {
          return [filePath, record];
        }
        const sanitized = { ...(record as Record<string, unknown>) };
        delete sanitized.content;
        delete sanitized._contentEncoding;
        return [filePath, sanitized];
      })
    );
  }
  return next;
}
