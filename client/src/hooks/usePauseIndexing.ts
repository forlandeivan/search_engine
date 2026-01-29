import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export function usePauseIndexing(baseId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/knowledge/bases/${baseId}/indexing/pause`);
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: "Не удалось приостановить индексацию" }));
        throw new Error(error.error || "Не удалось приостановить индексацию");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge/bases", baseId] });
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge/indexing/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge/bases", baseId, "indexing/actions/history"] });
      toast({
        title: "Индексация приостановлена",
        description: "Вы можете возобновить индексацию в любой момент",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useResumeIndexing(baseId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/knowledge/bases/${baseId}/indexing/resume`);
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: "Не удалось возобновить индексацию" }));
        throw new Error(error.error || "Не удалось возобновить индексацию");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge/bases", baseId] });
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge/indexing/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge/bases", baseId, "indexing/actions/history"] });
      toast({
        title: "Индексация возобновлена",
        description: "Обработка документов продолжается",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}
