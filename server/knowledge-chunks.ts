import { load } from "cheerio";
import { createHash, randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import type {
  KnowledgeDocumentChunkConfig,
  KnowledgeDocumentChunkItem,
  KnowledgeDocumentChunkPreview,
  KnowledgeDocumentChunkSet,
} from "@shared/knowledge-base";
import {
  knowledgeDocumentChunkItems,
  knowledgeDocumentChunkSets,
  knowledgeDocumentVersions,
  knowledgeDocuments,
  knowledgeNodes,
} from "@shared/schema";
import { db } from "./db";
import { KnowledgeBaseError } from "./knowledge-base";

interface ChunkingConfigInput {
  maxTokens?: number | null;
  maxChars?: number | null;
  overlapTokens?: number | null;
  overlapChars?: number | null;
  splitByPages?: boolean;
  respectHeadings?: boolean;
  // useHtmlContent больше не используется - определяется автоматически по sourceType документа
}

type SentenceUnit = {
  text: string;
  headingPath: string[];
  pageNumber: number | null;
  type: "heading" | "paragraph";
  charStart: number;
  charEnd: number;
  tokenCount: number;
  anchorId?: string | null;
};

type GeneratedChunk = KnowledgeDocumentChunkItem & {
  charStart: number;
  charEnd: number;
};

interface DocumentContext {
  documentId: string;
  versionId: string;
  versionNumber: number | null;
  content: string;
  contentHtml: string | null;
  contentText: string;
  documentHash: string | null;
  sourceUrl: string | null;
  sourceType: "manual" | "import" | "crawl";
}

const headingLevels: Record<string, number> = {
  h1: 1,
  h2: 2,
  h3: 3,
  h4: 4,
  h5: 5,
  h6: 6,
};

const blockTags = new Set([
  "p",
  "li",
  "blockquote",
  "pre",
  "code",
  "td",
  "th",
]);

const parseNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number(value);
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return null;
};

const countTokens = (text: string): number => {
  return text.trim().length === 0 ? 0 : text.trim().split(/\s+/u).length;
};

const sanitizeWhitespace = (text: string): string => text.replace(/\s+/gu, " ").trim();

const normalizeChunkText = (text: string): string =>
  sanitizeWhitespace(text.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n"));

const hashText = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

const buildDeterministicUuid = (input: string): string => {
  const hash = createHash("sha1").update(input, "utf8").digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const buildVectorId = ({
  workspaceId,
  baseId,
  documentId,
  chunkHash,
  chunkOrdinal,
}: {
  workspaceId: string;
  baseId: string;
  documentId: string;
  chunkHash: string;
  chunkOrdinal: number;
}): string => {
  const input = `${workspaceId}:${baseId}:${documentId}:${chunkHash}:${chunkOrdinal}`;
  return buildDeterministicUuid(input);
};

const arraysEqual = (first: readonly string[] | null, second: readonly string[] | undefined): boolean => {
  if (!first && (!second || second.length === 0)) {
    return true;
  }

  if (!first || !second || first.length !== second.length) {
    return false;
  }

  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) {
      return false;
    }
  }

  return true;
};

const normalizeChunkingConfig = (input: ChunkingConfigInput): KnowledgeDocumentChunkConfig => {
  let maxTokens = input.maxTokens ?? null;
  let maxChars = input.maxChars ?? null;

  if (maxTokens !== null) {
    maxTokens = Math.max(50, Math.min(maxTokens, 4_000));
  }

  if (maxChars !== null) {
    maxChars = Math.max(200, Math.min(maxChars, 20_000));
  }

  if (maxTokens === null && maxChars === null) {
    maxTokens = 400;
  }

  let overlapTokens = input.overlapTokens ?? null;
  let overlapChars = input.overlapChars ?? null;

  if (maxTokens !== null && overlapTokens === null) {
    overlapTokens = Math.max(0, Math.round(maxTokens * 0.2));
  }

  if (maxChars !== null && overlapChars === null) {
    overlapChars = Math.max(0, Math.round(maxChars * 0.2));
  }

  if (maxTokens !== null && overlapTokens !== null) {
    overlapTokens = Math.max(0, Math.min(overlapTokens, Math.max(maxTokens - 1, 0)));
  }

  if (maxChars !== null && overlapChars !== null) {
    overlapChars = Math.max(0, Math.min(overlapChars, Math.max(maxChars - 1, 0)));
  }

  return {
    maxTokens,
    maxChars,
    overlapTokens,
    overlapChars,
    splitByPages: Boolean(input.splitByPages),
    respectHeadings: input.respectHeadings !== false,
  } satisfies KnowledgeDocumentChunkConfig;
};

