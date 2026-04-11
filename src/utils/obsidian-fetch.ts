export function createObsidianFetch(obsidianModule: any) {
  return async function obsidianFetch(url: string, init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Buffer | Uint8Array;
  }) {
    const nativeFetch = typeof globalThis.fetch === "function"
      ? globalThis.fetch.bind(globalThis)
      : null;
    const body = init && init.body;
    const headers = init && init.headers ? { ...init.headers } : {};
    const contentTypeHeader = Object.keys(headers).find((key) => key.toLowerCase() === "content-type");
    const contentType = contentTypeHeader ? headers[contentTypeHeader] : "";
    const shouldPreferNativeFetch = Boolean(
      nativeFetch && (
        Buffer.isBuffer(body) ||
        body instanceof Uint8Array ||
        /multipart\/related/i.test(contentType) ||
        /application\/octet-stream/i.test(contentType)
      )
    );

    if (shouldPreferNativeFetch || typeof obsidianModule.requestUrl !== "function") {
      if (!nativeFetch) {
        throw new Error("No fetch implementation available for Google Drive request");
      }
      return nativeFetch(url, init as any);
    }

    const options = {
      url,
      method: (init && init.method) || "GET",
      headers,
      body: body ? body : undefined,
      throw: false
    };
    const result = await obsidianModule.requestUrl(options);
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      headers: {
        get(name: string) {
          const lower = name.toLowerCase();
          const resultHeaders = result.headers || {};
          for (const key in resultHeaders) {
            if (key.toLowerCase() === lower) return resultHeaders[key];
          }
          return null;
        }
      },
      text() {
        return Promise.resolve(typeof result.text === "string" ? result.text : JSON.stringify(result.json));
      },
      json() {
        return Promise.resolve(result.json);
      },
      arrayBuffer() {
        if (result.arrayBuffer) {
          return Promise.resolve(result.arrayBuffer);
        }
        return Promise.resolve(Buffer.from(typeof result.text === "string" ? result.text : JSON.stringify(result.json)));
      }
    };
  };
}
