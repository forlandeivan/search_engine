const allowedPlaceholders = [
  "bucket",
  "workspaceName",
  "workspaceId",
  "skillName",
  "skillId",
  "chatId",
  "userId",
  "messageId",
  "fileName",
  "objectKey",
] as const;

const allowedPlaceholderSet = new Set<string>(allowedPlaceholders);

export type PathTemplatePlaceholder = (typeof allowedPlaceholders)[number];

export type PathTemplateContext = Partial<Record<PathTemplatePlaceholder, string | null | undefined>>;

const MAX_SEGMENT_LENGTH = 180;
const MAX_PATH_LENGTH = 1024;

const sanitizeSegment = (value: string | null | undefined, fallback: string): string => {
  const safeValue = (value ?? "").toString().trim();
  if (!safeValue) return fallback;
  const ascii = safeValue
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const clipped = ascii.length > MAX_SEGMENT_LENGTH ? ascii.slice(-MAX_SEGMENT_LENGTH) : ascii;
  return clipped || fallback;
};

export function validatePathTemplate(template: string): void {
  const tokens = Array.from(template.matchAll(/\{([^}]+)\}/g)).map(([, key]) => key.trim()).filter(Boolean);
  const invalid = tokens.filter((token) => !allowedPlaceholderSet.has(token));
  if (invalid.length > 0) {
    throw new Error(`Unsupported placeholders in pathTemplate: ${invalid.join(", ")}`);
  }
}

export function buildPathFromTemplate(template: string, ctx: PathTemplateContext): string {
  validatePathTemplate(template);

  const replacements: Record<PathTemplatePlaceholder, string> = {
    bucket: sanitizeSegment(ctx.bucket, ""),
    workspaceName: sanitizeSegment(ctx.workspaceName ?? ctx.workspaceId, ""),
    workspaceId: sanitizeSegment(ctx.workspaceId, ""),
    skillName: sanitizeSegment(ctx.skillName ?? ctx.skillId, ""),
    skillId: sanitizeSegment(ctx.skillId, ""),
    chatId: sanitizeSegment(ctx.chatId, ""),
    userId: sanitizeSegment(ctx.userId, ""),
    messageId: sanitizeSegment(ctx.messageId, ""),
    fileName: sanitizeSegment(ctx.fileName ?? ctx.objectKey, "file"),
    objectKey: sanitizeSegment(ctx.objectKey ?? ctx.fileName, "file"),
  };

  const pattern = new RegExp(`\\{(${allowedPlaceholders.join("|")})\\}`, "g");
  const rendered = template.replace(pattern, (_, key: PathTemplatePlaceholder) => replacements[key] ?? "");

  const segments = rendered
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => sanitizeSegment(segment, ""))
    .filter(Boolean);

  if (segments.length === 0) {
    segments.push(replacements.objectKey);
  }

  const path = "/" + segments.join("/");
  const safePath = path.length > MAX_PATH_LENGTH ? path.slice(0, MAX_PATH_LENGTH) : path;
  return safePath;
}

export function getAllowedPathPlaceholders(): PathTemplatePlaceholder[] {
  return [...allowedPlaceholders];
}
