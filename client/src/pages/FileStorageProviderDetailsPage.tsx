import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, ArrowLeft } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  createFileStorageProvider,
  updateFileStorageProvider,
  useFileStorageProviderDetails,
} from "@/hooks/useFileStorageProviders";

type ProviderFormState = {
  name: string;
  baseUrl: string;
  description: string;
  authType: "none" | "bearer";
  isActive: boolean;
  uploadMethod: "POST" | "PUT";
  pathTemplate: string;
  multipartFieldName: string;
  metadataFieldName: string;
  responseFileIdPath: string;
  defaultTimeoutMs: string;
};

const defaultState: ProviderFormState = {
  name: "",
  baseUrl: "",
  description: "",
  authType: "none",
  isActive: true,
  uploadMethod: "POST",
  pathTemplate: "/{workspaceId}/{objectKey}",
  multipartFieldName: "file",
  metadataFieldName: "metadata",
  responseFileIdPath: "fileUri",
  defaultTimeoutMs: "15000",
};

interface Props {
  providerId: string;
}

export default function FileStorageProviderDetailsPage({ providerId }: Props) {
  const isCreate = providerId === "new";
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { provider, isLoading, isError, error, refetch } = useFileStorageProviderDetails(providerId, {
    enabled: !isCreate,
  });

  const [form, setForm] = useState<ProviderFormState>(defaultState);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (provider) {
      setForm({
        name: provider.name ?? "",
        baseUrl: provider.baseUrl ?? "",
        description: provider.description ?? "",
        authType: (provider.authType as ProviderFormState["authType"]) ?? "none",
        isActive: provider.isActive ?? true,
        uploadMethod: (provider.config?.uploadMethod as ProviderFormState["uploadMethod"]) ?? defaultState.uploadMethod,
        pathTemplate: provider.config?.pathTemplate ?? defaultState.pathTemplate,
        multipartFieldName: provider.config?.multipartFieldName ?? defaultState.multipartFieldName,
        metadataFieldName: provider.config?.metadataFieldName ?? defaultState.metadataFieldName,
        responseFileIdPath: provider.config?.responseFileIdPath ?? defaultState.responseFileIdPath,
        defaultTimeoutMs:
          provider.config?.defaultTimeoutMs !== undefined && provider.config?.defaultTimeoutMs !== null
            ? String(provider.config.defaultTimeoutMs)
            : defaultState.defaultTimeoutMs,
      });
    }
  }, [provider]);

  const title = useMemo(() => (isCreate ? "Создать файловый провайдер" : `Провайдер: ${provider?.name ?? ""}`), [isCreate, provider]);

  const handleChange = (key: keyof ProviderFormState, value: any) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        ...form,
        config: {
          uploadMethod: form.uploadMethod,
          pathTemplate: form.pathTemplate.trim(),
          multipartFieldName: form.multipartFieldName.trim(),
          metadataFieldName: form.metadataFieldName.trim() === "" ? null : form.metadataFieldName.trim(),
          responseFileIdPath: form.responseFileIdPath.trim(),
          defaultTimeoutMs: Number(form.defaultTimeoutMs) || undefined,
        },
      };
      if (isCreate) {
        await createFileStorageProvider(payload);
        toast({ title: "Провайдер создан" });
      } else {
        await updateFileStorageProvider(providerId, payload);
        toast({ title: "Изменения сохранены" });
      }
      await queryClient.invalidateQueries({ queryKey: ["admin", "file-storage", "providers"] });
      navigate("/admin/file-storage");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось сохранить провайдера";
      toast({ variant: "destructive", title: "Ошибка", description: message });
    } finally {
      setSaving(false);
    }
  };

  if (!isCreate && isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-10 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Загрузка провайдера...
      </div>
    );
  }

  if (!isCreate && isError) {
    const message = error instanceof Error ? error.message : "Не удалось загрузить провайдера";
    return (
      <div className="p-6 space-y-3">
        <h1 className="text-2xl font-semibold">Провайдер</h1>
        <p className="text-destructive">{message}</p>
        <Button variant="secondary" onClick={() => refetch()}>
          Повторить
        </Button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/admin/file-storage")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold">{title}</h1>
          <p className="text-muted-foreground">Укажите параметры внешнего хранилища файлов.</p>
        </div>
      </div>

      <div className="space-y-5">
        <div className="grid gap-2">
          <Label htmlFor="name">Название</Label>
          <Input
            id="name"
            value={form.name}
            onChange={(e) => handleChange("name", e.target.value)}
            placeholder="Например, Unica AI Storage"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="baseUrl">Base URL</Label>
          <Input
            id="baseUrl"
            value={form.baseUrl}
            onChange={(e) => handleChange("baseUrl", e.target.value)}
            placeholder="https://files.example.com/api"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="description">Описание</Label>
          <Textarea
            id="description"
            value={form.description}
            onChange={(e) => handleChange("description", e.target.value)}
            placeholder="Кратко опишите провайдера (опционально)"
          />
        </div>

        <div className="grid gap-2">
          <Label>Аутентификация</Label>
          <Select value={form.authType} onValueChange={(value: ProviderFormState["authType"]) => handleChange("authType", value)}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Выберите тип" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="bearer">Bearer</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="grid gap-2">
            <Label>HTTP метод</Label>
            <Select
              value={form.uploadMethod}
              onValueChange={(value: ProviderFormState["uploadMethod"]) => handleChange("uploadMethod", value)}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Метод" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="POST">POST</SelectItem>
                <SelectItem value="PUT">PUT</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pathTemplate">Path template</Label>
            <Input
              id="pathTemplate"
              value={form.pathTemplate}
              onChange={(e) => handleChange("pathTemplate", e.target.value)}
              placeholder="/{workspaceId}/{objectKey}"
            />
            <p className="text-xs text-muted-foreground">Поддерживаются плейсхолдеры: workspaceId, objectKey, skillId, chatId, userId, messageId.</p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor="multipartFieldName">Поле файла</Label>
            <Input
              id="multipartFieldName"
              value={form.multipartFieldName}
              onChange={(e) => handleChange("multipartFieldName", e.target.value)}
              placeholder="file"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="metadataFieldName">Поле metadata (опционально)</Label>
            <Input
              id="metadataFieldName"
              value={form.metadataFieldName}
              onChange={(e) => handleChange("metadataFieldName", e.target.value)}
              placeholder="metadata"
            />
            <p className="text-xs text-muted-foreground">Оставьте пустым, чтобы не отправлять metadata.</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="responseFileIdPath">Ключ ответа</Label>
            <Input
              id="responseFileIdPath"
              value={form.responseFileIdPath}
              onChange={(e) => handleChange("responseFileIdPath", e.target.value)}
              placeholder="fileUri"
            />
            <p className="text-xs text-muted-foreground">Поле/путь в JSON с providerFileId.</p>
          </div>
        </div>

        <div className="grid gap-2 md:w-1/3">
          <Label htmlFor="defaultTimeoutMs">Таймаут, мс</Label>
          <Input
            id="defaultTimeoutMs"
            type="number"
            min={0}
            value={form.defaultTimeoutMs}
            onChange={(e) => handleChange("defaultTimeoutMs", e.target.value)}
            placeholder="15000"
          />
        </div>

        <div className="flex items-center gap-3">
          <Switch checked={form.isActive} onCheckedChange={(value) => handleChange("isActive", value)} id="isActive" />
          <Label htmlFor="isActive">Активен</Label>
        </div>
      </div>

      <div className="flex gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Сохранить
        </Button>
        <Button variant="outline" onClick={() => navigate("/admin/file-storage")}>
          Отмена
        </Button>
      </div>
    </div>
  );
}
