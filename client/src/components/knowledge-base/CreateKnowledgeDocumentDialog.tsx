import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import type { KnowledgeBaseTreeNode } from "@shared/knowledge-base";
import type { KnowledgeNodeSourceType } from "@shared/schema";
import {
  AlertCircle,
  FileText,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";

const ROOT_PARENT_VALUE = "__root__";
const MAX_CONTENT_LENGTH = 2_000_000;
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = [".txt", ".md", ".markdown", ".log", ".csv", ".json"]; // расширяем базовую поддержку
const SUPPORTED_MIME_TYPES = ["text/plain", "text/markdown", "text/x-markdown", "application/json"];

export type CreateKnowledgeDocumentFormValues = {
  title: string;
  parentId: string | null;
  content: string;
  sourceType: KnowledgeNodeSourceType;
  importFileName: string | null;
};

interface CreateKnowledgeDocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  structure: KnowledgeBaseTreeNode[];
  defaultParentId: string | null;
  baseName: string;
  parentLabel: string;
  isSubmitting: boolean;
  onSubmit: (values: CreateKnowledgeDocumentFormValues) => Promise<void> | void;
}

type FolderOption = {
  id: string;
  title: string;
  level: number;
};

function buildFolderOptions(nodes: KnowledgeBaseTreeNode[], level = 0, acc: FolderOption[] = []): FolderOption[] {
  for (const node of nodes) {
    if (node.type !== "folder") {
      continue;
    }

    acc.push({ id: node.id, title: node.title, level });
    if (node.children && node.children.length > 0) {
      buildFolderOptions(node.children, level + 1, acc);
    }
  }

  return acc;
}

function resolveDefaultParentValue(parentId: string | null): string {
  return parentId ?? ROOT_PARENT_VALUE;
}

function isSupportedFile(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  if (SUPPORTED_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
    return true;
  }

  if (file.type && SUPPORTED_MIME_TYPES.includes(file.type)) {
    return true;
  }

  return false;
}

