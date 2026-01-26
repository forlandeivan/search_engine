import DOMPurify from "dompurify";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf";
import pdfWorkerSrc from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import mammoth from "mammoth/mammoth.browser";
import { marked } from "marked";
import JSZip from "jszip";
import { read, utils as xlsxUtils } from "xlsx";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

const TEXT_DECODER_ENCODINGS = ["utf-8", "utf-16le", "windows-1251", "windows-1252"] as const;

const CLEAN_CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

export const SUPPORTED_DOCUMENT_EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "pptx",
  "xlsx",
  "txt",
  "md",
  "markdown",
  "html",
  "htm",
  "eml",
  "csv",
]);

export type DocumentConversionResult = {
  title: string;
  html: string;
};

export const normalizeTitleFromFilename = (filename: string) => {
  const baseName = filename.replace(/\.[^./\\]+$/u, "");
  const cleaned = baseName.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return "Новый документ";
  }

  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
};

export const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const buildHtmlFromPlainText = (text: string, title: string) => {
  const normalized = text.replace(/\r\n/g, "\n");
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const paragraphsHtml = paragraphs
    .map((paragraph) => `<p>${escapeHtml(paragraph.replace(/\n/g, " "))}</p>`)
    .join("");

  return `<h1>${escapeHtml(title)}</h1>${paragraphsHtml}`;
};

export const decodeDocBinaryToText = (buffer: ArrayBuffer) => {
  const view = new Uint8Array(buffer);

  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/3820721a-dfe6-4e19-ad07-3f93ea9c609e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'document-import.ts:67',message:'decodeDocBinaryToText ENTRY',data:{bufferSize:buffer.byteLength,firstBytes:Array.from(view.slice(0,32))},timestamp:Date.now(),sessionId:'debug-session',runId:'initial',hypothesisId:'B,D'})}).catch(()=>{});
  // #endregion

  for (const encoding of TEXT_DECODER_ENCODINGS) {
    try {
      const decoder = new TextDecoder(encoding, { fatal: false });
      const decoded = decoder.decode(view);
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/3820721a-dfe6-4e19-ad07-3f93ea9c609e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'document-import.ts:78',message:'Tried encoding',data:{encoding,decodedLength:decoded.length,decodedPreview:decoded.substring(0,200)},timestamp:Date.now(),sessionId:'debug-session',runId:'initial',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      
      const cleaned = decoded
        .replace(CLEAN_CONTROL_CHARS, "\n")
        .replace(/[\r\f]+/g, "\n")
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .join("\n");
      if (cleaned.length > 0) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/3820721a-dfe6-4e19-ad07-3f93ea9c609e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'document-import.ts:90',message:'Encoding SUCCESS',data:{encoding,cleanedLength:cleaned.length,cleanedPreview:cleaned.substring(0,200)},timestamp:Date.now(),sessionId:'debug-session',runId:'initial',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        return cleaned;
      }
    } catch (error) {
      // Игнорируем ошибку и переходим к следующей кодировке.
      continue;
    }
  }

  return "";
};

export const ensureHeadingInHtml = (html: string, title: string) => {
  if (!html.trim()) {
    return `<h1>${escapeHtml(title)}</h1>`;
  }

  if (/<h[1-6][^>]*>/i.test(html)) {
    return html;
  }

  return `<h1>${escapeHtml(title)}</h1>${html}`;
};

export const getSanitizedContent = (html: string) => {
  if (!html) {
    return "";
  }

  if (typeof window === "undefined") {
    return html;
  }

  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
};

export const extractTitleFromContent = (html: string) => {
  if (!html) {
    return "Без названия";
  }

  if (typeof window === "undefined") {
    return "Без названия";
  }

  const container = window.document.createElement("div");
  container.innerHTML = html;

  const heading = container.querySelector("h1, h2, h3, h4, h5, h6");
  const headingText = heading?.textContent?.trim();
  if (headingText) {
    return headingText;
  }

  const textContent = container
    .textContent?.split(/\n+/)
    .map((line) => line.trim())
    .find(Boolean);
  return textContent || "Без названия";
};

const detectIsZipContainer = (buffer: ArrayBuffer) => {
  const view = new Uint8Array(buffer.slice(0, 2));
  return view.length === 2 && view[0] === 0x50 && view[1] === 0x4b;
};

const assertExtensionMatchesContent = (extension: string, buffer: ArrayBuffer) => {
  const prefix = new Uint8Array(buffer.slice(0, 4));

  if (extension === "pdf") {
    if (!(prefix[0] === 0x25 && prefix[1] === 0x50 && prefix[2] === 0x44 && prefix[3] === 0x46)) {
      throw new Error("Файл не похож на PDF-документ");
    }
  }

  // Для .docx проверяем ZIP контейнер (Office Open XML)
  // Для .doc не проверяем, так как это бинарный формат Word 97-2003
  if (["docx", "pptx", "xlsx"].includes(extension)) {
    if (!detectIsZipContainer(buffer)) {
      throw new Error("Файл не соответствует ожидаемому формату Office OpenXML");
    }
  }
};

