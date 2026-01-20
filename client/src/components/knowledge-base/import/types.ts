import type { ComponentType } from "react";
import type { KnowledgeBaseSourceType } from "@shared/schema";

export type ImportMode = KnowledgeBaseSourceType;

export type ImportModeOption = {
  value: ImportMode;
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  disabled?: boolean;
};

export type CrawlMode = "single" | "multiple";

export type CrawlConfig = {
  startUrls: string[];
  sitemapUrl?: string;
  allowedDomains?: string[];
  include?: string[];
  exclude?: string[];
  maxPages?: number;
  maxDepth?: number;
  rateLimitRps?: number;
  robotsTxt?: boolean;
  selectors?: {
    title?: string;
    content?: string;
  };
  language?: string;
  version?: string;
  authHeaders?: Record<string, string>;
};

export type ProcessedFileResult = {
  file: File;
  title: string;
  content: string;
  error?: string;
};
