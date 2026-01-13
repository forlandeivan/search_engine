import { randomUUID } from "crypto";
import fetch, { Headers, type Response as FetchResponse } from "node-fetch";
import type { EmbeddingProvider, LlmProvider } from "@shared/schema";
import { applyTlsPreferences, type NodeFetchOptions } from "./http-utils";

export type OAuthProviderConfig = Pick<
  EmbeddingProvider | LlmProvider,
  "tokenUrl" | "authorizationKey" | "scope" | "requestHeaders" | "allowSelfSignedCertificate"
>;

type CachedAccessToken = {
  token: string;
  expiresAt: number;
};

const oauthTokenCache = new Map<string, CachedAccessToken>();
const oauthTokenPromises = new Map<string, Promise<string>>();

const OAUTH_TOKEN_EXPIRY_FALLBACK_MS = 55 * 60 * 1000;
const OAUTH_TOKEN_EXPIRY_MIN_MS = 30_000;
const OAUTH_TOKEN_EXPIRY_SAFETY_MS = 10_000;

/**
 * Определяет, требуется ли аутентификация для провайдера.
 * Проверяет тип провайдера и наличие валидного tokenUrl.
 */
function requiresAuthentication(provider: OAuthProviderConfig & Partial<LlmProvider>): boolean {
  // AITunnel использует API-ключ без OAuth
  if (provider.providerType === "aitunnel") {
    return false;
  }

  // Проверяем наличие и валидность tokenUrl
  const tokenUrl = provider.tokenUrl?.trim();
  if (!tokenUrl || tokenUrl.length === 0) {
    return false;
  }

  // Проверяем, что это валидный URL
  try {
    new URL(tokenUrl);
    return true;
  } catch {
    return false;
  }
}

