import { createHash } from "crypto";
import { MIN_CHUNK_SIZE, MAX_CHUNK_SIZE } from "@shared/indexing-rules";

export type SkillFileChunk = {
  id: string;
  index: number;
  text: string;
  start: number;
  end: number;
  charCount: number;
  tokenCount: number;
};

export class ChunkingError extends Error {
  constructor(
    message: string,
    public code:
      | "CHUNKING_INVALID_SETTINGS"
      | "CHUNKING_TOO_MANY_CHUNKS"
      | "CHUNKING_EMPTY_RESULT",
  ) {
    super(message);
    this.name = "ChunkingError";
  }
}

export const MAX_CHUNKS_PER_FILE = Math.ceil(2_000_000 / MIN_CHUNK_SIZE); // опираемся на MAX_DOC_TOKENS и минимальный chunk_size

const CLEAN_CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

function normalizePlainText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(CLEAN_CONTROL_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function deterministicChunkId(fileId: string, fileVersion: number, index: number): string {
  const raw = `${fileId}:${fileVersion}:${index}`;
  const hash = createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 16);
  return `sfch_${hash}`;
}

export function chunkSkillFileText(params: {
  text: string;
  chunkSize: number;
  chunkOverlap: number;
  fileId: string;
  fileVersion: number;
}): { chunks: SkillFileChunk[]; totalChars: number; totalTokens: number } {
  const normalizedText = normalizePlainText(params.text);
  if (!normalizedText) {
    throw new ChunkingError(
      "Не удалось подготовить текст для чанкинга",
      "CHUNKING_EMPTY_RESULT",
    );
  }

  if (
    params.chunkSize < MIN_CHUNK_SIZE ||
    params.chunkSize > MAX_CHUNK_SIZE ||
    params.chunkOverlap < 0 ||
    params.chunkOverlap >= params.chunkSize
  ) {
    throw new ChunkingError(
      "Некорректные настройки чанкинга: проверьте размер чанка и overlap",
      "CHUNKING_INVALID_SETTINGS",
    );
  }

  const effectiveSize = Math.max(1, params.chunkSize);
  const effectiveOverlap = Math.max(0, Math.min(params.chunkOverlap, effectiveSize - 1));
  const step = Math.max(1, effectiveSize - effectiveOverlap);
  const totalLength = normalizedText.length;
  const chunks: SkillFileChunk[] = [];

  for (let start = 0, index = 0; start < totalLength; start += step, index += 1) {
    const end = Math.min(start + effectiveSize, totalLength);
    const slice = normalizedText.slice(start, end);
    const trimmed = slice.trim();

    if (!trimmed) {
      if (end >= totalLength) {
        break;
      }
      continue;
    }

    const charCount = trimmed.length;
    const tokenCount = trimmed.split(/\s+/).filter(Boolean).length;

    chunks.push({
      id: deterministicChunkId(params.fileId, params.fileVersion, index),
      index,
      text: trimmed,
      start,
      end,
      charCount,
      tokenCount,
    });

    if (end >= totalLength) {
      break;
    }
  }

  if (chunks.length === 0) {
    throw new ChunkingError(
      "Не удалось нарезать документ на чанки",
      "CHUNKING_EMPTY_RESULT",
    );
  }

  if (chunks.length > MAX_CHUNKS_PER_FILE) {
    throw new ChunkingError(
      "Документ слишком большой для текущих настроек чанкинга. Увеличьте размер чанка или разбейте документ на части.",
      "CHUNKING_TOO_MANY_CHUNKS",
    );
  }

  const totalChars = chunks.reduce((sum, chunk) => sum + chunk.charCount, 0);
  const totalTokens = chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0);

  return { chunks, totalChars, totalTokens };
}
