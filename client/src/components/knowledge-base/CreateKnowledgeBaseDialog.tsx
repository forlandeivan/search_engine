import { useEffect, useRef, useState, type ChangeEvent, type ComponentType } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCreateKnowledgeBase } from "@/hooks/useCreateKnowledgeBase";
import { useToast } from "@/hooks/use-toast";
import type { CreateKnowledgeBaseInput } from "@/hooks/useCreateKnowledgeBase";
import type { KnowledgeBase, KnowledgeBaseSourceType } from "@/lib/knowledge-base";
import { NotebookPen, FolderArchive, Globe, FileJson } from "lucide-react";
import { ImportModeSelector, FileImportPanel, CrawlImportPanel, JsonImportPanel, BaseNameForm } from "./import";
import type { CrawlConfig } from "./import/types";

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
  {
    value: "json_import",
    title: "Импорт JSON/JSONL",
    description: "Импортируйте структурированные данные из JSON или JSONL файлов в базу знаний.",
    icon: FileJson,
  },
];

type CreateKnowledgeBaseDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMode?: KnowledgeBaseSourceType;
  onCreated?: (base: KnowledgeBase) => void;
  workspaceId?: string | null;
  onJsonImportStarted?: (jobId: string) => void;
};


export function CreateKnowledgeBaseDialog({
  open,
  onOpenChange,
  initialMode = "blank",
  onCreated,
  workspaceId,
  onJsonImportStarted,
}: CreateKnowledgeBaseDialogProps) {
  const { toast } = useToast();
  const archiveInputRef = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<KnowledgeBaseSourceType>(initialMode);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isSubmittingImport, setIsSubmittingImport] = useState(false);
  const [archiveFile, setArchiveFile] = useState<File | null>(null);
  const [archiveFiles, setArchiveFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [crawlConfig, setCrawlConfig] = useState<CrawlConfig>({
    startUrls: [],
    robotsTxt: true,
  });
  const createBaseMutation = useCreateKnowledgeBase(workspaceId);

  const resetForm = () => {
    setName("");
    setDescription("");
    setCrawlConfig({
      startUrls: [],
      robotsTxt: true,
    });
    setArchiveFile(null);
    setArchiveFiles([]);
    setError(null);
    if (archiveInputRef.current) {
      archiveInputRef.current.value = "";
    }
    setIsSubmittingImport(false);
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
      setArchiveFiles([]);
      if (archiveInputRef.current) {
        archiveInputRef.current.value = "";
      }
    }
    // JSON import states управляются внутри JsonImportPanel
    if (value !== "crawler") {
      setCrawlConfig({
        startUrls: [],
        robotsTxt: true,
      });
    }
  };

  const handleArchiveChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setArchiveFile(file);
    if (file) {
      setArchiveFiles([file]);
    } else {
      setArchiveFiles([]);
    }
  };

  const handleSubmit = async () => {
    if (createBaseMutation.isPending || isSubmittingImport) {
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

    // JSON import обрабатывается через JsonImportPanel, не через handleSubmit
    if (mode === "json_import") {
      return;
    }

    setError(null);

    try {
      let crawlerConfig: CreateKnowledgeBaseInput["crawlerConfig"] | undefined;
      if (mode === "crawler") {
        // CrawlImportPanel управляет конфигурацией через config prop
        // Здесь просто используем то, что уже есть в state
        if (!crawlConfig.startUrls || crawlConfig.startUrls.length === 0) {
          setError("Укажите хотя бы один стартовый URL для краулинга");
          return;
        }

        crawlerConfig = {
          startUrls: crawlConfig.startUrls,
          sitemapUrl: crawlConfig.sitemapUrl || undefined,
          allowedDomains: crawlConfig.allowedDomains || undefined,
          include: crawlConfig.include || undefined,
          exclude: crawlConfig.exclude || undefined,
          maxPages: crawlConfig.maxPages || undefined,
          maxDepth: crawlConfig.maxDepth || undefined,
          rateLimitRps: crawlConfig.rateLimitRps || undefined,
          robotsTxt: crawlConfig.robotsTxt ?? true,
          selectors: crawlConfig.selectors
            ? {
                title: crawlConfig.selectors.title || undefined,
                content: crawlConfig.selectors.content || undefined,
              }
            : undefined,
          language: crawlConfig.language || undefined,
          version: crawlConfig.version || undefined,
          authHeaders: crawlConfig.auth?.headers || undefined,
        };
      }
      
      // For other modes, just create the base
      const created = await createBaseMutation.mutateAsync({
        name,
        description,
        mode,
        archiveFile: archiveFiles[0] || null,
        crawlerConfig,
      });

      onCreated?.(created);
      handleOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось создать базу знаний. Попробуйте снова.";
      setError(message);
      setIsSubmittingImport(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent 
        className={cn(
          "max-w-xl",
          mode === "json_import" && "w-[1200px] h-[900px] max-w-[1200px] max-h-[900px] overflow-x-hidden"
        )}
        style={mode === "json_import" ? { width: "1200px", height: "900px", maxWidth: "1200px", maxHeight: "900px", overflowX: "hidden" } : undefined}
      >
        <DialogHeader>
          <DialogTitle>
            {mode === "json_import" ? "Импорт JSON/JSONL" : "Создание базы знаний"}
          </DialogTitle>
          <DialogDescription>
            {mode === "json_import" 
              ? "Загрузите файл, настройте маппинг полей и иерархию документов."
              : "Выберите подходящий сценарий, задайте название и при необходимости укажите источники данных."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 overflow-x-hidden">
          {/* Hide mode selection and name/description when in JSON import wizard (JsonImportPanel сам управляет отображением) */}
          {mode !== "json_import" && (
            <>
              <ImportModeSelector
                mode={mode}
                onModeChange={handleModeChange}
                options={KNOWLEDGE_BASE_CREATION_OPTIONS.map(opt => ({
                  value: opt.value,
                  title: opt.title,
                  description: opt.description,
                  icon: opt.icon,
                }))}
                disabled={isSubmittingImport}
              />

              <BaseNameForm
                name={name}
                onNameChange={setName}
                description={description}
                onDescriptionChange={setDescription}
                disabled={isSubmittingImport}
              />
            </>
          )}

          {mode === "archive" && (
            <FileImportPanel
              mode="archive"
              files={archiveFiles}
              onFilesChange={(files) => {
                setArchiveFiles(files);
                setArchiveFile(files[0] || null);
              }}
              disabled={isSubmittingImport}
              allowArchives={true}
            />
          )}

          {mode === "crawler" && (
            <CrawlImportPanel
              mode="multiple"
              singleUrl=""
              onSingleUrlChange={() => {}}
              config={crawlConfig}
              onConfigChange={setCrawlConfig}
              isSubmitting={isSubmittingImport}
              error={error}
              disabled={isSubmittingImport}
            />
          )}

          {mode === "json_import" && workspaceId && (
            <JsonImportPanel
              workspaceId={workspaceId}
              baseName={name}
              onBaseNameChange={setName}
              baseDescription={description}
              onBaseDescriptionChange={setDescription}
              showBaseNameFields={true}
              onCreateBaseBeforeImport={async () => {
                if (!name.trim()) {
                  throw new Error("Укажите название базы знаний");
                }
                
                const created = await createBaseMutation.mutateAsync({
                  name,
                  description,
                  mode: "json_import",
                  archiveFile: null,
                  crawlerConfig: undefined,
                });
                
                return { id: created.id };
              }}
              onComplete={(result) => {
                toast({
                  title: "База знаний создана",
                  description: "Импорт JSON/JSONL запущен. Вы можете отслеживать прогресс на странице базы знаний.",
                });
                
                if (result.baseId) {
                  // Найти созданную базу в кэше или получить через API
                  // Пока просто закрываем диалог
                }
                
                onJsonImportStarted?.(result.jobId);
                handleOpenChange(false);
              }}
              onCancel={() => setMode("blank")}
              disabled={isSubmittingImport}
            />
          )}

          {error && mode !== "json_import" && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          {mode === "json_import" ? (
            // JSON импорт обрабатывается внутри JsonImportPanel
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isSubmittingImport}
            >
              Отмена
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={createBaseMutation.isPending || isSubmittingImport}>
                Отмена
              </Button>
              <Button onClick={handleSubmit} disabled={createBaseMutation.isPending || isSubmittingImport}>
                {createBaseMutation.isPending ? "Создаём..." : "Создать базу знаний"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CreateKnowledgeBaseDialog;
