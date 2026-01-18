/**
 * Utilities for working with knowledge base tree structures
 */

import type { KnowledgeBaseTreeNode } from "@shared/knowledge-base";
import type { FolderOption } from "../types";

export function hasNode(nodes: KnowledgeBaseTreeNode[], nodeId: string): boolean {
  for (const node of nodes) {
    if (node.id === nodeId) {
      return true;
    }

    if (node.children && hasNode(node.children, nodeId)) {
      return true;
    }
  }

  return false;
}

export function collectFolderOptions(
  nodes: KnowledgeBaseTreeNode[],
  level = 0,
  accumulator: FolderOption[] = [],
): FolderOption[] {
  for (const node of nodes) {
    accumulator.push({ id: node.id, title: node.title, level, type: node.type });
    if (node.children) {
      collectFolderOptions(node.children, level + 1, accumulator);
    }
  }

  return accumulator;
}

export function buildDescendantMap(
  nodes: KnowledgeBaseTreeNode[],
  accumulator = new Map<string, Set<string>>(),
): Map<string, Set<string>> {
  const traverse = (node: KnowledgeBaseTreeNode): Set<string> => {
    const descendants = new Set<string>();

    if (node.children) {
      for (const child of node.children) {
        descendants.add(child.id);
        const childDesc = traverse(child);
        for (const value of childDesc) {
          descendants.add(value);
        }
      }
    }

    accumulator.set(node.id, descendants);
    return descendants;
  };

  for (const node of nodes) {
    traverse(node);
  }

  return accumulator;
}

export function buildParentMap(
  nodes: KnowledgeBaseTreeNode[],
  parentId: string | null = null,
  accumulator: Map<string, string | null> = new Map(),
): Map<string, string | null> {
  for (const node of nodes) {
    accumulator.set(node.id, parentId);
    if (node.children) {
      buildParentMap(node.children, node.id, accumulator);
    }
  }

  return accumulator;
}
