import { escapeHtml } from "@/lib/document-import";

export interface DocumentChunk {
  id: string;
  index: number;
  start: number;
  end: number;
  charCount: number;
  wordCount: number;
  excerpt: string;
  content: string;
}

const WHITESPACE_REGEX = /\s+/g;

export function normalizeDocumentText(text: string): string {
  return text.replace(WHITESPACE_REGEX, " ").trim();
}

function countPlainTextWords(text: string): number {
  if (!text) {
    return 0;
  }

  return text.split(/\s+/).filter(Boolean).length;
}

function buildDocumentExcerpt(text: string, maxLength = 200): string {
  const normalized = normalizeDocumentText(text);
  if (!normalized) {
    return "";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trim()}…`;
}

export function extractPlainTextFromHtml(html: string): string {
  if (!html) {
    return "";
  }

  const normalized = html
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/(p|div|section|article|h[1-6])\s*>/gi, "\n\n");

  if (typeof window === "undefined") {
    return normalized.replace(/<[^>]+>/g, "").replace(WHITESPACE_REGEX, " ").trim();
  }

  const container = window.document.createElement("div");
  container.innerHTML = normalized;
  const text = container.textContent ?? "";
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}

interface CreateKnowledgeDocumentChunksOptions {
  idPrefix?: string;
}

export function buildDocumentChunkId(documentId: string, index: number): string {
  const safeIndex = Math.max(0, index);
  return `${documentId}-chunk-${safeIndex + 1}`;
}

export function createKnowledgeDocumentChunks(
  html: string,
  chunkSize: number,
  chunkOverlap: number,
  options?: CreateKnowledgeDocumentChunksOptions,
): { chunks: DocumentChunk[]; normalizedText: string } {
  const plainText = extractPlainTextFromHtml(html);
  const normalizedText = normalizeDocumentText(plainText);

  if (!normalizedText) {
    return { chunks: [], normalizedText: "" };
  }

  const effectiveSize = Math.max(1, chunkSize);
  const effectiveOverlap = Math.max(0, Math.min(chunkOverlap, effectiveSize - 1));
  const step = Math.max(1, effectiveSize - effectiveOverlap);
  const totalLength = normalizedText.length;
  const chunks: DocumentChunk[] = [];

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

    const leadingWhitespaceMatch = slice.match(/^\s*/);
    const leadingOffset = leadingWhitespaceMatch ? leadingWhitespaceMatch[0].length : 0;
    const trimmedStart = start + leadingOffset;
    const trimmedEnd = trimmedStart + trimmed.length;

    const charCount = trimmed.length;
    const wordCount = countPlainTextWords(trimmed);
    const excerpt = buildDocumentExcerpt(trimmed);

    const chunkId = options?.idPrefix
      ? buildDocumentChunkId(options.idPrefix, index)
      : `chunk-${index + 1}`;

    chunks.push({
      id: chunkId,
      content: trimmed,
      index,
      start: trimmedStart,
      end: trimmedEnd,
      charCount,
      wordCount,
      excerpt,
    });

    if (end >= totalLength) {
      break;
    }
  }

  return { chunks, normalizedText };
}

export function replaceChunkInHtml(
  html: string,
  chunk: Pick<DocumentChunk, "start" | "end">,
  replacement: string,
): string {
  if (typeof window === "undefined") {
    return html;
  }

  const normalizedReplacement = normalizeDocumentText(replacement);

  const container = window.document.createElement("div");
  container.innerHTML = html || "";

  const walker = window.document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    null,
  );

  const mapping: Array<{ node: Text; offset: number }> = [];
  const normalizedChars: string[] = [];

  let currentNode = walker.nextNode();
  let prevWasSpace = false;

  while (currentNode) {
    const textNode = currentNode as Text;
    const value = textNode.nodeValue ?? "";

    for (let offset = 0; offset < value.length; offset += 1) {
      const char = value[offset];
      if (/\s/.test(char)) {
        if (normalizedChars.length === 0) {
          prevWasSpace = true;
          continue;
        }
        if (prevWasSpace) {
          continue;
        }
        normalizedChars.push(" ");
        mapping.push({ node: textNode, offset });
        prevWasSpace = true;
      } else {
        normalizedChars.push(char);
        mapping.push({ node: textNode, offset });
        prevWasSpace = false;
      }
    }

    currentNode = walker.nextNode();
  }

  while (normalizedChars.length > 0 && normalizedChars[normalizedChars.length - 1] === " ") {
    normalizedChars.pop();
    mapping.pop();
  }

  if (mapping.length === 0) {
    return normalizedReplacement ? `<p>${escapeHtml(normalizedReplacement)}</p>` : "";
  }

  const safeStart = Math.max(0, Math.min(chunk.start, mapping.length - 1));
  const safeEnd = Math.max(safeStart, Math.min(chunk.end, mapping.length));

  const startMapping = mapping[safeStart];
  const endMapping = mapping[Math.max(safeEnd - 1, safeStart)];

  if (!startMapping || !endMapping) {
    return html;
  }

  const range = window.document.createRange();
  range.setStart(startMapping.node, startMapping.offset);
  range.setEnd(endMapping.node, endMapping.offset + 1);
  range.deleteContents();

  if (normalizedReplacement) {
    range.insertNode(window.document.createTextNode(normalizedReplacement));
  }

  return container.innerHTML;
}