const convertPdfToHtml = async (buffer: ArrayBuffer, title: string) => {
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const textChunks: string[] = [];

  for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
    const page = await pdf.getPage(pageIndex);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: any) => (typeof item.str === "string" ? item.str : ""))
      .join(" ");
    if (pageText.trim()) {
      textChunks.push(pageText.trim());
    }
  }

  const plainText = textChunks.join("\n\n");
  if (!plainText.trim()) {
    return `<h1>${escapeHtml(title)}</h1>`;
  }

  return buildHtmlFromPlainText(plainText, title);
};

/**
 * Конвертирует DOCX файл в HTML используя библиотеку mammoth
 * Только для .docx формата (Office Open XML)
 * Для .doc формата используется decodeDocBinaryToText fallback
 */
const convertDocBufferToHtml = async (buffer: ArrayBuffer, title: string) => {
  try {
    const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
    const html = ensureHeadingInHtml(result.value || "", title);
    if (html.trim()) {
      return html;
    }
  } catch (error) {
    // Падение mammoth не критично — переходим к эвристическому извлечению текста.
  }

  const extractedText = decodeDocBinaryToText(buffer);
  if (!extractedText) {
    throw new Error("Не удалось прочитать содержимое документа.");
  }

  return buildHtmlFromPlainText(extractedText, title);
};

const convertMarkdownToHtml = async (text: string, title: string) => {
  const html = await marked.parse(text);
  return ensureHeadingInHtml(typeof html === "string" ? html : "", title);
};

const convertCsvToHtml = (text: string, title: string) => {
  const rows = text
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => row.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((cell) => escapeHtml(cell.replace(/^"|"$/g, ""))));

  if (rows.length === 0) {
    return `<h1>${escapeHtml(title)}</h1><p>Файл CSV не содержит данных.</p>`;
  }

  const tableRows = rows
    .map((cells, rowIndex) => {
      const cellTag = rowIndex === 0 ? "th" : "td";
      const cellsHtml = cells.map((cell) => `<${cellTag}>${cell}</${cellTag}>`).join("");
      return `<tr>${cellsHtml}</tr>`;
    })
    .join("");

  return `<h1>${escapeHtml(title)}</h1><table>${tableRows}</table>`;
};

const convertHtmlText = (text: string, title: string) => {
  const trimmed = text.trim();
  if (!trimmed) {
    return `<h1>${escapeHtml(title)}</h1>`;
  }

  return ensureHeadingInHtml(trimmed, title);
};

const convertEmlToHtml = (text: string, title: string) => {
  const [rawHeaders, ...bodyParts] = text.split(/\r?\n\r?\n/);
  const headers = rawHeaders
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, line) => {
      const [key, ...rest] = line.split(":");
      if (!key || rest.length === 0) {
        return acc;
      }

      const headerKey = key.trim().toLowerCase();
      const headerValue = rest.join(":").trim();
      acc[headerKey] = headerValue;
      return acc;
    }, {});

  const importantHeaders = ["from", "to", "cc", "subject", "date"]
    .map((key) => (headers[key] ? `<li><strong>${escapeHtml(key)}:</strong> ${escapeHtml(headers[key])}</li>` : ""))
    .filter(Boolean)
    .join("");

  const bodyText = bodyParts.join("\n\n").trim();
  const isHtmlBody = /<html[\s>]/i.test(bodyText) || /<body[\s>]/i.test(bodyText);
  const bodyHtml = isHtmlBody
    ? bodyText
    : buildHtmlFromPlainText(bodyText || "(Пустое сообщение)", title);

  const detailsSection = importantHeaders ? `<ul>${importantHeaders}</ul>` : "";
  return `<h1>${escapeHtml(title)}</h1>${detailsSection}${bodyHtml}`;
};

const convertPptxToHtml = async (buffer: ArrayBuffer, title: string) => {
  const zip = await JSZip.loadAsync(buffer);
  const slideEntries = Object.keys(zip.files)
    .filter((name) => name.startsWith("ppt/slides/slide") && name.endsWith(".xml"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (slideEntries.length === 0) {
    return `<h1>${escapeHtml(title)}</h1><p>В презентации не найдено слайдов.</p>`;
  }

  const slidesHtml: string[] = [];

  for (const slideName of slideEntries) {
    const file = zip.file(slideName);
    if (!file) {
      continue;
    }

    const xmlContent = await file.async("text");
    const parser = new DOMParser();
    const document = parser.parseFromString(xmlContent, "application/xml");
    const textNodes = Array.from(document.getElementsByTagName("a:t"));
    const slideText = textNodes
      .map((node) => node.textContent?.trim())
      .filter(Boolean)
      .join(" ");

    const slideTitle = slideText ? escapeHtml(slideText) : `Слайд ${slidesHtml.length + 1}`;
    slidesHtml.push(`<section><h2>${slideTitle}</h2></section>`);
  }

  return ensureHeadingInHtml(slidesHtml.join(""), title);
};

const convertXlsxToHtml = async (buffer: ArrayBuffer, title: string) => {
  const workbook = read(buffer, { type: "array" });
  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    return `<h1>${escapeHtml(title)}</h1><p>Документ не содержит листов.</p>`;
  }

  const sheetsHtml = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      return "";
    }

    const tableHtml = xlsxUtils.sheet_to_html(sheet, {
      header: `<h2>${escapeHtml(sheetName)}</h2>`,
      footer: "",
    });

    return tableHtml;
  }).join("");

  return ensureHeadingInHtml(sheetsHtml, title);
};

