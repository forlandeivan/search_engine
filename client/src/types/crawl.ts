import type { KnowledgeBaseCrawlJobStatus } from "@shared/knowledge-base";

export type CrawlActivityEvent = {
  id: string;
  type: "info" | "error" | "status";
  message: string;
  timestamp: string;
};

export type ActiveCrawlProgress = {
  percent: number;
  discovered: number;
  fetched: number;
  saved: number;
  errors: number;
  queued?: number;
  extracted?: number;
  etaSec?: number | null;
};

export type ActiveCrawlResponse =
  | {
      running: false;
      lastRun?: { job: KnowledgeBaseCrawlJobStatus };
    }
  | {
      running: true;
      runId: string;
      progress: ActiveCrawlProgress;
      job?: KnowledgeBaseCrawlJobStatus;
    };