const splitSentences = (text: string): string[] => {
  const normalized = sanitizeWhitespace(text);
  if (!normalized) {
    return [];
  }

  try {
    const segmenter = new Intl.Segmenter("ru", { granularity: "sentence" });
    const segments: string[] = [];
    for (const segment of segmenter.segment(normalized)) {
      const value = sanitizeWhitespace(segment.segment);
      if (value) {
        segments.push(value);
      }
    }
    if (segments.length > 0) {
      return segments;
    }
  } catch (error) {
    // Fallback to regex splitting below.
  }

  return normalized
    .split(/(?<=[.!?])\s+(?=[A-ZА-Я0-9])/u)
    .map((entry) => sanitizeWhitespace(entry))
    .filter((entry) => entry.length > 0);
};

type KnowledgeDocumentChunkSetRow = typeof knowledgeDocumentChunkSets.$inferSelect;
type KnowledgeDocumentChunkItemRow = typeof knowledgeDocumentChunkItems.$inferSelect;

const extractSentences = (html: string): { sentences: SentenceUnit[]; normalizedText: string } => {
  const $ = load(html ?? "");
  const body = $("body");
  const headingStack: Array<{ level: number; title: string }> = [];
  const sentences: SentenceUnit[] = [];
  let normalizedText = "";
  let offset = 0;
  let currentPage: number | null = null;
  let currentHeadingAnchor: string | null = null;

  const getSectionPath = () => headingStack.map((entry) => entry.title);

  const pushHeading = (level: number, text: string, anchorId?: string | null) => {
    while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
      headingStack.pop();
    }
    headingStack.push({ level, title: text });
    currentHeadingAnchor = anchorId ?? null;

    const headingPath = getSectionPath();
    const tokens = countTokens(text);

    if (normalizedText.length > 0) {
      normalizedText += " ";
      offset += 1;
    }

    const start = offset;
    normalizedText += text;
    offset += text.length;
    const end = offset;

    sentences.push({
      text,
      headingPath,
      pageNumber: currentPage,
      type: "heading",
      charStart: start,
      charEnd: end,
      tokenCount: tokens,
      anchorId: anchorId ?? null,
    });
  };

  const pushParagraph = (text: string) => {
    const headingPath = getSectionPath();
    const parts = splitSentences(text);

    parts.forEach((sentence) => {
      if (normalizedText.length > 0) {
        normalizedText += " ";
        offset += 1;
      }

      const start = offset;
      normalizedText += sentence;
      offset += sentence.length;
      const end = offset;

      sentences.push({
        text: sentence,
        headingPath,
        pageNumber: currentPage,
        type: "paragraph",
        charStart: start,
        charEnd: end,
        tokenCount: countTokens(sentence),
        anchorId: currentHeadingAnchor,
      });
    });
  };

  const traverse = (node: { type?: string; data?: string; children?: unknown[] } | null | undefined) => {
    if (!node) {
      return;
    }

    if (node.type === "text") {
      const text = sanitizeWhitespace(node.data ?? "");
      if (text) {
        pushParagraph(text);
      }
      return;
    }

    if (node.type !== "tag") {
      return;
    }

    const tag = typeof (node as any).name === "string" ? (node as any).name.toLowerCase() : "";
    if (!tag || tag === "script" || tag === "style") {
      return;
    }

    const previousPage = currentPage;
    const pageAttr = (node as any).attribs?.["data-page-number"] ?? (node as any).attribs?.["data-page"] ?? (node as any).attribs?.["data-page_index"];
    const parsedPage = parseNumber(pageAttr);
    if (parsedPage !== null) {
      currentPage = parsedPage;
    }

    if (headingLevels[tag]) {
      const text = sanitizeWhitespace($(node as any).text());
      if (text) {
        const anchorId = typeof (node as any).attribs?.id === "string" ? (node as any).attribs.id.trim() : null;
        pushHeading(headingLevels[tag], text, anchorId);
      }
      currentPage = previousPage;
      return;
    }

    if (blockTags.has(tag)) {
      const text = sanitizeWhitespace($(node as any).text());
      if (text) {
        pushParagraph(text);
      }
      currentPage = previousPage;
      return;
    }

    $(node as any)
      .contents()
      .each((_, child) => {
        traverse(child);
      });

    currentPage = previousPage;
  };

  body.contents().each((_, child) => traverse(child));

  return { sentences, normalizedText };
};

