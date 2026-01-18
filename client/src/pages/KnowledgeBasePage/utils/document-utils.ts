/**
 * Utilities for working with knowledge base documents
 */

export type DocumentContentBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] };

export function formatDateTime(value?: string | null): string {
  if (!value) {
    return "Недавно";
  }

  try {
    return new Intl.DateTimeFormat("ru-RU", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch (error) {
    return "Недавно";
  }
}

export function normalizeBlockText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

export function extractDocumentBlocks(html: string): DocumentContentBlock[] {
  if (!html || !html.trim()) {
    return [];
  }

  if (typeof window === "undefined") {
    const text = normalizeBlockText(html.replace(/<[^>]+>/g, " "));
    return text ? [{ type: "paragraph", text }] : [];
  }

  const container = window.document.createElement("div");
  container.innerHTML = html;
  const blocks: DocumentContentBlock[] = [];

  const processElement = (element: Element) => {
    const tag = element.tagName.toLowerCase();

    if (/^h[1-6]$/.test(tag)) {
      const text = normalizeBlockText(element.textContent ?? "");
      if (text) {
        const level = Number.parseInt(tag.slice(1), 10);
        const bounded = Math.min(Math.max(level, 1), 3) as 1 | 2 | 3;
        blocks.push({ type: "heading", level: bounded, text });
      }
      return;
    }

    if (tag === "p" || tag === "pre" || tag === "blockquote") {
      const text = normalizeBlockText(element.textContent ?? "");
      if (text) {
        blocks.push({ type: "paragraph", text });
      }
      return;
    }

    if (tag === "ul" || tag === "ol") {
      const items = Array.from(element.querySelectorAll(":scope > li"))
        .map((item) => normalizeBlockText(item.textContent ?? ""))
        .filter(Boolean);
      if (items.length > 0) {
        blocks.push({ type: "list", ordered: tag === "ol", items });
      }
      return;
    }

    if (tag === "div" || tag === "section" || tag === "article") {
      const children = Array.from(element.children);
      if (children.length === 0) {
        const text = normalizeBlockText(element.textContent ?? "");
        if (text) {
          blocks.push({ type: "paragraph", text });
        }
      } else {
        children.forEach(processElement);
      }
      return;
    }

    const text = normalizeBlockText(element.textContent ?? "");
    if (text) {
      blocks.push({ type: "paragraph", text });
    }
  };

  Array.from(container.childNodes).forEach((node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      processElement(node as Element);
    } else if (node.nodeType === Node.TEXT_NODE) {
      const text = normalizeBlockText(node.textContent ?? "");
      if (text) {
        blocks.push({ type: "paragraph", text });
      }
    }
  });

  return blocks;
}

export function buildDocumentFileName(title: string, extension: string): string {
  const normalized = title.replace(/[<>:"/\\|?*]+/g, "").trim();
  const collapsed = normalized.replace(/\s+/g, "_").slice(0, 80);
  const safeBase = collapsed || "document";
  return `${safeBase}.${extension}`;
}
