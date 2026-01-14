import { useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import type { KnowledgeBaseIndexingAction, IndexingStage } from "@shared/schema";
import { Progress } from "@/components/ui/progress";

const STAGE_DISPLAY_TEXTS: Record<IndexingStage, string> = {
  initializing: "Инициализация...",
  creating_collection: "Создаём коллекцию...",
  chunking: "Разбиваем на фрагменты...",
  vectorizing: "Векторизуем...",
  uploading: "Загружаем в коллекцию...",
  verifying: "Проверяем данные...",
  completed: "Завершено",
  error: "Ошибка",
};

interface KnowledgeBaseIndexingProgressToastProps {
  action: KnowledgeBaseIndexingAction | null;
  onComplete?: () => void;
}

export function KnowledgeBaseIndexingProgressToast({
  action,
  onComplete,
}: KnowledgeBaseIndexingProgressToastProps) {
  const { toast } = useToast();
  const toastRef = useRef<{ id: string; dismiss: () => void; update: (props: any) => void } | null>(null);

  useEffect(() => {
    if (!action) {
      if (toastRef.current) {
        toastRef.current.dismiss();
        toastRef.current = null;
      }
      return;
    }

    const displayText = action.displayText ?? STAGE_DISPLAY_TEXTS[action.stage] ?? "Индексация...";
    const progressPercent =
      typeof action.payload?.progressPercent === "number" ? action.payload.progressPercent : null;
    const totalDocuments = typeof action.payload?.totalDocuments === "number" ? action.payload.totalDocuments : null;
    const processedDocuments =
      typeof action.payload?.processedDocuments === "number" ? action.payload.processedDocuments : null;

    let description = displayText;
    if (totalDocuments !== null && processedDocuments !== null) {
      description = `${displayText} (${processedDocuments} из ${totalDocuments} документов)`;
    }

    if (action.status === "done" || action.status === "error") {
      if (toastRef.current) {
        toastRef.current.update({
          title: action.status === "done" ? "Индексация завершена" : "Ошибка индексации",
          description: displayText,
          variant: action.status === "error" ? "destructive" : "default",
          duration: action.status === "error" ? 5000 : 3000,
        });
        // Дисмиссим через некоторое время
        setTimeout(() => {
          if (toastRef.current) {
            toastRef.current.dismiss();
            toastRef.current = null;
          }
        }, action.status === "error" ? 5000 : 3000);
      } else {
        const t = toast({
          title: action.status === "done" ? "Индексация завершена" : "Ошибка индексации",
          description: displayText,
          variant: action.status === "error" ? "destructive" : "default",
          duration: action.status === "error" ? 5000 : 3000,
        });
        toastRef.current = t;
        setTimeout(() => {
          if (toastRef.current) {
            toastRef.current.dismiss();
            toastRef.current = null;
          }
        }, action.status === "error" ? 5000 : 3000);
      }
      if (action.status === "done" && onComplete) {
        onComplete();
      }
    } else {
      if (toastRef.current) {
        // Обновляем существующий toast
        toastRef.current.update({
          title: "Индексация запущена",
          description: (
            <div className="space-y-2 w-full">
              <p className="text-sm">{description}</p>
              {progressPercent !== null && <Progress value={progressPercent} className="h-2" />}
              {progressPercent === null && totalDocuments !== null && processedDocuments !== null && (
                <Progress
                  value={totalDocuments > 0 ? (processedDocuments / totalDocuments) * 100 : 0}
                  className="h-2"
                />
              )}
            </div>
          ),
          duration: Infinity,
        });
      } else {
        // Создаем новый toast
        const t = toast({
          title: "Индексация запущена",
          description: (
            <div className="space-y-2 w-full">
              <p className="text-sm">{description}</p>
              {progressPercent !== null && <Progress value={progressPercent} className="h-2" />}
              {progressPercent === null && totalDocuments !== null && processedDocuments !== null && (
                <Progress
                  value={totalDocuments > 0 ? (processedDocuments / totalDocuments) * 100 : 0}
                  className="h-2"
                />
              )}
            </div>
          ),
          duration: Infinity,
        });
        toastRef.current = t;
      }
    }
  }, [action, toast, onComplete]);

  return null;
}

