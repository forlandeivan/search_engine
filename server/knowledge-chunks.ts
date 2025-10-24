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
}

type SentenceUnit = {
  text: string;
  headingPath: string[];
  pageNumber: number | null;
  type: "heading" | "paragraph";
  charStart: number;
  charEnd: number;
  tokenCount: number;
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
  documentHash: string | null;
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

const hashText = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

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

  const getSectionPath = () => headingStack.map((entry) => entry.title);

  const pushHeading = (level: number, text: string) => {
    while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
      headingStack.pop();
    }
    headingStack.push({ level, title: text });

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
      });
    });
  };

  const traverse = (node: any) => {
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

    const tag = typeof node.name === "string" ? node.name.toLowerCase() : "";
    if (!tag || tag === "script" || tag === "style") {
      return;
    }

    const previousPage = currentPage;
    const pageAttr = node.attribs?.["data-page-number"] ?? node.attribs?.["data-page"] ?? node.attribs?.["data-page_index"];
    const parsedPage = parseNumber(pageAttr);
    if (parsedPage !== null) {
      currentPage = parsedPage;
    }

    if (headingLevels[tag]) {
      const text = sanitizeWhitespace($(node).text());
      if (text) {
        pushHeading(headingLevels[tag], text);
      }
      currentPage = previousPage;
      return;
    }

    if (blockTags.has(tag)) {
      const text = sanitizeWhitespace($(node).text());
      if (text) {
        pushParagraph(text);
      }
      currentPage = previousPage;
      return;
    }

    $(node)
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
): GeneratedChunk[] => {
  if (sentences.length === 0) {
    return [];
  }

  const chunks: GeneratedChunk[] = [];
  const tokenLimit = config.maxTokens ?? null;
  const charLimit = config.maxChars ?? null;
  const overlapTokens = config.overlapTokens ?? null;
  const overlapChars = config.overlapChars ?? null;

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

    if (sectionPathCandidate.length > 0) {
      metadata.heading = sectionPathCandidate[sectionPathCandidate.length - 1];
    }

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
      contentHash: hashText(chunkText),
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

  for (const sentence of sentences) {
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
      content: knowledgeDocumentVersions.contentText,
      storedHash: knowledgeDocumentVersions.hash,
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

  const content = typeof row.content === "string" ? row.content : "";
  const normalizedContent = content.trim();
  const documentHash = row.storedHash ?? (normalizedContent ? hashText(normalizedContent) : null);

  return {
    documentId: row.documentId,
    versionId: row.versionId,
    versionNumber: row.versionNumber ?? null,
    content,
    documentHash,
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
    vectorRecordId: item.vectorRecordId ?? null,
  }));

  return {
    id: setRow.id,
    documentId: setRow.documentId,
    versionId: setRow.versionId,
    documentHash: setRow.documentHash ?? null,
    chunkCount: setRow.chunkCount,
    totalTokens: setRow.totalTokens,
    totalChars: setRow.totalChars,
    createdAt: setRow.createdAt?.toISOString?.() ?? new Date().toISOString(),
    updatedAt: setRow.updatedAt?.toISOString?.() ?? new Date().toISOString(),
    config,
    chunks: items,
  } satisfies KnowledgeDocumentChunkSet;
};

export const previewKnowledgeDocumentChunks = async (
  baseId: string,
  nodeId: string,
  workspaceId: string,
  inputConfig: ChunkingConfigInput,
): Promise<KnowledgeDocumentChunkPreview> => {
  const context = await fetchDocumentContext(baseId, nodeId, workspaceId);
  const normalizedConfig = normalizeChunkingConfig(inputConfig);
  const { sentences, normalizedText } = extractSentences(context.content ?? "");
  const generatedChunks = generateChunks(sentences, normalizedText, normalizedConfig);

  const totalTokens = generatedChunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0);
  const totalChars = generatedChunks.reduce((sum, chunk) => sum + chunk.text.length, 0);

  const previewItems = generatedChunks.slice(0, 10).map((chunk): KnowledgeDocumentChunkItem => ({
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
    vectorRecordId: chunk.vectorRecordId ?? null,
  }));

  return {
    documentId: context.documentId,
    versionId: context.versionId,
    versionNumber: context.versionNumber,
    documentHash: context.documentHash ?? null,
    generatedAt: new Date().toISOString(),
    totalChunks: generatedChunks.length,
    totalTokens,
    totalChars,
    config: normalizedConfig,
    items: previewItems,
  } satisfies KnowledgeDocumentChunkPreview;
};

export const createKnowledgeDocumentChunkSet = async (
  baseId: string,
  nodeId: string,
  workspaceId: string,
  inputConfig: ChunkingConfigInput,
): Promise<KnowledgeDocumentChunkSet> => {
  const context = await fetchDocumentContext(baseId, nodeId, workspaceId);
  const normalizedConfig = normalizeChunkingConfig(inputConfig);
  const { sentences, normalizedText } = extractSentences(context.content ?? "");
  const generatedChunks = generateChunks(sentences, normalizedText, normalizedConfig);

  if (generatedChunks.length === 0) {
    throw new KnowledgeBaseError("Не удалось разбить документ на чанки", 400);
  }

  const totalTokens = generatedChunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0);
  const totalChars = generatedChunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
  const chunkSetId = randomUUID();
  const now = new Date();

  await db.transaction(async (tx: typeof db) => {
    await tx
      .update(knowledgeDocumentChunkSets)
      .set({ isLatest: false, updatedAt: now })
      .where(and(eq(knowledgeDocumentChunkSets.documentId, context.documentId), eq(knowledgeDocumentChunkSets.workspaceId, workspaceId)));

    await tx.insert(knowledgeDocumentChunkSets).values({
      id: chunkSetId,
      workspaceId,
      documentId: context.documentId,
      versionId: context.versionId,
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
      isLatest: true,
      createdAt: now,
      updatedAt: now,
    });

    if (generatedChunks.length > 0) {
      await tx.insert(knowledgeDocumentChunkItems).values(
        generatedChunks.map((chunk) => ({
          id: chunk.id,
          workspaceId,
          chunkSetId,
          documentId: context.documentId,
          versionId: context.versionId,
          chunkIndex: chunk.index,
          text: chunk.text,
          charStart: chunk.charStart,
          charEnd: chunk.charEnd,
          tokenCount: chunk.tokenCount,
          pageNumber: chunk.pageNumber,
          sectionPath: chunk.sectionPath && chunk.sectionPath.length > 0 ? chunk.sectionPath : null,
          metadata: chunk.metadata,
          contentHash: chunk.contentHash,
          vectorRecordId: chunk.vectorRecordId ?? null,
          createdAt: now,
          updatedAt: now,
        })),
      );
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
