import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Transcript } from "@/types/chat";

export function useTranscript(workspaceId: string, transcriptId: string) {
  return useQuery({
    queryKey: ["/api/workspaces", workspaceId, "transcripts", transcriptId],
    queryFn: async () => {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/transcripts/${transcriptId}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to load transcript");
      return res.json() as Promise<Transcript>;
    },
    enabled: Boolean(workspaceId && transcriptId),
  });
}

export function useUpdateTranscript(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      transcriptId,
      fullText,
      title,
    }: {
      transcriptId: string;
      fullText: string;
      title?: string;
    }) => {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/transcripts/${transcriptId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ fullText, title }),
        }
      );
      if (!res.ok) throw new Error("Failed to update transcript");
      return res.json() as Promise<Transcript>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/workspaces", workspaceId, "transcripts", data.id],
      });
    },
  });
}