const generateChunks = (
  sentences: SentenceUnit[],
  normalizedText: string,
  config: KnowledgeDocumentChunkConfig,
  documentSourceUrl: string | null,
): GeneratedChunk[] => {
  if (sentences.length === 0) {
    return [];
  }

  const chunks: GeneratedChunk[] = [];
  const tokenLimit = config.maxTokens ?? null;
  const charLimit = config.maxChars ?? null;
  const overlapTokens = config.overlapTokens ?? null;
  const overlapChars = config.overlapChars ?? null;

  const splitSentenceByTokens = (unit: SentenceUnit): SentenceUnit[] => {
    if (tokenLimit === null || unit.tokenCount <= tokenLimit) {
      return [unit];
    }

    const original = normalizedText.slice(unit.charStart, unit.charEnd);
    const tokenMatches = Array.from(original.matchAll(/\S+/gu));

    if (tokenMatches.length === 0) {
      return [unit];
    }

    const segments: SentenceUnit[] = [];
    let segmentStartTokenIndex = 0;
    let tokensInSegment = 0;

    for (let index = 0; index < tokenMatches.length; index += 1) {
      tokensInSegment += 1;
      const isLastToken = index === tokenMatches.length - 1;
      const nextTokenStart = isLastToken ? original.length : tokenMatches[index + 1]?.index ?? original.length;

      if (tokensInSegment >= tokenLimit || isLastToken) {
        const firstToken = tokenMatches[segmentStartTokenIndex];
        const startOffset = firstToken?.index ?? 0;
        const endOffset = nextTokenStart;
        const charStart = unit.charStart + startOffset;
        const charEnd = unit.charStart + endOffset;
        const text = sanitizeWhitespace(normalizedText.slice(charStart, charEnd));

        segments.push({
          ...unit,
          text,
          charStart,
          charEnd,
          tokenCount: countTokens(text),
        });

        segmentStartTokenIndex = index + 1;
        tokensInSegment = 0;
      }
    }

    return segments;
  };

  const splitSentenceByChars = (unit: SentenceUnit): SentenceUnit[] => {
    if (charLimit === null) {
      return [unit];
    }

    const original = normalizedText.slice(unit.charStart, unit.charEnd);
    if (original.length <= charLimit) {
      return [unit];
    }

    const segments: SentenceUnit[] = [];
    let localStart = 0;

    while (localStart < original.length) {
      let localEnd = Math.min(localStart + charLimit, original.length);

      if (localEnd < original.length) {
        const lastSpace = original.lastIndexOf(" ", localEnd - 1);
        if (lastSpace > localStart) {
          localEnd = lastSpace + 1;
        }
      }

      const charStart = unit.charStart + localStart;
      const charEnd = unit.charStart + localEnd;
      const text = sanitizeWhitespace(normalizedText.slice(charStart, charEnd));

      if (text) {
        segments.push({
          ...unit,
          text,
          charStart,
          charEnd,
          tokenCount: countTokens(text),
        });
      }

      localStart = localEnd;
      while (localStart < original.length && original[localStart] === " ") {
        localStart += 1;
      }
    }

    return segments.length > 0 ? segments : [unit];
  };

  const enforceSentenceLimits = (unit: SentenceUnit): SentenceUnit[] => {
    const queue: SentenceUnit[] = [unit];
    const result: SentenceUnit[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (tokenLimit !== null && current.tokenCount > tokenLimit) {
        queue.unshift(...splitSentenceByTokens(current));
        continue;
      }

      if (charLimit !== null && current.charEnd - current.charStart > charLimit) {
        queue.unshift(...splitSentenceByChars(current));
        continue;
      }

      result.push(current);
    }

    return result;
  };

  const processedSentences = sentences.flatMap((unit) => enforceSentenceLimits(unit));

  let currentUnits: SentenceUnit[] = [];
  let currentSectionPath: string[] | null = null;

  const wouldExceed = (units: SentenceUnit[], candidate: SentenceUnit): boolean => {
    if (units.length === 0) {
      return false;
    }

    const first = units[0];
    const tokens = units.reduce((sum, unit) => sum + unit.tokenCount, 0) + candidate.tokenCount;
    const chars = candidate.charEnd - first.charStart;

    if (tokenLimit !== null && tokens > tokenLimit) {
      return true;
    }

    if (charLimit !== null && chars > charLimit) {
      return true;
    }

    return false;
  };

  const buildOverlap = (units: SentenceUnit[]): SentenceUnit[] => {
    if (units.length === 0) {
      return [];
    }

    if (overlapTokens === null && overlapChars === null) {
      return [];
    }

    const result: SentenceUnit[] = [];
    let tokens = 0;
    let chars = 0;

    for (let index = units.length - 1; index >= 0; index -= 1) {
      const unit = units[index];
      result.unshift(unit);
      tokens += unit.tokenCount;
      chars += unit.charEnd - unit.charStart;

      const enoughTokens = overlapTokens === null ? true : tokens >= overlapTokens;
      const enoughChars = overlapChars === null ? true : chars >= overlapChars;
      if (enoughTokens && enoughChars) {
        break;
      }
    }

    return result;
  };

  const buildAnchorUrl = (anchorId: string): string | null => {
    const trimmedAnchor = anchorId.trim();
    if (!trimmedAnchor) {
      return null;
    }

    if (documentSourceUrl) {
      try {
        const base = new URL(documentSourceUrl);
        base.hash = `#${encodeURIComponent(trimmedAnchor)}`;
        return base.toString();
      } catch {
        const [base] = documentSourceUrl.split("#", 1);
        const sanitizedBase = base || documentSourceUrl;
        return `${sanitizedBase}#${encodeURIComponent(trimmedAnchor)}`;
      }
    }

    return `#${encodeURIComponent(trimmedAnchor)}`;
  };

  const finalizeChunk = (reason: "limit" | "page" | "heading" | "section" | null) => {
    if (currentUnits.length === 0) {
      return;
    }

    const first = currentUnits[0];
    const last = currentUnits[currentUnits.length - 1];
    const chunkText = sanitizeWhitespace(normalizedText.slice(first.charStart, last.charEnd));

    if (!chunkText) {
      currentUnits = [];
      currentSectionPath = null;
      return;
    }

    const chunkIndex = chunks.length;
    const sectionPathCandidate =
      currentUnits.find((unit) => unit.headingPath.length > 0)?.headingPath ?? first.headingPath ?? [];
    const pageNumber = currentUnits.find((unit) => unit.pageNumber !== null)?.pageNumber ?? null;
    const tokenCount = currentUnits.reduce((sum, unit) => sum + unit.tokenCount, 0);

    const metadata: Record<string, unknown> = {
      sentenceCount: currentUnits.length,
      sectionPath: sectionPathCandidate,
      pageNumber,
      firstSentence: first.text,
      lastSentence: last.text,
      charStart: first.charStart,
      charEnd: last.charEnd,
      tokenCount,
    };

    const anchorUnit = currentUnits.find((unit) => typeof unit.anchorId === "string" && unit.anchorId.trim().length > 0);
    if (anchorUnit?.anchorId) {
      metadata.anchorId = anchorUnit.anchorId;
      const anchorUrl = buildAnchorUrl(anchorUnit.anchorId);
      if (anchorUrl) {
        metadata.sourceUrl = anchorUrl;
      }
    }

    if (sectionPathCandidate.length > 0) {
      metadata.heading = sectionPathCandidate[sectionPathCandidate.length - 1];
    }

    const normalizedChunkText = normalizeChunkText(chunkText);
    const chunk: GeneratedChunk = {
      id: randomUUID(),
      index: chunkIndex,
      text: chunkText,
      charStart: first.charStart,
      charEnd: last.charEnd,
      tokenCount,
      pageNumber,
      sectionPath: sectionPathCandidate,
      metadata,
      contentHash: hashText(normalizedChunkText),
    };

    chunks.push(chunk);

    if (reason === "limit") {
      const overlapUnits = buildOverlap(currentUnits);
      currentUnits = overlapUnits;
      currentSectionPath = overlapUnits.length > 0 ? overlapUnits[0].headingPath : null;
    } else {
      currentUnits = [];
      currentSectionPath = null;
    }
  };

  for (const sentence of processedSentences) {
    const limitExceeded = wouldExceed(currentUnits, sentence);
    const pageChanged =
      config.splitByPages &&
      currentUnits.length > 0 &&
      sentence.pageNumber !== null &&
      currentUnits[currentUnits.length - 1].pageNumber !== sentence.pageNumber;
    const headingBoundary = config.respectHeadings && sentence.type === "heading" && currentUnits.length > 0;
    const sectionChanged =
      config.respectHeadings &&
      currentUnits.length > 0 &&
      sentence.headingPath.length > 0 &&
      currentSectionPath !== null &&
      !arraysEqual(currentSectionPath, sentence.headingPath);

    if ((limitExceeded || pageChanged || headingBoundary || sectionChanged) && currentUnits.length > 0) {
      const reason = limitExceeded
        ? "limit"
        : pageChanged
        ? "page"
        : headingBoundary
        ? "heading"
        : "section";
      finalizeChunk(reason);

      if (reason === "limit" && currentUnits.length > 0) {
        while (currentUnits.length > 0 && wouldExceed(currentUnits, sentence)) {
          currentUnits.shift();
        }
        currentSectionPath = currentUnits.length > 0 ? currentUnits[0].headingPath : null;
      }
    }

    currentUnits.push(sentence);
    if (currentUnits.length === 1) {
      currentSectionPath = sentence.headingPath;
    }
  }

  if (currentUnits.length > 0) {
    finalizeChunk(null);
  }

  return chunks;
};

