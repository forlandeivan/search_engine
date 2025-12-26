import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { extractTextFromBuffer, TextExtractionError } from "../server/text-extraction";

function buildDocxBuffer(text: string): Promise<Buffer> {
  const zip = new JSZip();

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );

  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );

  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`,
  );

  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
 xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
 xmlns:v="urn:schemas-microsoft-com:vml"
 xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"
 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
 xmlns:w10="urn:schemas-microsoft-com:office:word"
 xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
 xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
 xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk"
 xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"
 xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
 mc:Ignorable="w14 wp14">
  <w:body>
    <w:p>
      <w:r><w:t>${text}</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`,
  );

  return zip.generateAsync({ type: "nodebuffer" });
}

function buildPdfBuffer(text: string): Buffer {
  const objects: string[] = [];

  const catalog = `1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n`;
  const pages = `2 0 obj<< /Type /Pages /Count 1 /Kids [3 0 R] >>endobj\n`;
  const page = `3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj\n`;
  const contentStream = `BT /F1 18 Tf 20 180 Td (${text}) Tj ET`;
  const contents = `4 0 obj<< /Length ${Buffer.byteLength(contentStream)} >>stream\n${contentStream}\nendstream\nendobj\n`;
  const font = `5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n`;

  const parts: string[] = [];
  parts.push("%PDF-1.4\n");
  const offsets: number[] = [0];

  const append = (chunk: string) => {
    const current = parts.join("").length;
    offsets.push(current);
    parts.push(chunk);
  };

  append(catalog);
  append(pages);
  append(page);
  append(contents);
  append(font);

  const xrefOffset = parts.join("").length;
  const xrefEntries = offsets
    .map((offset, index) => {
      const padded = offset.toString().padStart(10, "0");
      const marker = index === 0 ? "f" : "n";
      return `${padded} 00000 ${marker} \n`;
    })
    .join("");

  const xref = `xref\n0 ${offsets.length}\n${xrefEntries}`;
  const trailer = `trailer<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  parts.push(xref);
  parts.push(trailer);

  return Buffer.from(parts.join(""), "utf8");
}

describe("text extraction", () => {
  it("extracts plain text from txt", async () => {
    const buffer = Buffer.from("Hello text\nSecond line", "utf8");
    const result = await extractTextFromBuffer({ buffer, filename: "file.txt", mimeType: "text/plain" });
    expect(result.text).toContain("Hello text");
    expect(result.text).toContain("Second line");
  });

  it("fails on empty text", async () => {
    const buffer = Buffer.from("   \n\t", "utf8");
    await expect(
      extractTextFromBuffer({ buffer, filename: "empty.txt", mimeType: "text/plain" }),
    ).rejects.toBeInstanceOf(TextExtractionError);
  });

  it("extracts text from docx", async () => {
    const buffer = await buildDocxBuffer("Hello DOCX");
    const result = await extractTextFromBuffer({ buffer, filename: "file.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    expect(result.text).toContain("Hello DOCX");
  });

  it("extracts text from pdf", async () => {
    const buffer = buildPdfBuffer("Hello PDF");
    const result = await extractTextFromBuffer({ buffer, filename: "file.pdf", mimeType: "application/pdf" });
    expect(result.text).toContain("Hello PDF");
  });
});
