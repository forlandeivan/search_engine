import fetch from "node-fetch";
import { createSign } from "crypto";
import type HttpProxyAgent from "http-proxy-agent";
import type HttpsProxyAgent from "https-proxy-agent";

// Runtime imports for agents
const createHttpProxyAgent = (url: string) => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const HttpProxyAgentModule = require("http-proxy-agent");
    return new HttpProxyAgentModule(url);
  } catch {
    return undefined;
  }
};

const createHttpsProxyAgent = (url: string) => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const HttpsProxyAgentModule = require("https-proxy-agent");
    return new HttpsProxyAgentModule(url);
  } catch {
    return undefined;
  }
};

interface IamTokenCache {
  token: string;
  expiresAt: number; // timestamp in ms
}

const tokenCache = new Map<string, IamTokenCache>();

const IAM_ENDPOINT = "https://auth.api.cloud.yandex.net/oauth/token";
const TOKEN_LIFETIME_MS = 11 * 60 * 60 * 1000; // 11 hours (Yandex gives 12)

export class YandexIamTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YandexIamTokenError";
  }
}

class YandexIamTokenService {
  /**
   * Get cached IAM token or fetch new one if expired
   * @param serviceAccountKey - JSON service account key from Yandex Cloud
   * @returns Valid IAM token string
   */
  async getIamToken(serviceAccountKey: string): Promise<string> {
    try {
      const parsed = JSON.parse(serviceAccountKey) as {
        service_account_id?: string;
        private_key?: string;
      };

      if (!parsed.service_account_id || !parsed.private_key) {
        throw new YandexIamTokenError("Invalid service account key format");
      }

      const cacheKey = `iam_${parsed.service_account_id}`;
      const cached = tokenCache.get(cacheKey);

      // Return cached token if still valid (with 5min buffer)
      if (cached && cached.expiresAt > Date.now() + 5 * 60 * 1000) {
        console.info(`[yandex-iam] Using cached token for ${parsed.service_account_id}`);
        return cached.token;
      }

      console.info(`[yandex-iam] Fetching new IAM token for ${parsed.service_account_id}`);

      // Setup proxy agents for network compatibility
      const httpProxyAgent = process.env.HTTP_PROXY ? createHttpProxyAgent(process.env.HTTP_PROXY) : undefined;
      const httpsProxyAgent = process.env.HTTPS_PROXY ? createHttpsProxyAgent(process.env.HTTPS_PROXY) : undefined;

      // Build fetch options with optional agent
      const fetchOptions: Parameters<typeof fetch>[1] = {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion: this.createJwt(parsed),
        }).toString(),
      };

      // Only add agent if one was successfully created
      const selectedAgent = IAM_ENDPOINT.startsWith("https") ? httpsProxyAgent : httpProxyAgent;
      if (selectedAgent) {
        fetchOptions.agent = selectedAgent;
      }

      // Request new token
      const response = await fetch(IAM_ENDPOINT, fetchOptions);

      if (!response.ok) {
        const text = await response.text();
        console.error(`[yandex-iam] Token fetch error: ${response.status} - ${text}`);
        throw new YandexIamTokenError(
          `Failed to get IAM token: ${response.status} - ${text.substring(0, 100)}`
        );
      }

      const data = (await response.json()) as { access_token?: string; expires_in?: number };

      if (!data.access_token) {
        throw new YandexIamTokenError("No access token in response");
      }

      const token = data.access_token;
      const expiresIn = (data.expires_in ?? 3600) * 1000; // Convert seconds to ms
      const expiresAt = Date.now() + Math.min(expiresIn, TOKEN_LIFETIME_MS);

      // Cache for next use
      tokenCache.set(cacheKey, { token, expiresAt });

      console.info(
        `[yandex-iam] Token obtained, expires in ${Math.round((expiresAt - Date.now()) / 1000 / 60)} minutes`
      );

      return token;
    } catch (error) {
      if (error instanceof YandexIamTokenError) {
        throw error;
      }
      throw new YandexIamTokenError(
        `Error getting IAM token: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private createJwt(serviceAccount: { service_account_id?: string; private_key?: string }): string {
    // Standard JWT for Yandex Cloud
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + 3600;

    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64");
    const payload = Buffer.from(
      JSON.stringify({
        iss: serviceAccount.service_account_id,
        sub: serviceAccount.service_account_id,
        aud: "https://auth.api.cloud.yandex.net/oauth/token",
        iat: now,
        exp: expiresAt,
      })
    ).toString("base64");

    const signature = this.signJwt(`${header}.${payload}`, serviceAccount.private_key || "");

    return `${header}.${payload}.${signature}`;
  }

  private signJwt(message: string, privateKey: string): string {
    const signer = createSign("RSA-SHA256");
    signer.update(message);
    const signature = signer.sign(privateKey, "base64");
    return signature.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  }
}

export const yandexIamTokenService = new YandexIamTokenService();
