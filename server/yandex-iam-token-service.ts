import fetch from "node-fetch";
import { createPrivateKey, sign, constants } from "crypto";

interface IamTokenCache {
  token: string;
  expiresAt: number; // timestamp in ms
}

const tokenCache = new Map<string, IamTokenCache>();

// CORRECT endpoint for Service Account IAM tokens
const IAM_ENDPOINT = "https://iam.api.cloud.yandex.net/iam/v1/tokens";
const TOKEN_LIFETIME_MS = 11 * 60 * 60 * 1000; // 11 hours (Yandex gives 12)

export class YandexIamTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YandexIamTokenError";
  }
}

interface ServiceAccountKey {
  id?: string; // key_id
  service_account_id?: string;
  private_key?: string;
}

class YandexIamTokenService {
  /**
   * Get cached IAM token or fetch new one if expired
   * @param serviceAccountKey - JSON service account key from Yandex Cloud
   * @returns Valid IAM token string
   */
  async getIamToken(serviceAccountKey: string, config?: Record<string, unknown>): Promise<string> {
    try {
      let parsed: ServiceAccountKey;
      
      try {
        parsed = JSON.parse(serviceAccountKey);
      } catch (e) {
        throw new YandexIamTokenError(`Failed to parse Service Account Key as JSON: ${e instanceof Error ? e.message : String(e)}`);
      }

      if (!parsed.service_account_id || !parsed.private_key) {
        throw new YandexIamTokenError(
          `Invalid service account key format. Missing: ${!parsed.service_account_id ? 'service_account_id' : ''} ${!parsed.private_key ? 'private_key' : ''}`
        );
      }

      if (!parsed.id) {
        throw new YandexIamTokenError(
          `Invalid service account key format. Missing: id (key_id). Make sure you're using the full Service Account Key JSON from Yandex Cloud.`
        );
      }

      // Decode escape sequences in private key if present
      const privateKey = parsed.private_key.replace(/\\n/g, '\n');

      const cacheKey = `iam_${parsed.service_account_id}`;

      // MODE 1: Use pre-generated IAM token (from config or env variable)
      const manualToken = config?.iamToken as string | undefined;
      const envToken = process.env.YANDEX_IAM_TOKEN;
      const selectedManualToken = manualToken || envToken;

      if (selectedManualToken && config?.iamMode === "manual") {
        console.info(`[yandex-iam] MODE 1: Using pre-generated token from config (manual mode)`);
        if (!selectedManualToken.startsWith("t1.")) {
          throw new YandexIamTokenError("Invalid IAM token format - should start with 't1.'");
        }
        tokenCache.set(cacheKey, {
          token: selectedManualToken,
          expiresAt: Date.now() + TOKEN_LIFETIME_MS,
        });
        return selectedManualToken;
      }

      if (selectedManualToken && !config?.iamMode) {
        console.info(`[yandex-iam] MODE 1: Using pre-generated token from YANDEX_IAM_TOKEN env var`);
        if (!selectedManualToken.startsWith("t1.")) {
          throw new YandexIamTokenError("Invalid IAM token format - should start with 't1.'");
        }
        tokenCache.set(cacheKey, {
          token: selectedManualToken,
          expiresAt: Date.now() + TOKEN_LIFETIME_MS,
        });
        return selectedManualToken;
      }

      const cached = tokenCache.get(cacheKey);

      // Return cached token if still valid (with 5min buffer)
      if (cached && cached.expiresAt > Date.now() + 5 * 60 * 1000) {
        console.info(`[yandex-iam] Using cached token for ${parsed.service_account_id}`);
        return cached.token;
      }

      // MODE 2: Auto-generate token using Service Account Key
      console.info(`[yandex-iam] MODE 2: Fetching new IAM token for ${parsed.service_account_id}`);

      // Create JWT with PS256 algorithm (required by Yandex Cloud)
      const jwt = this.createJwt({
        keyId: parsed.id,
        serviceAccountId: parsed.service_account_id,
        privateKey: privateKey,
      });
      console.info(`[yandex-iam] JWT created with PS256, length: ${jwt.length}`);

      // Request IAM token with JSON body
      console.info(`[yandex-iam] Requesting IAM token from ${IAM_ENDPOINT}`);
      
      const response = await fetch(IAM_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jwt }),
      });

      if (!response.ok) {
        const text = await response.text();
        console.error(`[yandex-iam] Token fetch error: ${response.status} - ${text}`);
        throw new YandexIamTokenError(
          `Failed to get IAM token: ${response.status} - ${text.substring(0, 200)}`
        );
      }

      const data = (await response.json()) as { iamToken?: string; expiresAt?: string };

      if (!data.iamToken) {
        throw new YandexIamTokenError("No iamToken in response");
      }

      const token = data.iamToken;
      
      // Parse expiration time from response
      let expiresAt = Date.now() + TOKEN_LIFETIME_MS;
      if (data.expiresAt) {
        const parsedExpiry = new Date(data.expiresAt).getTime();
        if (!isNaN(parsedExpiry)) {
          expiresAt = parsedExpiry;
        }
      }

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

  private createJwt(params: { keyId: string; serviceAccountId: string; privateKey: string }): string {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + 3600; // 1 hour

    // JWT Header with PS256 algorithm and key ID
    const header = {
      typ: "JWT",
      alg: "PS256",
      kid: params.keyId,
    };

    // JWT Payload with correct audience for Yandex Cloud IAM
    const payload = {
      iss: params.serviceAccountId,
      aud: IAM_ENDPOINT,
      iat: now,
      exp: expiresAt,
    };

    // Base64url encode header and payload
    const headerB64 = this.base64urlEncode(JSON.stringify(header));
    const payloadB64 = this.base64urlEncode(JSON.stringify(payload));

    const message = `${headerB64}.${payloadB64}`;

    // Sign with PS256 (RSA-PSS with SHA-256)
    const signature = this.signWithPS256(message, params.privateKey);

    return `${message}.${signature}`;
  }

  private signWithPS256(message: string, privateKeyPem: string): string {
    try {
      // Create private key object
      const privateKey = createPrivateKey({
        key: privateKeyPem,
        format: 'pem',
      });

      // Sign with RSA-PSS (PS256)
      const signature = sign(
        'sha256',
        Buffer.from(message, 'utf8'),
        {
          key: privateKey,
          padding: constants.RSA_PKCS1_PSS_PADDING,
          saltLength: constants.RSA_PSS_SALTLEN_DIGEST, // 32 bytes for SHA-256
        }
      );

      // Convert to base64url
      return this.base64urlEncode(signature);
    } catch (error) {
      throw new YandexIamTokenError(
        `Failed to sign JWT with PS256: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private base64urlEncode(input: string | Buffer): string {
    const base64 = Buffer.isBuffer(input) 
      ? input.toString('base64')
      : Buffer.from(input, 'utf8').toString('base64');
    
    // Convert to base64url format
    return base64
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }
}

export const yandexIamTokenService = new YandexIamTokenService();