const applyChunkIdentifiers = (
  chunks: GeneratedChunk[],
  identifiers: {
    workspaceId: string;
    baseId: string;
    documentId: string;
  },
): GeneratedChunk[] => {
  const ordinalMap = new Map<string, number>();

  return chunks.map((chunk) => {
    const hash = chunk.contentHash;
    const nextOrdinal = ordinalMap.get(hash) ?? 0;
    ordinalMap.set(hash, nextOrdinal + 1);

    return {
      ...chunk,
      chunkOrdinal: nextOrdinal,
      vectorId: buildVectorId({
        workspaceId: identifiers.workspaceId,
        baseId: identifiers.baseId,
        documentId: identifiers.documentId,
        chunkHash: hash,
        chunkOrdinal: nextOrdinal,
      }),
    };
  });
};

const fetchDocumentContext = async (
  baseId: string,
  nodeId: string,
  workspaceId: string,
): Promise<DocumentContext> => {
  const [row] = await db
    .select({
      documentId: knowledgeDocuments.id,
      nodeType: knowledgeNodes.type,
      nodeBaseId: knowledgeNodes.baseId,
      versionId: knowledgeDocumentVersions.id,
      versionNumber: knowledgeDocumentVersions.versionNo,
      contentText: knowledgeDocumentVersions.contentText,
      contentJson: knowledgeDocumentVersions.contentJson,
      storedHash: knowledgeDocumentVersions.hash,
      sourceUrl: knowledgeDocuments.sourceUrl,
      sourceType: knowledgeNodes.sourceType,
    })
    .from(knowledgeDocuments)
    .innerJoin(knowledgeNodes, eq(knowledgeDocuments.nodeId, knowledgeNodes.id))
    .leftJoin(
      knowledgeDocumentVersions,
      eq(knowledgeDocuments.currentVersionId, knowledgeDocumentVersions.id),
    )
    .where(
      and(
        eq(knowledgeDocuments.baseId, baseId),
        eq(knowledgeDocuments.workspaceId, workspaceId),
        eq(knowledgeNodes.id, nodeId),
      ),
    )
    .limit(1);

  if (!row?.documentId) {
    throw new KnowledgeBaseError("Документ не найден", 404);
  }

  if (row.nodeType !== "document") {
    throw new KnowledgeBaseError("Можно разбивать на чанки только документы", 400);
  }

  if (!row.versionId) {
    throw new KnowledgeBaseError("У документа отсутствует актуальная версия", 400);
  }

  const contentText = typeof row.contentText === "string" ? row.contentText : "";
  const versionContent = (row.contentJson ?? {}) as Record<string, unknown>;
  const contentHtml = typeof versionContent.html === "string" ? versionContent.html : null;
  const content = contentHtml || contentText;
  const normalizedContent = content.trim();
  const documentHash = row.storedHash ?? (normalizedContent ? hashText(normalizedContent) : null);
  const sourceType = (row.sourceType === "crawl" || row.sourceType === "import" || row.sourceType === "manual")
    ? row.sourceType
    : "manual";

  return {
    documentId: row.documentId,
    versionId: row.versionId,
    versionNumber: row.versionNumber ?? null,
    content,
    contentHtml,
    contentText,
    documentHash,
    sourceUrl: typeof row.sourceUrl === "string" && row.sourceUrl.trim().length > 0 ? row.sourceUrl.trim() : null,
    sourceType,
  } satisfies DocumentContext;
};

