import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import { cn } from "@/lib/utils";

interface MarkdownRendererProps {
  markdown: string;
  className?: string;
}

export function MarkdownRenderer({ markdown, className }: MarkdownRendererProps) {
  if (!markdown || !markdown.trim()) {
    return null;
  }

  return (
    <div className={cn("prose prose-sm max-w-none dark:prose-invert", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSlug], [rehypeAutolinkHeadings, { behavior: "wrap" }]]}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

export default MarkdownRenderer;
