import { storage } from "./storage";
import { log } from "./vite";

const STATIC_HOSTNAME_ENV_KEYS = [
  "STATIC_ALLOWED_HOSTNAMES",
  "STATIC_ALLOWED_ORIGINS",
  "ALLOWED_HOSTNAMES",
  "ALLOWED_ORIGINS",
  "PUBLIC_APP_URL",
  "PUBLIC_APP_HOSTNAME",
  "APP_DOMAIN",
  "PUBLIC_DOMAIN",
  "FRONTEND_DOMAIN",
  "FRONTEND_URL",
  "PUBLIC_URL",
  "CUSTOM_DOMAIN",
  "APP_BASE_URL",
  "BASE_URL",
  "APP_HOSTNAME",
  "PRIMARY_DOMAIN",
];

let staticHostnamesLogged = false;

function normalizeHostname(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const candidate = trimmed.startsWith("http://") || trimmed.startsWith("https://")
    ? trimmed
    : `https://${trimmed}`;

  try {
    const hostname = new URL(candidate).hostname.trim();
    if (hostname) {
      return hostname.toLowerCase();
    }
  } catch {
    const withoutScheme = trimmed.replace(/^[a-z]+:\/\//i, "");
    const withoutPath = withoutScheme.split(/[/?#]/, 1)[0] ?? "";
    const hostname = withoutPath.split(":", 1)[0]?.trim() ?? "";
    if (hostname) {
      return hostname.toLowerCase();
    }
  }

  return null;
}

export function getStaticCorsHostnames(): Set<string> {
  const hostnames = new Set<string>();

  for (const key of STATIC_HOSTNAME_ENV_KEYS) {
    const rawValue = process.env[key];
    if (!rawValue) {
      continue;
    }

    const parts = rawValue
      .split(/[,\s]+/)
      .map(part => part.trim())
      .filter(Boolean);

    for (const part of parts) {
      const normalized = normalizeHostname(part);
      if (normalized) {
        hostnames.add(normalized);
      }
    }
  }

  if (hostnames.size > 0 && !staticHostnamesLogged) {
    log(
      `CORS: статически разрешённые домены из переменных окружения: [${Array.from(hostnames).join(", ")}]`,
    );
    staticHostnamesLogged = true;
  }

  return hostnames;
}

// CORS hostname cache with TTL
interface HostnameCache {
  hostnames: Set<string>;
  timestamp: number;
}

let corsCache: HostnameCache | null = null;
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

// Function to refresh the CORS hostname cache
export async function refreshCorsCache(): Promise<Set<string>> {
  try {
    const sites = await storage.getAllSites();
    const staticHostnames = getStaticCorsHostnames();
    const hostnames = new Set<string>(staticHostnames);

    // Add Tilda domains
    hostnames.add('tilda.ws');

    // Process database sites and extract hostnames
    for (const site of sites) {
      const urlsToProcess = site.startUrls?.length ? site.startUrls : site.url ? [site.url] : [];

      for (const rawUrl of urlsToProcess) {
        if (!rawUrl) {
          continue;
        }
        try {
          const url = new URL(rawUrl);
          hostnames.add(url.hostname);
        } catch (urlError) {
          log(`CORS cache: Invalid URL in database: ${rawUrl} - ${urlError}`);
        }
      }
    }

    // Update cache
    corsCache = {
      hostnames,
      timestamp: Date.now()
    };

    log(`CORS cache refreshed with ${hostnames.size} hostnames: [${Array.from(hostnames).join(', ')}]`);
    return hostnames;
  } catch (error) {
    const staticHostnames = getStaticCorsHostnames();
    const fallbackHostnames = new Set<string>(staticHostnames);
    fallbackHostnames.add('tilda.ws');

    log(`CORS cache refresh error: ${error}`);
    if (fallbackHostnames.size > 0) {
      log(
        `CORS: используется статический список доменов (${fallbackHostnames.size}) из переменных окружения`,
      );
    }

    corsCache = {
      hostnames: fallbackHostnames,
      timestamp: Date.now(),
    };

    return fallbackHostnames;
  }
}

// Function to invalidate CORS cache (exported for use in routes)
export function invalidateCorsCache(): void {
  if (corsCache) {
    log(`CORS cache invalidated (was: ${corsCache.hostnames.size} hostnames)`);
    corsCache = null;
  }
}

// Function to get current allowed hostnames (with cache)
export async function getAllowedHostnames(): Promise<Set<string>> {
  const now = Date.now();
  
  // Check if cache is valid
  if (corsCache && (now - corsCache.timestamp) < CACHE_TTL_MS) {
    return corsCache.hostnames;
  }
  
  // Cache is stale or doesn't exist, refresh it
  return await refreshCorsCache();
}