function buildOAuthCacheKey(provider: OAuthProviderConfig): string {
  const sortedHeaders = Object.entries(provider.requestHeaders ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value}`)
    .join(",");

  return JSON.stringify({
    tokenUrl: provider.tokenUrl,
    authorizationKey: provider.authorizationKey,
    scope: provider.scope ?? "",
    headers: sortedHeaders,
  });
}

export async function fetchAccessToken(provider: OAuthProviderConfig): Promise<string> {
  // AITunnel использует API-ключ без OAuth.
  if ((provider as Partial<LlmProvider>).providerType === "aitunnel") {
    return provider.authorizationKey.trim();
  }

  // Если аутентификация не требуется (нет валидного tokenUrl), возвращаем пустую строку
  if (!requiresAuthentication(provider as OAuthProviderConfig & Partial<LlmProvider>)) {
    return "";
  }

  const cacheKey = buildOAuthCacheKey(provider);
  const now = Date.now();
  const cachedToken = oauthTokenCache.get(cacheKey);

  if (cachedToken && cachedToken.expiresAt > now) {
    return cachedToken.token;
  }

  const pendingToken = oauthTokenPromises.get(cacheKey);
  if (pendingToken) {
    return pendingToken;
  }

  const fallbackSeconds = Math.floor(OAUTH_TOKEN_EXPIRY_FALLBACK_MS / 1000);
  const fallbackBaseMs = fallbackSeconds * 1000 - OAUTH_TOKEN_EXPIRY_SAFETY_MS;
  const fallbackTtlMs = Math.max(OAUTH_TOKEN_EXPIRY_MIN_MS, fallbackBaseMs);

  const tokenPromise = requestAccessToken(provider)
    .then(({ token, expiresInSeconds }) => {
      let ttlMs = fallbackTtlMs;
      if (typeof expiresInSeconds === "number" && Number.isFinite(expiresInSeconds)) {
        if (expiresInSeconds <= 0) {
          ttlMs = 0;
        } else {
          const baseMs = Math.max(0, expiresInSeconds * 1000 - OAUTH_TOKEN_EXPIRY_SAFETY_MS);
          ttlMs = Math.max(1_000, baseMs);
        }
      }
      if (ttlMs > 0) {
        oauthTokenCache.set(cacheKey, { token, expiresAt: Date.now() + ttlMs });
      } else {
        oauthTokenCache.delete(cacheKey);
      }
      return token;
    })
    .catch((error) => {
      oauthTokenCache.delete(cacheKey);
      throw error;
    });

  oauthTokenPromises.set(cacheKey, tokenPromise);

  try {
    return await tokenPromise;
  } finally {
    oauthTokenPromises.delete(cacheKey);
  }
}

async function requestAccessToken(
  provider: OAuthProviderConfig,
): Promise<{ token: string; expiresInSeconds?: number }> {
  // Проверяем валидность tokenUrl перед выполнением запроса
  const tokenUrl = provider.tokenUrl?.trim();
  if (!tokenUrl || tokenUrl.length === 0) {
    throw new Error("tokenUrl не настроен для провайдера");
  }

  try {
    new URL(tokenUrl);
  } catch {
    throw new Error(`tokenUrl имеет невалидный формат: ${tokenUrl}`);
  }

  const tokenHeaders = new Headers();
  const rawAuthorizationKey = provider.authorizationKey.trim();
  const hasAuthScheme = /^(?:[A-Za-z]+)\s+\S+/.test(rawAuthorizationKey);
  const authorizationHeader = hasAuthScheme ? rawAuthorizationKey : `Basic ${rawAuthorizationKey}`;

  tokenHeaders.set("Authorization", authorizationHeader);
  tokenHeaders.set("Content-Type", "application/x-www-form-urlencoded");
  tokenHeaders.set("Accept", "application/json");

  if (!tokenHeaders.has("RqUID")) {
    tokenHeaders.set("RqUID", randomUUID());
  }

  for (const [key, value] of Object.entries(provider.requestHeaders ?? {})) {
    tokenHeaders.set(key, value);
  }

  const tokenRequestBody = new URLSearchParams({
    scope: provider.scope,
    grant_type: "client_credentials",
  }).toString();

  let tokenResponse: FetchResponse;

  try {
    const requestOptions = applyTlsPreferences<NodeFetchOptions>(
      {
        method: "POST",
        headers: tokenHeaders,
        body: tokenRequestBody,
      },
      provider.allowSelfSignedCertificate,
    );

    tokenResponse = await fetch(tokenUrl, requestOptions);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (!provider.allowSelfSignedCertificate && errorMessage.toLowerCase().includes("self-signed certificate")) {
      throw new Error(
        "Не удалось подключиться к провайдеру LLM: сервер не доверяет сертификату. Разрешите самоподписанные сертификаты в настройках провайдера.",
      );
    }

    throw new Error(`Не удалось выполнить запрос токена у провайдера LLM: ${errorMessage}`);
  }

  if (!tokenResponse.ok) {
    const responseText = await tokenResponse.text();
    let message = `Провайдер вернул ошибку ${tokenResponse.status}`;

    try {
      const parsed = JSON.parse(responseText) as Record<string, unknown>;
      if (typeof parsed.error_description === "string") {
        message = parsed.error_description;
      } else if (typeof parsed.message === "string") {
        message = parsed.message;
      }
    } catch {
      if (responseText.trim().length > 0) {
        message = responseText.trim();
      }
    }

    throw new Error(message);
  }

  const body = (await tokenResponse.json()) as Record<string, unknown>;
  const accessToken = typeof body.access_token === "string" ? body.access_token : null;

  if (!accessToken) {
    throw new Error("Провайдер не вернул access_token");
  }

  const expiresInSeconds =
    typeof body.expires_in === "number" && Number.isFinite(body.expires_in)
      ? (body.expires_in as number)
      : undefined;

  return { token: accessToken, expiresInSeconds };
}

export function clearAccessTokenCache() {
  oauthTokenCache.clear();
  oauthTokenPromises.clear();
}

/**
 * Очищает кеш токена для конкретного провайдера
 * Используется при ошибках аутентификации для принудительного обновления токена
 */
export function clearProviderAccessTokenCache(provider: OAuthProviderConfig): void {
  // AITunnel использует API-ключ без OAuth, кеш не нужен
  if ((provider as Partial<LlmProvider>).providerType === "aitunnel") {
    return;
  }

  const cacheKey = buildOAuthCacheKey(provider);
  oauthTokenCache.delete(cacheKey);
  oauthTokenPromises.delete(cacheKey);
}
