import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const SECRET_KEY_RAW = (process.env.NO_CODE_BEARER_SECRET || process.env.APP_SECRET || "").padEnd(32, "0").slice(0, 32);
const SECRET_KEY = Buffer.from(SECRET_KEY_RAW, "utf8");
const HAS_SECRET_KEY = SECRET_KEY_RAW.trim().length > 0;

function buildCipher(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", SECRET_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { iv, ciphertext, authTag };
}

export function encryptSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!HAS_SECRET_KEY) return value;
  try {
    const { iv, ciphertext, authTag } = buildCipher(value);
    return `enc.v1.${iv.toString("base64")}.${authTag.toString("base64")}.${ciphertext.toString("base64")}`;
  } catch {
    return value;
  }
}

export function decryptSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("enc.v1.")) return value;
  if (!HAS_SECRET_KEY) return null;
  const [, , ivB64, tagB64, dataB64] = value.split(".");
  if (!ivB64 || !tagB64 || !dataB64) return null;
  try {
    const iv = Buffer.from(ivB64, "base64");
    const authTag = Buffer.from(tagB64, "base64");
    const ciphertext = Buffer.from(dataB64, "base64");
    const decipher = createDecipheriv("aes-256-gcm", SECRET_KEY, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    return plaintext;
  } catch {
    return null;
  }
}

export function hasSecretKey(): boolean {
  return HAS_SECRET_KEY;
}