export function CreateKnowledgeDocumentDialog({
  open,
  onOpenChange,
  structure,
  defaultParentId,
  baseName,
  parentLabel,
  isSubmitting,
  onSubmit,
}: CreateKnowledgeDocumentDialogProps) {
  const [title, setTitle] = useState("");
  const [parentValue, setParentValue] = useState<string>(resolveDefaultParentValue(defaultParentId));
  const [mode, setMode] = useState<KnowledgeNodeSourceType>("manual");
  const [manualContent, setManualContent] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importContent, setImportContent] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isReadingFile, setIsReadingFile] = useState(false);

  const folderOptions = useMemo(() => buildFolderOptions(structure), [structure]);

  useEffect(() => {
    if (open) {
      setParentValue(resolveDefaultParentValue(defaultParentId));
    } else {
      setTitle("");
      setManualContent("");
      setImportFile(null);
      setImportContent("");
      setImportError(null);
      setFormError(null);
      setMode("manual");
      setIsReadingFile(false);
    }
  }, [open, defaultParentId]);

  const handleModeChange = (newMode: KnowledgeNodeSourceType) => {
    setMode(newMode);
    setFormError(null);

    if (newMode === "manual") {
      setImportFile(null);
      setImportContent("");
      setImportError(null);
    } else {
      setManualContent("");
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setImportError(null);
    setFormError(null);

    if (!isSupportedFile(file)) {
      setImportError("Поддерживаются только текстовые файлы (TXT, MD, LOG, CSV, JSON).");
      setImportFile(null);
      setImportContent("");
      return;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setImportError("Файл слишком большой. Максимальный размер — 2 МБ.");
      setImportFile(null);
      setImportContent("");
      return;
    }

    setIsReadingFile(true);
    try {
      const text = await file.text();
      if (text.length > MAX_CONTENT_LENGTH) {
        setImportError("Содержимое файла превышает допустимый размер 2 МБ.");
        setImportFile(null);
        setImportContent("");
        return;
      }

      setImportFile(file);
      setImportContent(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось прочитать файл.";
      setImportError(message);
      setImportFile(null);
      setImportContent("");
    } finally {
      setIsReadingFile(false);
    }
  };

  const handleRemoveFile = () => {
    setImportFile(null);
    setImportContent("");
    setImportError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setFormError("Укажите название документа.");
      return;
    }

    const parentId = parentValue === ROOT_PARENT_VALUE ? null : parentValue;

    if (mode === "manual") {
      if (manualContent.length > MAX_CONTENT_LENGTH) {
        setFormError("Содержимое документа превышает допустимый размер 2 МБ.");
        return;
      }

      try {
        await onSubmit({
          title: trimmedTitle,
          parentId,
          content: manualContent,
          sourceType: "manual",
          importFileName: null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Не удалось создать документ";
        setFormError(message);
      }
      return;
    }

    if (!importFile || importContent.length === 0) {
      setFormError("Выберите текстовый файл для импорта.");
      return;
    }

    if (importContent.length > MAX_CONTENT_LENGTH) {
      setFormError("Содержимое файла превышает допустимый размер 2 МБ.");
      return;
    }

    try {
      await onSubmit({
        title: trimmedTitle,
        parentId,
        content: importContent,
        sourceType: "import",
        importFileName: importFile.name,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось создать документ";
      setFormError(message);
    }
  };

  const parentDescription = parentValue === ROOT_PARENT_VALUE ? "В корне базы" : parentLabel;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <form onSubmit={handleSubmit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>Новый документ</DialogTitle>
            <DialogDescription>
              Документ будет создан в базе «{baseName}». Выберите расположение и способ создания.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="knowledge-document-title">Название документа</Label>
              <Input
                id="knowledge-document-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Например, Руководство по продукту"
                maxLength={500}
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label>Размещение</Label>
              <Select value={parentValue} onValueChange={setParentValue}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите раздел" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ROOT_PARENT_VALUE}>В корне базы</SelectItem>
                  {folderOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {`${"\u00A0".repeat(option.level * 2)}${option.title}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Текущий выбор: {parentDescription}</p>
            </div>

            <div className="space-y-2">
              <Label>Способ создания</Label>
              <RadioGroup
                value={mode}
                onValueChange={(value) => handleModeChange(value as KnowledgeNodeSourceType)}
                className="grid gap-2 sm:grid-cols-2"
              >
                <label
                  htmlFor="knowledge-document-mode-manual"
                  className={cn(
                    "flex cursor-pointer flex-col gap-1 rounded-md border p-3 text-sm transition",
                    mode === "manual" ? "border-primary bg-primary/5" : "hover:border-primary/40",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="manual" id="knowledge-document-mode-manual" />
                    <span className="font-medium">Пустой документ</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Создайте чистый документ и заполните его позже или добавьте текст прямо сейчас.
                  </p>
                </label>

                <label
                  htmlFor="knowledge-document-mode-import"
                  className={cn(
                    "flex cursor-pointer flex-col gap-1 rounded-md border p-3 text-sm transition",
                    mode === "import" ? "border-primary bg-primary/5" : "hover:border-primary/40",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="import" id="knowledge-document-mode-import" />
                    <span className="font-medium">Импорт из файла</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Загрузите текстовый файл до 2 МБ. Поддерживаются TXT, Markdown, CSV, LOG и JSON.
                  </p>
                </label>
              </RadioGroup>
            </div>

            {mode === "manual" ? (
              <div className="space-y-2">
                <Label htmlFor="knowledge-document-content">Стартовое содержимое (необязательно)</Label>
                <Textarea
                  id="knowledge-document-content"
                  value={manualContent}
                  onChange={(event) => setManualContent(event.target.value)}
                  placeholder="Добавьте текст документа или оставьте поле пустым"
                  className="min-h-[8rem]"
                  maxLength={MAX_CONTENT_LENGTH}
                />
                <p className="text-xs text-muted-foreground">
                  Длина: {manualContent.length.toLocaleString("ru-RU")} символов из {MAX_CONTENT_LENGTH.toLocaleString("ru-RU")}.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="knowledge-document-file">Текстовый файл</Label>
                  <div className="flex flex-col gap-2 rounded-md border border-dashed p-4 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        id="knowledge-document-file"
                        type="file"
                        accept=".txt,.md,.markdown,.log,.csv,.json,text/plain,text/markdown"
                        onChange={handleFileChange}
                        disabled={isSubmitting || isReadingFile}
                      />
                      {isReadingFile && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                    </div>
                    {importFile ? (
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <FileText className="h-4 w-4" />
                        <span>
                          {importFile.name} · {(importFile.size / 1024).toFixed(1)} КБ ·
                          длина {importContent.length.toLocaleString("ru-RU")} символов
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={handleRemoveFile}
                          className="h-7 px-2"
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" /> Удалить
                        </Button>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Выберите файл для импорта содержимого. Максимальный размер — 2 МБ.
                      </p>
                    )}
                    {importError && (
                      <p className="flex items-center gap-2 text-xs text-destructive">
                        <AlertCircle className="h-4 w-4" /> {importError}
                      </p>
                    )}
                  </div>
                </div>

                {importContent && (
                  <div className="space-y-2">
                    <Label>Предпросмотр содержимого</Label>
                    <div className="max-h-48 overflow-auto rounded-md border bg-muted/40 p-3 text-xs font-mono whitespace-pre-wrap">
                      {importContent}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {formError && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" /> {formError}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting || isReadingFile}
            >
              Отмена
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || isReadingFile}
              className="min-w-[10rem]"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Создание...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" /> Создать документ
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default CreateKnowledgeDocumentDialog;
