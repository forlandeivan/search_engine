export const DEMO_INTEGRATIONS_STORAGE_KEY = "unica-demo-integrations-actions-v1";
export const DEMO_INTEGRATION_TOGGLES_STORAGE_KEY = "unica-demo-integrations-toggles-v1";
export const DEMO_INTEGRATIONS_UPDATED_EVENT = "unica-demo-integrations-updated";

export type DemoIntegrationActionSet = {
  integrationId: string;
  integrationName: string;
  buttonLabel: string;
  actions: string[];
};

type DemoIntegrationStoragePayload = {
  version: 1;
  updatedAt: string;
  integrations: DemoIntegrationActionSet[];
};

type DemoIntegrationTogglesPayload = {
  version: 1;
  updatedAt: string;
  enabledIntegrationIds: string[];
};

function isClientEnvironment(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.localStorage !== "undefined" &&
    typeof window.sessionStorage !== "undefined"
  );
}

function readStorageItem(key: string): string | null {
  if (!isClientEnvironment()) return null;

  try {
    const localRaw = window.localStorage.getItem(key);
    if (localRaw !== null) {
      try {
        window.sessionStorage.setItem(key, localRaw);
      } catch {
        // ignore
      }
      return localRaw;
    }
  } catch {
    // ignore
  }

  try {
    const sessionRaw = window.sessionStorage.getItem(key);
    if (sessionRaw !== null) {
      try {
        window.localStorage.setItem(key, sessionRaw);
      } catch {
        // ignore
      }
      return sessionRaw;
    }
  } catch {
    // ignore
  }

  return null;
}

function writeStorageItem(key: string, value: string): void {
  if (!isClientEnvironment()) return;

  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }

  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function normalizeActionSet(value: unknown): DemoIntegrationActionSet | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<DemoIntegrationActionSet>;
  if (
    typeof candidate.integrationId !== "string" ||
    typeof candidate.integrationName !== "string" ||
    typeof candidate.buttonLabel !== "string" ||
    !Array.isArray(candidate.actions)
  ) {
    return null;
  }

  const actions = candidate.actions.filter((action): action is string => typeof action === "string" && action.trim().length > 0);
  if (actions.length === 0) {
    return null;
  }

  return {
    integrationId: candidate.integrationId,
    integrationName: candidate.integrationName,
    buttonLabel: candidate.buttonLabel,
    actions,
  };
}

function emitDemoIntegrationsUpdated(): void {
  if (!isClientEnvironment()) return;
  window.dispatchEvent(new CustomEvent(DEMO_INTEGRATIONS_UPDATED_EVENT));
}

export function readEnabledDemoIntegrations(): DemoIntegrationActionSet[] {
  if (!isClientEnvironment()) return [];

  const raw = readStorageItem(DEMO_INTEGRATIONS_STORAGE_KEY);
  if (!raw) return [];

  try {
    const payload = JSON.parse(raw) as Partial<DemoIntegrationStoragePayload>;
    const integrationsRaw = Array.isArray(payload.integrations) ? payload.integrations : [];
    return integrationsRaw
      .map((integration) => normalizeActionSet(integration))
      .filter((integration): integration is DemoIntegrationActionSet => integration !== null);
  } catch {
    return [];
  }
}

export function writeEnabledDemoIntegrations(integrations: DemoIntegrationActionSet[]): void {
  if (!isClientEnvironment()) return;

  const normalized = integrations
    .map((integration) => normalizeActionSet(integration))
    .filter((integration): integration is DemoIntegrationActionSet => integration !== null);

  const payload: DemoIntegrationStoragePayload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    integrations: normalized,
  };

  writeStorageItem(DEMO_INTEGRATIONS_STORAGE_KEY, JSON.stringify(payload));
  emitDemoIntegrationsUpdated();
}

export function upsertEnabledDemoIntegration(integration: DemoIntegrationActionSet): void {
  const normalized = normalizeActionSet(integration);
  if (!normalized) return;

  const current = readEnabledDemoIntegrations();
  const next = current.filter((item) => item.integrationId !== normalized.integrationId);
  next.push(normalized);
  writeEnabledDemoIntegrations(next);
}

export function removeEnabledDemoIntegration(integrationId: string): void {
  const current = readEnabledDemoIntegrations();
  const next = current.filter((item) => item.integrationId !== integrationId);
  writeEnabledDemoIntegrations(next);
}

function normalizeIntegrationIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .filter((item, index, self) => self.indexOf(item) === index);
}

function fallbackToggleIdsFromActions(): string[] {
  return readEnabledDemoIntegrations().map((integration) => integration.integrationId);
}

export function readEnabledDemoIntegrationToggleIds(): string[] {
  if (!isClientEnvironment()) return [];

  const raw = readStorageItem(DEMO_INTEGRATION_TOGGLES_STORAGE_KEY);
  if (!raw) {
    return fallbackToggleIdsFromActions();
  }

  try {
    const payload = JSON.parse(raw) as Partial<DemoIntegrationTogglesPayload>;
    return normalizeIntegrationIds(payload.enabledIntegrationIds);
  } catch {
    return fallbackToggleIdsFromActions();
  }
}

export function writeEnabledDemoIntegrationToggleIds(enabledIntegrationIds: string[]): void {
  if (!isClientEnvironment()) return;

  const payload: DemoIntegrationTogglesPayload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    enabledIntegrationIds: normalizeIntegrationIds(enabledIntegrationIds),
  };

  writeStorageItem(DEMO_INTEGRATION_TOGGLES_STORAGE_KEY, JSON.stringify(payload));
  emitDemoIntegrationsUpdated();
}

export function setDemoIntegrationToggle(integrationId: string, enabled: boolean): void {
  const normalizedId = integrationId.trim();
  if (normalizedId.length === 0) return;

  const current = readEnabledDemoIntegrationToggleIds();
  const nextSet = new Set(current);
  if (enabled) {
    nextSet.add(normalizedId);
  } else {
    nextSet.delete(normalizedId);
  }
  writeEnabledDemoIntegrationToggleIds([...nextSet]);
}
