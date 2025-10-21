import { useEffect, useRef, useState, type ChangeEvent, type ComponentType } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useCreateKnowledgeBase } from "@/hooks/useCreateKnowledgeBase";
import type { KnowledgeBase, KnowledgeBaseSourceType } from "@/lib/knowledge-base";
import { FolderArchive, Globe, NotebookPen } from "lucide-react";

type CreationOption = {
  value: KnowledgeBaseSourceType;
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
};

export const KNOWLEDGE_BASE_CREATION_OPTIONS: CreationOption[] = [
  {
    value: "blank",
    title: "Пустая база",
    description: "Создайте структуру с нуля и наполняйте контент вручную или с помощью AI.",
    icon: NotebookPen,
  },
  {
    value: "archive",
    title: "Импорт архива",
    description: "Загрузите ZIP-архив документов, чтобы автоматически разложить их в иерархию.",
    icon: FolderArchive,
  },
  {
    value: "crawler",
    title: "Краулинг сайта",
    description: "Подключите корпоративный портал или знания из публичного сайта для автообновления.",
    icon: Globe,
  },
];

type CreateKnowledgeBaseDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMode?: KnowledgeBaseSourceType;
  onCreated?: (base: KnowledgeBase) => void;
};

export function CreateKnowledgeBaseDialog({
  open,
  onOpenChange,
  initialMode = "blank",
  onCreated,
}: CreateKnowledgeBaseDialogProps) {
  const archiveInputRef = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<KnowledgeBaseSourceType>(initialMode);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [archiveFile, setArchiveFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const createBaseMutation = useCreateKnowledgeBase();

  const resetForm = () => {
    setName("");
    setDescription("");
    setSourceUrl("");
    setArchiveFile(null);
    setError(null);
    if (archiveInputRef.current) {
      archiveInputRef.current.value = "";
    }
  };

  useEffect(() => {
    if (open) {
      setMode(initialMode);
    }
  }, [initialMode, open]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetForm();
    }
    onOpenChange(nextOpen);
  };

  const handleModeChange = (value: KnowledgeBaseSourceType) => {
    setMode(value);
    setError(null);
    if (value !== "archive") {
      setArchiveFile(null);
      if (archiveInputRef.current) {
        archiveInputRef.current.value = "";
      }
    }
    if (value !== "crawler") {
      setSourceUrl("");
    }
  };

  const handleArchiveChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setArchiveFile(file);
  };

  const handleSubmit = async () => {
    if (createBaseMutation.isPending) {
      return;
    }

    if (!name.trim()) {
      setError("Укажите название базы знаний");
      return;
    }

    if (mode === "archive" && !archiveFile) {
      setError("Выберите архив документов для импорта");
      return;
    }

    if (mode === "crawler" && !sourceUrl.trim()) {
      setError("Укажите ссылку на сайт для краулинга");
      return;
    }

    setError(null);

    try {
      const created = await createBaseMutation.mutateAsync({
        name,
        description,
        mode,
        archiveFile,
        sourceUrl,
      });

      onCreated?.(created);
      handleOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось создать базу знаний. Попробуйте снова.";
      setError(message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Создание базы знаний</DialogTitle>
          <DialogDescription>
            Выберите подходящий сценарий, задайте название и при необходимости укажите источники данных.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid gap-2 sm:grid-cols-3">
            {KNOWLEDGE_BASE_CREATION_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleModeChange(option.value)}
                className={cn(
                  "flex flex-col gap-2 rounded-lg border p-3 text-left transition",
                  mode === option.value ? "border-primary bg-primary/5" : "hover:border-primary/40",
                )}
              >
                <div className="flex items-center gap-2">
                  <option.icon className="h-4 w-4" />
                  <span className="text-sm font-semibold">{option.title}</span>
                </div>
                <p className="text-xs text-muted-foreground">{option.description}</p>
              </button>
            ))}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="create-base-name">
              Название базы знаний
            </label>
            <Input
              id="create-base-name"
              placeholder="Например, База знаний по клиентской поддержке"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="create-base-description">
              Краткое описание
            </label>
            <Textarea
              id="create-base-description"
              rows={3}
              placeholder="Расскажите, для чего нужна база знаний и какие процессы она покрывает"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          {mode === "archive" && (
            <div className="space-y-2">
              <label className="text-sm font-medium">ZIP-архив документов</label>
              <input
                ref={archiveInputRef}
                type="file"
                accept=".zip,.rar,.7z"
                className="hidden"
                onChange={handleArchiveChange}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" onClick={() => archiveInputRef.current?.click()}>
                  Выбрать архив
                </Button>
                {archiveFile ? (
                  <span className="text-xs text-muted-foreground">Выбрано: {archiveFile.name}</span>
                ) : (
                  <span className="text-xs text-muted-foreground">Поддерживаются ZIP, RAR и 7z архивы</span>
                )}
              </div>
            </div>
          )}

          {mode === "crawler" && (
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="create-base-crawler-url">
                Ссылка для краулинга
              </label>
              <Input
                id="create-base-crawler-url"
                placeholder="https://docs.company.ru"
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Мы обойдем вложенные страницы, создадим документы и будем отслеживать обновления автоматически.
              </p>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={createBaseMutation.isPending}>
            Отмена
          </Button>
          <Button onClick={handleSubmit} disabled={createBaseMutation.isPending}>
            {createBaseMutation.isPending ? "Создаём..." : "Создать базу знаний"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CreateKnowledgeBaseDialog;