const mapChunkSet = (
  setRow: KnowledgeDocumentChunkSetRow,
  itemRows: KnowledgeDocumentChunkItemRow[],
): KnowledgeDocumentChunkSet => {
  const config: KnowledgeDocumentChunkConfig = {
    maxTokens: setRow.maxTokens ?? null,
    maxChars: setRow.maxChars ?? null,
    overlapTokens: setRow.overlapTokens ?? null,
    overlapChars: setRow.overlapChars ?? null,
    splitByPages: Boolean(setRow.splitByPages),
    respectHeadings: Boolean(setRow.respectHeadings),
  };

  let maxChunkTokens: number | null = null;
  let maxChunkIndex: number | null = null;
  let maxChunkId: string | null = null;

  const items: KnowledgeDocumentChunkItem[] = itemRows.map((item) => ({
    id: item.id,
    index: item.chunkIndex,
    text: item.text,
    charStart: item.charStart,
    charEnd: item.charEnd,
    tokenCount: item.tokenCount,
    pageNumber: item.pageNumber,
    sectionPath: Array.isArray(item.sectionPath) ? (item.sectionPath as string[]) : undefined,
    metadata: (item.metadata ?? {}) as Record<string, unknown>,
    contentHash: item.contentHash,
    chunkOrdinal: typeof item.chunkOrdinal === "number" ? item.chunkOrdinal : null,
    vectorId: item.vectorId ?? null,
    revisionId: item.revisionId ?? null,
    vectorRecordId: item.vectorRecordId ?? null,
  }));

  for (const item of itemRows) {
    const tokens =
      typeof item.tokenCount === "number" && Number.isFinite(item.tokenCount)
        ? item.tokenCount
        : null;

    if (tokens === null) {
      continue;
    }

    if (maxChunkTokens === null || tokens > maxChunkTokens) {
      maxChunkTokens = tokens;
      maxChunkIndex = typeof item.chunkIndex === "number" ? item.chunkIndex : null;
      maxChunkId = typeof item.id === "string" ? item.id : null;
    }
  }

  return {
    id: setRow.id,
    documentId: setRow.documentId,
    versionId: setRow.versionId,
    revisionId: setRow.revisionId ?? null,
    documentHash: setRow.documentHash ?? null,
    chunkCount: setRow.chunkCount,
    totalTokens: setRow.totalTokens,
    totalChars: setRow.totalChars,
    maxChunkTokens,
    maxChunkIndex,
    maxChunkId,
    createdAt: setRow.createdAt?.toISOString?.() ?? new Date().toISOString(),
    updatedAt: setRow.updatedAt?.toISOString?.() ?? new Date().toISOString(),
    config,
    chunks: items,
  } satisfies KnowledgeDocumentChunkSet;
};

