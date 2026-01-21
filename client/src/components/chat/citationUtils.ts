import type { RagChunk } from "@/types/search";

export type GroupedCitation = {
  docId: string;
  docTitle: string;
  nodeId: string | null;
  nodeSlug: string | null;
  chunks: RagChunk[];
  topScore: number;
  totalScore: number;
};

export function groupCitationsByDocument(citations: RagChunk[]): GroupedCitation[] {
  const groupMap = new Map<string, GroupedCitation>();

  for (const citation of citations) {
    const docId = citation.doc_id;
    
    if (!groupMap.has(docId)) {
      groupMap.set(docId, {
        docId,
        docTitle: citation.doc_title || `Документ ${groupMap.size + 1}`,
        nodeId: citation.node_id || null,
        nodeSlug: citation.node_slug || null,
        chunks: [],
        topScore: 0,
        totalScore: 0,
      });
    }

    const group = groupMap.get(docId)!;
    group.chunks.push(citation);
    
    // Используем vector score для релевантности (более точный показатель),
    // fallback на combined score если vector score недоступен
    const relevanceScore = citation.scores?.vector ?? citation.score ?? 0;
    group.totalScore += relevanceScore;
    
    if (relevanceScore > group.topScore) {
      group.topScore = relevanceScore;
    }
  }

  // Сортируем группы по максимальной релевантности
  const groups = Array.from(groupMap.values());
  groups.sort((a, b) => b.topScore - a.topScore);

  // Сортируем чанки внутри каждой группы по vector score (или combined score)
  for (const group of groups) {
    group.chunks.sort((a, b) => {
      const scoreA = a.scores?.vector ?? a.score ?? 0;
      const scoreB = b.scores?.vector ?? b.score ?? 0;
      return scoreB - scoreA;
    });
  }

  return groups;
}

export function getSourcesSummary(groups: GroupedCitation[]): string {
  const totalDocs = groups.length;
  const totalChunks = groups.reduce((sum, g) => sum + g.chunks.length, 0);
  
  if (totalDocs === totalChunks) {
    return `${totalDocs} ${pluralize(totalDocs, "источник", "источника", "источников")}`;
  }
  
  return `${totalDocs} ${pluralize(totalDocs, "документ", "документа", "документов")}, ${totalChunks} ${pluralize(totalChunks, "фрагмент", "фрагмента", "фрагментов")}`;
}

function pluralize(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  
  if (mod100 >= 11 && mod100 <= 19) {
    return many;
  }
  if (mod10 === 1) {
    return one;
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return few;
  }
  return many;
}
