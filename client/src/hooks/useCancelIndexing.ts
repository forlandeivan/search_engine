import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export function useCancelIndexing(baseId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ deleteIndexedData }: { deleteIndexedData: boolean }) => {
      const res = await apiRequest("POST", `/api/knowledge/bases/${baseId}/indexing/cancel`, {
        deleteIndexedData,
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: "Не удалось отменить индексацию" }));
        throw new Error(error.error || "Не удалось отменить индексацию");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries(["/api/knowledge/bases", baseId]);
      queryClient.invalidateQueries(["/api/knowledge/indexing/active"]);
      queryClient.invalidateQueries(["/api/knowledge/bases", baseId, "indexing/actions/history"]);
      toast({
        title: "Индексация отменена",
        description: data.message || "Обработка документов остановлена",
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
