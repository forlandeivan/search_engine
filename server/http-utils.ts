import { Agent as HttpsAgent } from "https";
import { Headers, type RequestInit as FetchRequestInit } from "node-fetch";

export type NodeFetchOptions = FetchRequestInit & { agent?: HttpsAgent };

const insecureTlsAgent = new HttpsAgent({ rejectUnauthorized: false });

export function applyTlsPreferences<T extends NodeFetchOptions>(
  options: T,
  allowSelfSignedCertificate: boolean,
): T {
  if (!allowSelfSignedCertificate) {
    return options;
  }

  return {
    ...options,
    agent: insecureTlsAgent,
  };
}

export interface ApiRequestLog {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export function sanitizeHeadersForLog(headers: Headers): Record<string, string> {
  const sanitized: Record<string, string> = {};

  for (const [key, value] of headers.entries()) {
    if (key.toLowerCase().includes("authorization")) {
      sanitized[key] = "***";
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
