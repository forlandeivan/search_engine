/**
 * Tree Menu Component
 * 
 * Recursive tree navigation component for knowledge base nodes
 */

import { useCallback } from "react";
import { Link } from "wouter";
import { ChevronDown, ChevronRight, FileText, Folder, Globe2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { KnowledgeBaseTreeNode } from "@shared/knowledge-base";

export type TreeMenuProps = {
  baseId: string;
  nodes: KnowledgeBaseTreeNode[];
  activeNodeId: string | null;
  expandedNodes: Set<string>;
  onToggle: (nodeId: string) => void;
  level?: number;
};

export function TreeMenu({
  baseId,
  nodes,
  activeNodeId,
  expandedNodes,
  onToggle,
  level = 0,
}: TreeMenuProps) {
  return (
    <ul className={cn("space-y-1 text-sm", level > 0 && "border-l border-border/40 pl-4")}>
      {nodes.map((node) => {
        const isActive = activeNodeId === node.id;
        const children = node.children ?? [];
        const hasChildren = children.length > 0;
        const isExpanded = hasChildren && expandedNodes.has(node.id);

        return (
          <li key={node.id} className="space-y-1">
            <div className="flex items-center gap-1">
              {hasChildren ? (
                <button
                  type="button"
                  className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted"
                  onClick={() => onToggle(node.id)}
                  aria-label={isExpanded ? "Свернуть вложенные элементы" : "Развернуть вложенные элементы"}
                  aria-expanded={isExpanded}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </button>
              ) : (
                <span className="h-6 w-6 flex-shrink-0" />
              )}
              <Link
                href={`/knowledge/${baseId}/node/${node.id}`}
                className={cn(
                  "flex flex-1 items-center gap-2 rounded-md px-2 py-1 transition min-w-0",
                  isActive ? "bg-primary/10 text-primary" : "hover:bg-muted",
                )}
              >
                {node.type === "folder" ? (
                  <Folder className="h-4 w-4 flex-shrink-0" />
                ) : (
                  <FileText className="h-4 w-4 flex-shrink-0" />
                )}
                <span className="flex-1 truncate min-w-0 break-words">{node.title}</span>
                {node.type === "document" && node.sourceType === "crawl" && (
                  <span className="flex items-center flex-shrink-0">
                    <Globe2 aria-hidden="true" className="h-3.5 w-3.5 text-emerald-500" />
                    <span className="sr-only">Документ создан краулингом</span>
                  </span>
                )}
              </Link>
            </div>
            {hasChildren && isExpanded && (
              <TreeMenu
                baseId={baseId}
                nodes={children}
                activeNodeId={activeNodeId}
                expandedNodes={expandedNodes}
                onToggle={onToggle}
                level={level + 1}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
