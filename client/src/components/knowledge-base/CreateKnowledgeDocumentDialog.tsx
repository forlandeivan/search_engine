import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from "react";
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
import { convertFileToHtml, getSanitizedContent, buildHtmlFromPlainText } from "@/lib/document-import";
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
const MAX_CONTENT_LENGTH = 20_000_000;
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const ACCEPTED_FILE_TYPES =
  ".pdf,.doc,.docx,.pptx,.xlsx,.txt,.md,.markdown,.html,.htm,.eml,.csv" +
  ",application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" +
  ",application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" +
  ",text/plain,text/markdown,text/csv,text/html,message/rfc822";
const SUPPORTED_FORMAT_LABEL = "PDF, DOC, DOCX, TXT, Markdown, HTML, CSV, EML, PPTX, XLSX";

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
  const [importHtml, setImportHtml] = useState("");
  const [importDetectedTitle, setImportDetectedTitle] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [hasTitleBeenEdited, setHasTitleBeenEdited] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const folderOptions = useMemo(() => buildFolderOptions(structure), [structure]);

  useEffect(() => {
    if (open) {
      setParentValue(resolveDefaultParentValue(defaultParentId));
    } else {
      setTitle("");
      setManualContent("");
      setImportFile(null);
      setImportHtml("");
      setImportDetectedTitle(null);
      setImportError(null);
      setFormError(null);
      setMode("manual");
      setIsReadingFile(false);
      setHasTitleBeenEdited(false);
      setIsDragActive(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, [open, defaultParentId]);

  const handleTitleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setTitle(event.target.value);
    setHasTitleBeenEdited(true);
  };

  const handleModeChange = (newMode: KnowledgeNodeSourceType) => {
    setMode(newMode);
    setFormError(null);

    if (newMode === "manual") {
      setImportFile(null);
      setImportHtml("");
      setImportDetectedTitle(null);
      setImportError(null);
      setIsDragActive(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } else {
      setManualContent("");
    }
  };

  const applyTitleToImportedHtml = (html: string, newTitle: string) => {
    if (!html.trim()) {
      return html;
    }

    if (typeof window === "undefined") {
      return html;
    }

    const container = window.document.createElement("div");
    container.innerHTML = html;
    const heading = container.querySelector("h1, h2, h3, h4, h5, h6");

    if (heading) {
      heading.textContent = newTitle;
    } else {
      const h1 = window.document.createElement("h1");
      h1.textContent = newTitle;
      container.prepend(h1);
    }

    return container.innerHTML;
  };

  const processImportedFile = async (file: File) => {
    setImportError(null);
    setFormError(null);

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setImportError("Файл слишком большой. Максимальный размер — 20 МБ.");
      setImportFile(null);
      setImportHtml("");
      setImportDetectedTitle(null);
      return;
    }

    setIsReadingFile(true);
    try {
      const { title: detectedTitle, html } = await convertFileToHtml(file);
      const sanitizedContent = getSanitizedContent(html);

      if (!sanitizedContent.trim()) {
        throw new Error("Файл не содержит текстового контента.");
      }

      if (sanitizedContent.length > MAX_CONTENT_LENGTH) {
        throw new Error("Содержимое файла превышает допустимый размер 20 МБ.");
      }

      setImportFile(file);
      setImportHtml(sanitizedContent);
      setImportDetectedTitle(detectedTitle);
      if ((!hasTitleBeenEdited && !title.trim()) || !title.trim()) {
        setTitle(detectedTitle);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось обработать файл.";
      setImportError(message);
      setImportFile(null);
      setImportHtml("");
      setImportDetectedTitle(null);
    } finally {
      setIsReadingFile(false);
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    await processImportedFile(file);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragActive(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragActive(false);
  };

  const handleFileDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragActive(false);

    const file = event.dataTransfer?.files?.[0];
    if (!file) {
      return;
    }

    await processImportedFile(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleRemoveFile = () => {
    setImportFile(null);
    setImportHtml("");
    setImportDetectedTitle(null);
    setImportError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
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
        setFormError("Содержимое документа превышает допустимый размер 20 МБ.");
        return;
      }

      let sanitizedContent = "";

      if (manualContent.trim()) {
        sanitizedContent = getSanitizedContent(buildHtmlFromPlainText(manualContent, trimmedTitle));
        if (sanitizedContent.length > MAX_CONTENT_LENGTH) {
          setFormError("Содержимое документа превышает допустимый размер 20 МБ после обработки.");
          return;
        }
      }

      try {
        await onSubmit({
          title: trimmedTitle,
          parentId,
          content: sanitizedContent,
          sourceType: "manual",
          importFileName: null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Не удалось создать документ";
        setFormError(message);
      }
      return;
    }

    if (!importFile || importHtml.length === 0) {
      setFormError("Выберите файл для импорта или перетащите его в область загрузки.");
      return;
    }

    try {
      const htmlWithTitle = applyTitleToImportedHtml(importHtml, trimmedTitle);
      const sanitizedContent = getSanitizedContent(htmlWithTitle);

      if (sanitizedContent.length > MAX_CONTENT_LENGTH) {
        setFormError("Содержимое файла превышает допустимый размер 20 МБ.");
        return;
      }

      await onSubmit({
        title: trimmedTitle,
        parentId,
        content: sanitizedContent,
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
                onChange={handleTitleChange}
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
                  Загрузите текстовый документ до 20 МБ. Поддерживаются {SUPPORTED_FORMAT_LABEL}.
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
                  <Label htmlFor="knowledge-document-file">Файл документа</Label>
                  <div
                    className={cn(
                      "flex flex-col gap-3 rounded-md border border-dashed p-4 text-sm transition",
                      isDragActive ? "border-primary bg-primary/5" : "border-muted-foreground/30",
                    )}
                    onDragOver={handleDragOver}
                    onDragEnter={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleFileDrop}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        ref={fileInputRef}
                        id="knowledge-document-file"
                        type="file"
                        accept={ACCEPTED_FILE_TYPES}
                        onChange={handleFileChange}
                        disabled={isSubmitting || isReadingFile}
                      />
                      {isReadingFile && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Перетащите файл сюда или выберите на компьютере. Максимальный размер — 20 МБ.
                    </p>
                    {importFile && (
                      <div className="flex flex-wrap items-center gap-3 rounded-md border border-muted-foreground/20 bg-muted/40 p-3 text-xs text-muted-foreground">
                        <FileText className="h-4 w-4" />
                        <span>
                          {importFile.name} · {(importFile.size / 1024).toFixed(1)} КБ
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
                    )}
                    {importError && (
                      <p className="flex items-center gap-2 text-xs text-destructive">
                        <AlertCircle className="h-4 w-4" /> {importError}
                      </p>
                    )}
                  </div>
                </div>

                {importHtml && (
                  <div className="space-y-2">
                    <Label>Предпросмотр содержимого</Label>
                    <div className="prose prose-sm max-h-64 overflow-auto rounded-md border bg-muted/40 p-3">
                      <div
                        dangerouslySetInnerHTML={{
                          __html: applyTitleToImportedHtml(
                            importHtml,
                            title.trim() || importDetectedTitle || "Документ",
                          ),
                        }}
                      />
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