const extractSentencesFromPlainText = (text: string): { sentences: SentenceUnit[]; normalizedText: string } => {
  const normalized = sanitizeWhitespace(text);
  if (!normalized) {
    return { sentences: [], normalizedText: "" };
  }

  const normalizedText = normalized;
  const sentenceParts = splitSentences(normalizedText);
  const sentences: SentenceUnit[] = [];

  let charStart = 0;
  for (const sentence of sentenceParts) {
    // Ищем предложение в тексте, начиная с текущей позиции
    const sentenceIndex = normalizedText.indexOf(sentence, charStart);
    if (sentenceIndex === -1) {
      // Если не нашли, значит предложение уже было обработано или текст изменился
      // Используем текущую позицию как fallback
      const charEnd = Math.min(charStart + sentence.length, normalizedText.length);
      if (charEnd > charStart) {
        sentences.push({
          text: sentence,
          headingPath: [],
          pageNumber: null,
          type: "paragraph",
          charStart,
          charEnd,
          tokenCount: countTokens(sentence),
          anchorId: null,
        });
        charStart = charEnd;
        // Добавляем пробел после предложения, если он есть
        if (charStart < normalizedText.length && normalizedText[charStart] === " ") {
          charStart += 1;
        }
      }
    } else {
      const charEnd = sentenceIndex + sentence.length;
      sentences.push({
        text: sentence,
        headingPath: [],
        pageNumber: null,
        type: "paragraph",
        charStart: sentenceIndex,
        charEnd,
        tokenCount: countTokens(sentence),
        anchorId: null,
      });
      charStart = charEnd;
      // Добавляем пробел после предложения, если он есть
      if (charStart < normalizedText.length && normalizedText[charStart] === " ") {
        charStart += 1;
      }
    }
  }

  return { sentences, normalizedText };
};

export const previewKnowledgeDocumentChunks = async (
  baseId: string,
  nodeId: string,
  workspaceId: string,
  inputConfig: ChunkingConfigInput,
): Promise<KnowledgeDocumentChunkPreview> => {
  const context = await fetchDocumentContext(baseId, nodeId, workspaceId);
  const normalizedConfig = normalizeChunkingConfig(inputConfig);
  // Автоматическое определение: crawl → HTML, manual/import → текст
  const useHtmlContent = context.sourceType === "crawl";
  const sourceContent = useHtmlContent && context.contentHtml ? context.contentHtml : context.contentText;
  const { sentences, normalizedText } = useHtmlContent
    ? extractSentences(sourceContent ?? "")
    : extractSentencesFromPlainText(sourceContent ?? "");
  const generatedChunks = generateChunks(
    sentences,
    normalizedText,
    normalizedConfig,
    context.sourceUrl,
  );
  const preparedChunks = applyChunkIdentifiers(generatedChunks, {
    workspaceId,
    baseId,
    documentId: context.documentId,
  });

  const totalTokens = preparedChunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0);
  const totalChars = preparedChunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
  let maxChunkTokens: number | null = null;
  let maxChunkIndex: number | null = null;
  let maxChunkId: string | null = null;

  for (const chunk of preparedChunks) {
    const tokens = typeof chunk.tokenCount === "number" && Number.isFinite(chunk.tokenCount)
      ? chunk.tokenCount
      : null;
    if (tokens === null) {
      continue;
    }

    if (maxChunkTokens === null || tokens > maxChunkTokens) {
      maxChunkTokens = tokens;
      maxChunkIndex = typeof chunk.index === "number" ? chunk.index : null;
      maxChunkId = typeof chunk.id === "string" ? chunk.id : null;
    }
  }

  const previewItems = preparedChunks.slice(0, 10).map((chunk): KnowledgeDocumentChunkItem => ({
    id: chunk.id,
    index: chunk.index,
    text: chunk.text,
    charStart: chunk.charStart,
    charEnd: chunk.charEnd,
    tokenCount: chunk.tokenCount,
    pageNumber: chunk.pageNumber,
    sectionPath: chunk.sectionPath,
    metadata: chunk.metadata,
    contentHash: chunk.contentHash,
    chunkOrdinal: chunk.chunkOrdinal ?? null,
    vectorId: chunk.vectorId ?? null,
    vectorRecordId: chunk.vectorRecordId ?? null,
  }));

  return {
    documentId: context.documentId,
    versionId: context.versionId,
    versionNumber: context.versionNumber,
    documentHash: context.documentHash ?? null,
    generatedAt: new Date().toISOString(),
    totalChunks: preparedChunks.length,
    totalTokens,
    totalChars,
    maxChunkTokens,
    maxChunkIndex,
    maxChunkId,
    config: normalizedConfig,
    items: previewItems,
  } satisfies KnowledgeDocumentChunkPreview;
};

