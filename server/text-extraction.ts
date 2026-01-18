import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import mammoth from "mammoth";
import { TextDecoder } from "util";
import { fileURLToPath } from "url";
import path from "path";
import { extname } from "path";
import type { Readable } from "stream";
import { getWorkspaceFile } from "./workspace-storage-service";

type SupportedExtension = "pdf" | "doc" | "docx" | "txt";

export type TextExtractionResult = {
  text: string;
  contentType: string | null;
  bytes: number;
};

const TEXT_DECODER_ENCODINGS = ["utf-8", "utf-16le", "windows-1251", "windows-1252"] as const;
const CLEAN_CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
const MIN_TEXT_LENGTH = 8;

const pdfWorkerOptions = pdfjsLib.GlobalWorkerOptions as unknown as {
  disableWorker?: boolean;
  standardFontDataUrl?: string | undefined;
};
pdfWorkerOptions.disableWorker = true;
// Use system fonts instead of external CDN
pdfWorkerOptions.standardFontDataUrl = undefined;

export class TextExtractionError extends Error {
  public code: "TEXT_EXTRACTION_FAILED" | "TEXT_EMPTY_AFTER_EXTRACTION" | "TEXT_UNSUPPORTED" | "STORAGE_UNAVAILABLE";
  public retryable: boolean;

  constructor(params: { message: string; code: TextExtractionError["code"]; retryable?: boolean }) {
    super(params.message);
    this.name = "TextExtractionError";
    this.code = params.code;
    this.retryable = params.retryable ?? false;
  }
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    if (chunk instanceof Buffer) {
      chunks.push(chunk);
    } else if (typeof chunk === "string") {
      chunks.push(Buffer.from(chunk));
    } else {
      chunks.push(Buffer.from(chunk as Uint8Array | ArrayLike<number>));
    }
  }
  return Buffer.concat(chunks);
}

function normalizeExtension(filename: string, mimeType?: string | null): SupportedExtension | null {
  const fromName = extname(filename || "").toLowerCase().replace(/^\./, "");
  const candidate = fromName || (mimeType || "").toLowerCase();
  if (["pdf", "doc", "docx", "txt"].includes(candidate)) {
    return candidate as SupportedExtension;
  }

  if (mimeType?.includes("pdf")) return "pdf";
  if (mimeType?.includes("msword")) return "doc";
  if (mimeType?.includes("officedocument.wordprocessingml.document")) return "docx";
  if (mimeType?.includes("text/plain")) return "txt";
  return null;
}

function decodeTextBuffer(buffer: Buffer): string {
  for (const encoding of TEXT_DECODER_ENCODINGS) {
    try {
      const decoder = new TextDecoder(encoding, { fatal: false });
      const decoded = decoder.decode(buffer);
      if (decoded.trim()) {
        return decoded;
      }
    } catch {
      continue;
    }
  }

  return new TextDecoder().decode(buffer);
}

function decodeDocBinaryToText(buffer: Buffer): string {
  for (const encoding of TEXT_DECODER_ENCODINGS) {
    try {
      const decoder = new TextDecoder(encoding, { fatal: false });
      const decoded = decoder
        .decode(buffer)
        .replace(CLEAN_CONTROL_CHARS, "\n")
        .replace(/[\r\f]+/g, "\n")
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .join("\n");

      if (decoded.length > 0) {
        return decoded;
      }
    } catch {
      continue;
    }
  }

  return "";
}

async function extractPdf(buffer: Buffer): Promise<string> {
  const uint8 = new Uint8Array(buffer);
  const loadingTask = pdfjsLib.getDocument({
    data: uint8,
    useWorkerFetch: false,
    standardFontDataUrl: pdfjsLib.GlobalWorkerOptions.standardFontDataUrl,
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;
  const textChunks: string[] = [];

  for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
    const page = await pdf.getPage(pageIndex);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: { str?: string }) => (typeof item.str === "string" ? item.str : ""))
      .join(" ");
    if (pageText.trim()) {
      textChunks.push(pageText.trim());
    }
  }

  return textChunks.join("\n\n");
}

async function extractDoc(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    if (typeof result.value === "string" && result.value.trim()) {
      return result.value;
    }
  } catch {
    // fallback ниже
  }

  return decodeDocBinaryToText(buffer);
}

export async function extractTextFromBuffer(params: {
  buffer: Buffer;
  filename: string;
  mimeType?: string | null;
}): Promise<TextExtractionResult> {
  const { buffer, filename, mimeType } = params;
  const extension = normalizeExtension(filename, mimeType);
  if (!extension) {
    throw new TextExtractionError({
      code: "TEXT_UNSUPPORTED",
      message: "Неподдерживаемый формат файла",
      retryable: false,
    });
  }

  let text = "";

  try {
    if (extension === "txt") {
      text = decodeTextBuffer(buffer);
    } else if (extension === "pdf") {
      text = await extractPdf(buffer);
    } else if (extension === "doc" || extension === "docx") {
      text = await extractDoc(buffer);
    } else {
      throw new TextExtractionError({
        code: "TEXT_UNSUPPORTED",
        message: "Неподдерживаемый формат файла",
        retryable: false,
      });
    }
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Не удалось извлечь текст из файла. Попробуйте другой файл.";
    throw new TextExtractionError({
      code: "TEXT_EXTRACTION_FAILED",
      message,
      retryable: false,
    });
  }

  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length < MIN_TEXT_LENGTH) {
    throw new TextExtractionError({
      code: "TEXT_EMPTY_AFTER_EXTRACTION",
      message:
        "Не удалось извлечь текст из файла. Проверьте, что документ не является сканом без текста или не повреждён.",
      retryable: false,
    });
  }

  return {
    text: normalized,
    contentType: mimeType ?? null,
    bytes: buffer.length,
  };
}

export async function extractSkillFileText(params: {
  workspaceId: string;
  storageKey: string;
  filename: string;
  mimeType?: string | null;
}): Promise<TextExtractionResult> {
  const { workspaceId, storageKey, filename, mimeType } = params;
  let object;
  try {
    object = await getWorkspaceFile(workspaceId, storageKey);
  } catch (error) {
    throw new TextExtractionError({
      code: "STORAGE_UNAVAILABLE",
      message: "Не удалось получить файл из хранилища. Попробуйте позже.",
      retryable: true,
    });
  }

  if (!object?.body) {
    throw new TextExtractionError({
      code: "TEXT_EXTRACTION_FAILED",
      message: "Файл не найден в хранилище",
      retryable: false,
    });
  }

  const buffer = await streamToBuffer(object.body);
  return extractTextFromBuffer({ buffer, filename, mimeType: mimeType ?? object.contentType ?? null });
}