const decodeTextBuffer = (buffer: ArrayBuffer) => {
  const view = new Uint8Array(buffer);

  for (const encoding of TEXT_DECODER_ENCODINGS) {
    try {
      const decoder = new TextDecoder(encoding, { fatal: false });
      const decoded = decoder.decode(view);
      if (decoded.trim()) {
        return decoded;
      }
    } catch (error) {
      continue;
    }
  }

  return new TextDecoder().decode(view);
};

export const convertBufferToHtml = async ({
  data,
  filename,
}: {
  data: ArrayBuffer;
  filename: string;
}): Promise<DocumentConversionResult> => {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  const title = normalizeTitleFromFilename(filename);

  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/3820721a-dfe6-4e19-ad07-3f93ea9c609e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'document-import.ts:356',message:'convertBufferToHtml ENTRY',data:{filename,extension,bufferSize:data.byteLength,title},timestamp:Date.now(),sessionId:'debug-session',runId:'initial',hypothesisId:'A,C'})}).catch(()=>{});
  // #endregion

  if (!SUPPORTED_DOCUMENT_EXTENSIONS.has(extension)) {
    throw new Error("Неподдерживаемый формат файла");
  }

  // Для .doc не проверяем содержимое, так как это бинарный формат
  if (["pdf", "docx", "pptx", "xlsx"].includes(extension)) {
    assertExtensionMatchesContent(extension, data);
  }

  if (extension === "pdf") {
    return { title, html: await convertPdfToHtml(data, title) };
  }

  if (extension === "doc") {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/3820721a-dfe6-4e19-ad07-3f93ea9c609e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'document-import.ts:376',message:'DOC PATH - sending to server',data:{extension,title,bufferSize:data.byteLength},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'FIX'})}).catch(()=>{});
    // #endregion
    
    // Для старого формата .doc отправляем на сервер для обработки
    try {
      const formData = new FormData();
      const blob = new Blob([data], { type: 'application/msword' });
      formData.append('file', blob, filename);
      
      const workspaceId = (window as any).__WORKSPACE_ID__ || localStorage.getItem('workspaceId') || '';
      const response = await fetch('/api/knowledge/bases/convert-doc', {
        method: 'POST',
        headers: {
          'X-Workspace-Id': workspaceId,
        },
        body: formData,
        credentials: 'include',
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Ошибка сервера' }));
        throw new Error(error.message || 'Не удалось обработать файл на сервере');
      }
      
      const result = await response.json();
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/3820721a-dfe6-4e19-ad07-3f93ea9c609e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'document-import.ts:408',message:'Server conversion SUCCESS',data:{textLength:result.text?.length || 0,textPreview:result.text?.substring(0,200) || ''},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'FIX'})}).catch(()=>{});
      // #endregion
      
      if (!result.text) {
        throw new Error('Сервер не вернул текст');
      }
      
      const html = buildHtmlFromPlainText(result.text, title);
      return { title, html };
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/3820721a-dfe6-4e19-ad07-3f93ea9c609e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'document-import.ts:421',message:'Server conversion FAILED - using fallback',data:{error:error instanceof Error ? error.message : String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'FIX'})}).catch(()=>{});
      // #endregion
      
      // Fallback к клиентской обработке если сервер недоступен
      const extractedText = decodeDocBinaryToText(data);
      if (!extractedText) {
        throw new Error("Не удалось прочитать содержимое документа.");
      }
      const html = buildHtmlFromPlainText(extractedText, title);
      return { title, html };
    }
  }

  if (extension === "docx") {
    return { title, html: await convertDocBufferToHtml(data, title) };
  }

  if (extension === "pptx") {
    return { title, html: await convertPptxToHtml(data, title) };
  }

  if (extension === "xlsx") {
    return { title, html: await convertXlsxToHtml(data, title) };
  }

  const textContent = decodeTextBuffer(data);

  if (extension === "txt") {
    return { title, html: buildHtmlFromPlainText(textContent, title) };
  }

  if (extension === "md" || extension === "markdown") {
    return { title, html: await convertMarkdownToHtml(textContent, title) };
  }

  if (extension === "csv") {
    return { title, html: convertCsvToHtml(textContent, title) };
  }

  if (extension === "eml") {
    return { title, html: convertEmlToHtml(textContent, title) };
  }

  if (extension === "html" || extension === "htm") {
    return { title, html: convertHtmlText(textContent, title) };
  }

  return { title, html: buildHtmlFromPlainText(textContent, title) };
};

export const convertFileToHtml = async (file: File): Promise<DocumentConversionResult> => {
  const buffer = await file.arrayBuffer();
  return convertBufferToHtml({ data: buffer, filename: file.name });
};