export const createKnowledgeDocumentChunkSet = async (
  baseId: string,
  nodeId: string,
  workspaceId: string,
  inputConfig: ChunkingConfigInput,
  options?: { revisionId?: string | null; setLatest?: boolean },
): Promise<KnowledgeDocumentChunkSet> => {
  console.log("[CHUNKS] Начало создания чанков для документа:", { baseId, nodeId, workspaceId });
  const context = await fetchDocumentContext(baseId, nodeId, workspaceId);
  const normalizedConfig = normalizeChunkingConfig(inputConfig);
  const revisionId = options?.revisionId ?? null;
  const setLatest = options?.setLatest ?? true;
  // Автоматическое определение: crawl → HTML, manual/import → текст
  const useHtmlContent = context.sourceType === "crawl";
  const sourceContent = useHtmlContent && context.contentHtml ? context.contentHtml : context.contentText;
  const { sentences, normalizedText } = useHtmlContent
    ? extractSentences(sourceContent ?? "")
    : extractSentencesFromPlainText(sourceContent ?? "");
  const generatedChunks = generateChunks(
    sentences,
    normalizedText,
    normalizedConfig,
    context.sourceUrl,
  );
  const preparedChunks = applyChunkIdentifiers(generatedChunks, {
    workspaceId,
    baseId,
    documentId: context.documentId,
  });
  console.log("[CHUNKS] Сгенерировано чанков:", { 
    count: preparedChunks.length, 
    allHaveHashes: preparedChunks.every(c => !!c.contentHash) 
  });

  if (preparedChunks.length === 0) {
    throw new KnowledgeBaseError("Не удалось разбить документ на чанки", 400);
  }

  const totalTokens = preparedChunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0);
  const totalChars = preparedChunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
  const chunkSetId = randomUUID();
  const now = new Date();

  await db.transaction(async (tx: typeof db) => {
    if (setLatest) {
      await tx
        .update(knowledgeDocumentChunkSets)
        .set({ isLatest: false, updatedAt: now })
        .where(
          and(
            eq(knowledgeDocumentChunkSets.documentId, context.documentId),
            eq(knowledgeDocumentChunkSets.workspaceId, workspaceId),
          ),
        );
    }

    await tx.insert(knowledgeDocumentChunkSets).values({
      id: chunkSetId,
      workspaceId,
      documentId: context.documentId,
      versionId: context.versionId,
      revisionId,
      documentHash: context.documentHash ?? null,
      maxTokens: normalizedConfig.maxTokens,
      maxChars: normalizedConfig.maxChars,
      overlapTokens: normalizedConfig.overlapTokens,
      overlapChars: normalizedConfig.overlapChars,
      splitByPages: normalizedConfig.splitByPages,
      respectHeadings: normalizedConfig.respectHeadings,
      chunkCount: generatedChunks.length,
      totalTokens,
      totalChars,
      isLatest: setLatest,
      createdAt: now,
      updatedAt: now,
    });

    if (preparedChunks.length > 0) {
      try {
        const chunkValues = preparedChunks.map((chunk) => ({
          id: chunk.id,
          workspaceId,
          chunkSetId,
          documentId: context.documentId,
          versionId: context.versionId,
          revisionId,
          chunkIndex: chunk.index,
          text: chunk.text,
          charStart: chunk.charStart,
          charEnd: chunk.charEnd,
          tokenCount: chunk.tokenCount,
          pageNumber: chunk.pageNumber,
          sectionPath: chunk.sectionPath && chunk.sectionPath.length > 0 ? chunk.sectionPath : null,
          metadata: chunk.metadata,
          contentHash: chunk.contentHash,
          chunkOrdinal: chunk.chunkOrdinal ?? null,
          vectorId: chunk.vectorId ?? null,
          vectorRecordId: chunk.vectorRecordId ?? null,
          createdAt: now,
          updatedAt: now,
        }));
        
        await tx.insert(knowledgeDocumentChunkItems).values(chunkValues);
      } catch (error) {
        console.error("[CHUNKS] Ошибка при вставке чанков в БД:", {
          baseId,
          nodeId,
          workspaceId,
          documentId: context.documentId,
          versionId: context.versionId,
          chunkCount: generatedChunks.length,
          firstChunkHasHash: generatedChunks.length > 0 ? !!generatedChunks[0].contentHash : false,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        throw error;
      }
    }
  });

  return getKnowledgeDocumentChunkSetById(chunkSetId, workspaceId);
};

export async function getKnowledgeDocumentChunkSetById(
  chunkSetId: string,
  workspaceId: string,
): Promise<KnowledgeDocumentChunkSet> {
  const [setRow] = await db
    .select()
    .from(knowledgeDocumentChunkSets)
    .where(and(eq(knowledgeDocumentChunkSets.id, chunkSetId), eq(knowledgeDocumentChunkSets.workspaceId, workspaceId)))
    .limit(1);

  if (!setRow) {
    throw new KnowledgeBaseError("Разбиение не найдено", 404);
  }

  const itemRows = await db
    .select()
    .from(knowledgeDocumentChunkItems)
    .where(eq(knowledgeDocumentChunkItems.chunkSetId, chunkSetId))
    .orderBy(knowledgeDocumentChunkItems.chunkIndex);

  return mapChunkSet(setRow, itemRows);
}

export async function getLatestKnowledgeDocumentChunkSetForDocument(
  documentId: string,
  workspaceId: string,
): Promise<KnowledgeDocumentChunkSet | null> {
  const [setRow] = await db
    .select()
    .from(knowledgeDocumentChunkSets)
    .where(and(eq(knowledgeDocumentChunkSets.documentId, documentId), eq(knowledgeDocumentChunkSets.workspaceId, workspaceId)))
    .orderBy(desc(knowledgeDocumentChunkSets.createdAt))
    .limit(1);

  if (!setRow) {
    return null;
  }

  const itemRows = await db
    .select()
    .from(knowledgeDocumentChunkItems)
    .where(eq(knowledgeDocumentChunkItems.chunkSetId, setRow.id))
    .orderBy(knowledgeDocumentChunkItems.chunkIndex);

  return mapChunkSet(setRow, itemRows);
}

export async function getLatestKnowledgeDocumentChunkSet(
  baseId: string,
  nodeId: string,
  workspaceId: string,
): Promise<KnowledgeDocumentChunkSet | null> {
  const context = await fetchDocumentContext(baseId, nodeId, workspaceId).catch((error) => {
    if (error instanceof KnowledgeBaseError && error.status === 404) {
      return null;
    }
    throw error;
  });

  if (!context) {
    return null;
  }

  return getLatestKnowledgeDocumentChunkSetForDocument(context.documentId, workspaceId);
}

export async function updateKnowledgeDocumentChunkVectorRecords({
  workspaceId,
  chunkSetId,
  chunkRecords,
}: {
  workspaceId: string;
  chunkSetId: string;
  chunkRecords: Array<{ chunkId: string; vectorRecordId: string | null }>;
}): Promise<void> {
  if (!chunkRecords || chunkRecords.length === 0) {
    return;
  }

  const normalizedRecords = new Map<string, string | null>();

  for (const record of chunkRecords) {
    const rawChunkId = typeof record.chunkId === "string" ? record.chunkId.trim() : "";
    if (!rawChunkId) {
      continue;
    }

    const vectorRecordId =
      typeof record.vectorRecordId === "string" && record.vectorRecordId.trim().length > 0
        ? record.vectorRecordId.trim()
        : null;

    normalizedRecords.set(rawChunkId, vectorRecordId);
  }

  if (normalizedRecords.size === 0) {
    return;
  }

  const now = new Date();

  await db.transaction(async (tx: typeof db) => {
    for (const [chunkId, vectorRecordId] of normalizedRecords.entries()) {
      await tx
        .update(knowledgeDocumentChunkItems)
        .set({ vectorRecordId, updatedAt: now })
        .where(
          and(
            eq(knowledgeDocumentChunkItems.id, chunkId),
            eq(knowledgeDocumentChunkItems.workspaceId, workspaceId),
            eq(knowledgeDocumentChunkItems.chunkSetId, chunkSetId),
          ),
        );
    }

    await tx
      .update(knowledgeDocumentChunkSets)
      .set({ updatedAt: now })
      .where(
        and(
          eq(knowledgeDocumentChunkSets.id, chunkSetId),
          eq(knowledgeDocumentChunkSets.workspaceId, workspaceId),
        ),
      );
  });
}

export const __test__ = {
  extractSentences,
  generateChunks,
  normalizeChunkingConfig,
};
