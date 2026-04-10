import crypto from "crypto";
import http from "http";

export interface TokenSettings {
  googleAccessToken: string;
  googleAccessTokenExpiresAt: number;
  googleRefreshToken: string;
  googleClientId: string;
  googleClientSecret: string;
  googleTokenEndpoint: string;
}

export interface SettingsStore<T> {
  load(): Promise<T>;
  save(value: T): Promise<T>;
}

export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  json(): Promise<any>;
  text(): Promise<string>;
}

export type FetchLike = (url: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}) => Promise<FetchLikeResponse>;

export interface OAuthFlowOptions {
  clientId: string;
  clientSecret?: string;
  tokenEndpoint?: string;
  authorizeEndpoint?: string;
  scope?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  openExternal?: (url: string) => Promise<unknown>;
}

export async function fetchAccessToken(
  settingsStore: SettingsStore<TokenSettings>,
  fetchImpl?: FetchLike
): Promise<string> {
  const settings = await settingsStore.load();
  const now = Date.now();

  if (settings.googleAccessToken && settings.googleAccessTokenExpiresAt > now + 60000) {
    return settings.googleAccessToken;
  }

  if (!settings.googleRefreshToken || !settings.googleClientId || !fetchImpl) {
    return settings.googleAccessToken || "";
  }

  const body = new URLSearchParams({
    client_id: settings.googleClientId,
    client_secret: settings.googleClientSecret || "",
    refresh_token: settings.googleRefreshToken,
    grant_type: "refresh_token"
  });

  const response = await fetchImpl(settings.googleTokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });

  if (!response.ok) {
    throw new Error("Failed to refresh Google access token");
  }

  const payload = await response.json();
  settings.googleAccessToken = payload.access_token || "";
  settings.googleAccessTokenExpiresAt = now + ((payload.expires_in || 3600) * 1000);
  await settingsStore.save(settings);
  return settings.googleAccessToken;
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomVerifier(): string {
  return base64Url(crypto.randomBytes(32));
}

function createCodeChallenge(verifier: string): string {
  return base64Url(crypto.createHash("sha256").update(verifier).digest());
}

export async function exchangeAuthorizationCode(options: {
  fetchImpl: FetchLike;
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<any> {
  const body = new URLSearchParams({
    client_id: options.clientId,
    code: options.code,
    code_verifier: options.codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: options.redirectUri
  });
  if (options.clientSecret) {
    body.set("client_secret", options.clientSecret);
  }

  const response = await options.fetchImpl(options.tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });
  if (!response.ok) {
    throw new Error("Failed to exchange Google OAuth code");
  }
  return response.json();
}

export async function startOAuthFlow(options: OAuthFlowOptions): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  raw: any;
}> {
  const openExternal = options.openExternal || (async (url: string) => {
    return require("electron").shell.openExternal(url);
  });
  const fetchImpl = options.fetchImpl || globalThis.fetch.bind(globalThis) as unknown as FetchLike;
  const authorizeEndpoint = options.authorizeEndpoint || "https://accounts.google.com/o/oauth2/v2/auth";
  const tokenEndpoint = options.tokenEndpoint || "https://oauth2.googleapis.com/token";
  const scope = options.scope || "https://www.googleapis.com/auth/drive.file";
  const timeoutMs = options.timeoutMs || 120000;
  const state = randomVerifier();
  const codeVerifier = randomVerifier();
  const codeChallenge = createCodeChallenge(codeVerifier);

  let server: http.Server | undefined;
  let timeoutHandle: NodeJS.Timeout | undefined;
  try {
    const callback = await new Promise<{ code: string }>((resolve, reject) => {
      server = http.createServer((req, res) => {
        const url = new URL(req.url || "/", "http://127.0.0.1");
        if (url.pathname !== "/callback") {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }
        if (url.searchParams.get("state") !== state) {
          res.statusCode = 400;
          res.end("Invalid OAuth state");
          reject(new Error("Google OAuth state mismatch"));
          return;
        }
        const code = url.searchParams.get("code");
        if (!code) {
          res.statusCode = 400;
          res.end("Missing OAuth code");
          reject(new Error("Missing Google OAuth code"));
          return;
        }
        res.statusCode = 200;
        res.end("Google Drive authentication complete. You can close this window.");
        resolve({ code });
      });
      server.listen(0, "127.0.0.1", async () => {
        const address = server?.address();
        if (!address || typeof address === "string") {
          reject(new Error("OAuth callback server failed to bind"));
          return;
        }
        const redirectUri = "http://127.0.0.1:" + address.port + "/callback";
        const authUrl = authorizeEndpoint + "?" + new URLSearchParams({
          client_id: options.clientId,
          redirect_uri: redirectUri,
          response_type: "code",
          scope,
          access_type: "offline",
          prompt: "consent",
          state,
          code_challenge: codeChallenge,
          code_challenge_method: "S256"
        }).toString();
        try {
          await openExternal(authUrl);
        } catch (error) {
          reject(error);
        }
      });
      timeoutHandle = setTimeout(() => {
        reject(new Error("Google OAuth flow timed out"));
      }, timeoutMs);
    });

    const address = server?.address();
    if (!address || typeof address === "string") {
      throw new Error("OAuth callback server closed unexpectedly");
    }
    const redirectUri = "http://127.0.0.1:" + address.port + "/callback";
    const tokenPayload = await exchangeAuthorizationCode({
      fetchImpl,
      tokenEndpoint,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      code: callback.code,
      codeVerifier,
      redirectUri
    });

    return {
      accessToken: tokenPayload.access_token || "",
      refreshToken: tokenPayload.refresh_token || "",
      expiresAt: Date.now() + ((tokenPayload.expires_in || 3600) * 1000),
      raw: tokenPayload
    };
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    if (server) {
      await new Promise<void>((resolve) => {
        server?.close(() => resolve());
      });
    }
  }
}

export async function revokeToken(options: {
  fetchImpl: FetchLike;
  token: string;
}): Promise<void> {
  const { fetchImpl, token } = options;
  if (!token) return;
  try {
    await fetchImpl(
      `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
      }
    );
  } catch {
    // Best-effort revocation — failure is non-fatal
  }
}
