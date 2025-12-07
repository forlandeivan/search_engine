import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CanvasDocument } from "@/types/chat";

type CreateCanvasDocumentInput = {
  chatId: string;
  transcriptId?: string;
  skillId?: string;
  actionId?: string;
  type?: string;
  title: string;
  content: string;
  isDefault?: boolean;
};

type UpdateCanvasDocumentInput = {
  id: string;
  title?: string;
  content?: string;
  isDefault?: boolean;
};

export function useCreateCanvasDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateCanvasDocumentInput) => {
      const res = await fetch("/api/canvas-documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? "Не удалось создать документ");
      }
      return (await res.json()) as { document: CanvasDocument };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/canvas-documents"] });
    },
  });
}

export function useUpdateCanvasDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: UpdateCanvasDocumentInput) => {
      const res = await fetch(`/api/canvas-documents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? "Не удалось обновить документ");
      }
      return (await res.json()) as { document: CanvasDocument };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/canvas-documents"] });
    },
  });
}

export function useDeleteCanvasDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/canvas-documents/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? "Не удалось удалить документ");
      }
      return true;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/canvas-documents"] });
    },
  });
}

export function useDuplicateCanvasDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, title }: { id: string; title?: string }) => {
      const res = await fetch(`/api/canvas-documents/${id}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ title }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? "Не удалось дублировать документ");
      }
      return (await res.json()) as { document: CanvasDocument };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/canvas-documents"] });
    },
  });
}

export function useCanvasDocumentsByTranscript(transcriptId?: string) {
  return useQuery({
    queryKey: ["/api/canvas-documents", "transcript", transcriptId],
    enabled: Boolean(transcriptId),
    queryFn: async () => {
      const res = await fetch(`/api/transcripts/${transcriptId}/canvas-documents`, {
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? "Не удалось загрузить документы холста");
      }
      const data = (await res.json()) as { documents: CanvasDocument[] };
      return data.documents;
    },
  });
}
