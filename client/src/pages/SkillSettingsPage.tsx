import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import * as LucideIcons from "lucide-react";

import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useCreateSkill, useGenerateCallbackToken, useSkills, useUpdateSkill } from "@/hooks/useSkills";
import { useModels, type PublicModel } from "@/hooks/useModels";
import { useWorkspaceFileStorageProviders } from "@/hooks/useFileStorageProviders";
import type { PublicEmbeddingProvider, PublicLlmProvider } from "@shared/schema";
import type { KnowledgeBaseSummary } from "@shared/knowledge-base";
import type { Skill, SkillPayload } from "@/types/skill";
import type { SessionResponse } from "@/types/session";
import {
  SkillFormContent,
  type SkillFormValues,
  type LlmSelectionOption,
  type SkillSettingsTab,
  buildLlmKey,
  catalogModelMap,
  WORKSPACE_DEFAULT_PROVIDER_VALUE,
} from "./SkillsPage";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UploadCloud } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type SkillFileListItem = {
  id?: string;
  name: string;
  size?: number | null;
  contentType?: string | null;
  status?: string;
  error?: string;
  errorMessage?: string | null;
  createdAt?: string | null;
  isPending?: boolean;
};

const parseTab = (search: string | null | undefined): SkillSettingsTab | null => {
  if (!search) return null;
  const params = new URLSearchParams(search.startsWith("?") ? search : `?${search}`);
  const tab = params.get("tab");
  if (tab === "transcription" || tab === "actions" || tab === "main") {
    return tab;
  }
  if (tab === "llm" || tab === "rag") {
    return "main";
  }
  return null;
};

type SkillSettingsPageProps = {
  skillId?: string;
  isNew?: boolean;
};

type WorkspacePlanResponse = {
  plan: {
    noCodeFlowEnabled?: boolean;
  };
};

async function fetchKnowledgeBases(workspaceId: string): Promise<KnowledgeBaseSummary[]> {
  const response = await apiRequest("GET", "/api/knowledge/bases", undefined, undefined, { workspaceId });
  return (await response.json()) as KnowledgeBaseSummary[];
}

export default function SkillSettingsPage({ skillId, isNew = false }: SkillSettingsPageProps) {
  const [location, navigate] = useLocation();
  const cameFromHistory = useRef<boolean>(false);
  const { toast } = useToast();
  const getInitialTab = (): SkillSettingsTab => {
    const fromWindow = typeof window !== "undefined" ? parseTab(window.location.search) : null;
    const fromLocation = parseTab(location.split("?")[1]);
    return fromWindow ?? fromLocation ?? "main";
  };
  const [activeTab, setActiveTab] = useState<SkillSettingsTab>(getInitialTab());

  useEffect(() => {
    cameFromHistory.current = window.history.length > 1;
  }, []);

  useEffect(() => {
    const parsed = typeof window !== "undefined" ? parseTab(window.location.search) : null;
    if (parsed && parsed !== activeTab) {
      setActiveTab(parsed);
    }
  }, [location, activeTab]);

  const handleTabChange = (value: string) => {
    const next: SkillSettingsTab = value === "transcription" || value === "actions" ? value : "main";
    setActiveTab(next);
    const base = location.split("?")[0];
    navigate(`${base}?tab=${next}`, { replace: true });
  };

  const goBack = () => {
    if (cameFromHistory.current) {
      window.history.back();
    } else {
      navigate("/skills");
    }
  };

  const { data: session } = useQuery<SessionResponse>({
    queryKey: ["/api/auth/session"],
  });
  const workspaceId = session?.workspace.active.id ?? session?.activeWorkspaceId ?? null;

  const workspacePlanQuery = useQuery<WorkspacePlanResponse>({
    queryKey: ["workspace-plan", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      if (!workspaceId) {
        throw new Error("Рабочее пространство не выбрано");
      }
      const response = await apiRequest("GET", `/api/workspaces/${workspaceId}/plan`);
      return (await response.json()) as WorkspacePlanResponse;
    },
  });

  const {
    skills,
    isLoading: isSkillsLoading,
    error: skillsError,
  } = useSkills({ workspaceId, enabled: Boolean(workspaceId) && !isNew, includeArchived: true });

  const currentSkill: Skill | undefined = useMemo(
    () => skills.find((item) => item.id === skillId),
    [skills, skillId],
  );

  const knowledgeBaseQuery = useQuery<KnowledgeBaseSummary[]>({
    queryKey: ["knowledge-bases", workspaceId],
    queryFn: () => fetchKnowledgeBases(workspaceId as string),
    enabled: Boolean(workspaceId),
  });

  const {
    data: embeddingProvidersResponse,
    isLoading: isEmbeddingProvidersLoading,
    error: embeddingProvidersErrorRaw,
  } = useQuery<{ providers: PublicEmbeddingProvider[] }>({
    queryKey: ["/api/embedding/services"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/embedding/services");
      return (await response.json()) as { providers: PublicEmbeddingProvider[] };
    },
  });

  const {
    data: llmProvidersResponse,
    isLoading: isLlmLoading,
    error: llmError,
  } = useQuery<{ providers: PublicLlmProvider[] }>({
    queryKey: ["/api/llm/providers"],
  });

  const { data: catalogLlmModels = [], isLoading: isModelsLoading, error: modelsError } = useModels("LLM");

  const llmProviders = llmProvidersResponse?.providers ?? [];
  const knowledgeBases = knowledgeBaseQuery.data ?? [];
  const embeddingProviders = embeddingProvidersResponse?.providers ?? [];
  const embeddingProvidersError = embeddingProvidersErrorRaw as Error | undefined;
  const {
    providers: fileStorageProviders,
    workspaceDefaultProvider: workspaceDefaultFileStorageProvider,
    isLoading: isFileStorageProvidersLoading,
    error: fileStorageProvidersError,
  } = useWorkspaceFileStorageProviders(workspaceId);

  const shouldLoadSkillFiles = Boolean(workspaceId && skillId && !isNew);
  const skillFilesQuery = useQuery<{ files: SkillFileListItem[] }>({
    queryKey: ["/api/workspaces", workspaceId, "skills", skillId, "files"],
    enabled: shouldLoadSkillFiles,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/workspaces/${workspaceId}/skills/${skillId}/files`);
      return (await res.json()) as { files: SkillFileListItem[] };
    },
  });
  const hasSkillFiles = (skillFilesQuery.data?.files?.length ?? 0) > 0;
  const isSkillFilesReady = !shouldLoadSkillFiles || skillFilesQuery.isSuccess || skillFilesQuery.isError;
  const allowNoCodeFlow = Boolean(workspacePlanQuery.data?.plan?.noCodeFlowEnabled);

  const llmOptions = useMemo<LlmSelectionOption[]>(() => {
    const options: LlmSelectionOption[] = [];
    const byProvider = catalogLlmModels.reduce<Record<string, PublicModel[]>>((acc, model) => {
      if (!model.providerId) return acc;
      acc[model.providerId] = acc[model.providerId] ?? [];
      acc[model.providerId].push(model);
      return acc;
    }, {});

    for (const provider of llmProviders) {
      const models = byProvider[provider.id] ?? [];
      for (const model of models) {
        const labelText = `${provider.name} · ${model.displayName}`;
        options.push({
          key: buildLlmKey(provider.id, model.key),
          label: labelText,
          providerId: provider.id,
          providerName: provider.name,
          modelId: model.key,
          modelDisplayName: model.displayName,
          costLevel: model.costLevel,
          providerIsActive: provider.isActive,
          disabled: !provider.isActive,
          catalogModel: model,
        });
      }
    }

    return options.sort((a, b) => a.label.localeCompare(b.label, "ru"));
  }, [llmProviders, catalogLlmModels]);

  const { updateSkill, isUpdating } = useUpdateSkill({ workspaceId });
  const { generateCallbackToken, isGenerating: isGeneratingCallbackToken } = useGenerateCallbackToken({
    workspaceId,
    onSuccess: () => {
      toast({ title: "API-токен обновлён" });
    },
  });
  const { createSkill, isCreating } = useCreateSkill({
    workspaceId,
    onSuccess: (created) => {
      toast({ title: "Навык создан" });
      navigate(`/skills/${created.id}/edit`);
    },
  });

  const handleSubmit = async (values: SkillFormValues) => {
    const [providerId, modelId] = values.llmKey.split("::");
    const catalogByKey = catalogModelMap(catalogLlmModels);
    const resolvedModel = catalogByKey.get(modelId) ?? null;
    if (!resolvedModel) {
      toast({
        title: "Не удалось сохранить",
        description: "Модель не найдена в каталоге или отключена",
        variant: "destructive",
      });
      throw new Error("Модель не найдена в каталоге или отключена");
    }
    if (values.onTranscriptionMode === "auto_action" && !values.onTranscriptionAutoActionId?.trim()) {
      toast({
        title: "Заполните действие",
        description: "Выберите действие для авто-запуска после транскрипции",
        variant: "destructive",
      });
      throw new Error("Не выбрано действие для авто-запуска");
    }
    if (!allowNoCodeFlow && values.executionMode === "no_code") {
      toast({
        title: "No-code недоступен",
        description: "Доступно на премиум-тарифе.",
        variant: "destructive",
      });
      return false;
    }

    const parseIntegerOrDefault = (candidate: string | undefined, fallback: number) => {
      if (!candidate) return fallback;
      const parsed = Number.parseInt(candidate, 10);
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    const parseScoreOrDefault = (candidate: string | undefined, fallback: number) => {
      if (!candidate) return fallback;
      const parsed = Number.parseFloat(candidate);
      if (!Number.isFinite(parsed)) return fallback;
      return Math.min(1, Math.max(0, Number(parsed.toFixed(3))));
    };
    const parseTemperatureOrNull = (candidate: string | undefined) => {
      if (!candidate) return null;
      const parsed = Number.parseFloat(candidate);
      if (!Number.isFinite(parsed)) return null;
      return Math.min(2, Math.max(0, Number(parsed.toFixed(2))));
    };
    const parseMaxTokensOrNull = (candidate: string | undefined) => {
      if (!candidate) return null;
      const parsed = Number.parseInt(candidate, 10);
      if (!Number.isFinite(parsed)) return null;
      return Math.min(4096, Math.max(16, parsed));
    };

    const isNoCodeMode = values.executionMode === "no_code";
    const ragTopK = Math.max(1, parseIntegerOrDefault(values.ragTopK, 5));
    const ragMinScore = parseScoreOrDefault(values.ragMinScore, 0.7);
    const sanitizedMaxTokens = values.ragMaxContextTokens?.trim();
    let ragMaxContextTokens: number | null = null;
    if (sanitizedMaxTokens) {
      const parsed = Number.parseInt(sanitizedMaxTokens, 10);
      ragMaxContextTokens = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
    const hasRagSources = !isNoCodeMode && (values.knowledgeBaseIds.length > 0 || hasSkillFiles);
    const llmTemperature = parseTemperatureOrNull(values.llmTemperature);
    const llmMaxTokens = parseMaxTokensOrNull(values.llmMaxTokens);
    const autoActionId =
      values.onTranscriptionMode === "auto_action" && values.onTranscriptionAutoActionId
        ? values.onTranscriptionAutoActionId.trim() || null
        : null;
    const trimmedNoCodeEndpoint = (values.noCodeEndpointUrl ?? "").trim();
    const noCodeEndpointUrl = trimmedNoCodeEndpoint.length > 0 ? trimmedNoCodeEndpoint : null;
    const noCodeFileStorageProviderId =
      values.noCodeFileStorageProviderId && values.noCodeFileStorageProviderId !== WORKSPACE_DEFAULT_PROVIDER_VALUE
        ? values.noCodeFileStorageProviderId
        : null;
    const contextInputLimitValue = values.contextInputLimit?.trim();
    let contextInputLimit: number | null = null;
    if (contextInputLimitValue) {
      const parsed = Number.parseInt(contextInputLimitValue, 10);
      if (Number.isFinite(parsed)) {
        contextInputLimit = Math.max(100, Math.min(50000, parsed));
      }
    }

    const payload: SkillPayload = {
      name: values.name.trim(),
      description: values.description?.trim() ? values.description.trim() : null,
      systemPrompt: values.systemPrompt?.trim() ? values.systemPrompt.trim() : null,
      icon: values.icon?.trim() ? values.icon.trim() : null,
      knowledgeBaseIds: values.knowledgeBaseIds,
      executionMode: values.executionMode,
      mode: isNoCodeMode ? "llm" : hasRagSources ? "rag" : "llm",
      llmProviderConfigId: providerId,
      modelId: resolvedModel.key,
      ragConfig: isNoCodeMode
        ? undefined
        : {
            mode: "all_collections",
            collectionIds: [],
            topK: null,
            minScore: null,
            maxContextTokens: null,
            showSources: null,
            embeddingProviderId: null,
            bm25Weight: null,
            bm25Limit: null,
            vectorWeight: null,
            vectorLimit: null,
            llmTemperature,
            llmMaxTokens,
            llmResponseFormat: null,
          },
      transcriptionFlowMode: values.transcriptionFlowMode,
      onTranscriptionMode: values.onTranscriptionMode,
      onTranscriptionAutoActionId: autoActionId,
      contextInputLimit,
      noCodeEndpointUrl,
      noCodeFileStorageProviderId,
      noCodeAuthType: values.noCodeAuthType,
    };

    if (values.noCodeBearerTokenAction === "clear" || values.noCodeAuthType === "none") {
      payload.noCodeBearerToken = "";
    } else if (values.noCodeBearerToken?.trim()) {
      payload.noCodeBearerToken = values.noCodeBearerToken.trim();
    }

    try {
      if (isNew) {
        await createSkill(payload);
        return true;
      } else if (currentSkill) {
        await updateSkill({ skillId: currentSkill.id, payload });
        toast({ title: "Сохранено" });
        return true;
      }
      return false;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Неизвестная ошибка";
      toast({
        title: "Не удалось сохранить навык",
        description: message,
        variant: "destructive",
      });
      throw err instanceof Error ? err : new Error(message);
    }
  };

  const loading =
    (isNew ? false : isSkillsLoading) ||
    workspacePlanQuery.isLoading ||
    knowledgeBaseQuery.isLoading ||
    isEmbeddingProvidersLoading ||
    isLlmLoading ||
    isModelsLoading;

  const error =
    (isNew ? null : skillsError) ||
    workspacePlanQuery.error ||
    knowledgeBaseQuery.error ||
    embeddingProvidersError ||
    fileStorageProvidersError ||
    llmError ||
    modelsError;

  const getIconComponent = (iconName: string | null | undefined) => {
    if (!iconName) return null;
    const iconMap = LucideIcons as unknown as Record<string, ComponentType<{ className?: string }>>;
    const Icon = iconMap[iconName];
    return Icon ? <Icon className="h-5 w-5" /> : null;
  };

  const skillName = currentSkill?.name?.trim() || (isNew ? "Новый навык" : "Навык");
  const canEditSkillFiles = Boolean(!isNew && currentSkill && !currentSkill.isSystem);

  const ensureNoCodeMode = useCallback(async () => {
    if (!currentSkill || currentSkill.executionMode === "no_code") return;
    await updateSkill({
      skillId: currentSkill.id,
      payload: { executionMode: "no_code" },
    });
  }, [currentSkill, updateSkill]);

  return (
    <div className="space-y-6 pb-10">
      <div className="mx-auto w-full max-w-6xl px-6 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Button variant="ghost" size="sm" onClick={goBack} className="shrink-0">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Назад
            </Button>
            <div className="flex flex-col gap-1">
              <Breadcrumb className="text-sm text-muted-foreground">
                <BreadcrumbList>
                  <BreadcrumbItem>
                    <BreadcrumbLink asChild>
                      <Link href="/skills">Навыки</Link>
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>{skillName}</BreadcrumbPage>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>Настройки</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
              <h1 className="text-base font-semibold" data-testid="skill-title">
                Настройки навыка
              </h1>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-6xl px-6">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Загружаем данные...
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertTitle>Не удалось загрузить данные</AlertTitle>
            <AlertDescription>{(error as Error).message}</AlertDescription>
          </Alert>
        ) : !isNew && !currentSkill ? (
          <Alert variant="destructive">
            <AlertTitle>Навык не найден</AlertTitle>
            <AlertDescription>Проверьте ссылку и попробуйте снова.</AlertDescription>
          </Alert>
        ) : (
          <>
            <SkillFormContent
              knowledgeBases={knowledgeBases}
              embeddingProviders={embeddingProviders}
              isEmbeddingProvidersLoading={isEmbeddingProvidersLoading}
              fileStorageProviders={fileStorageProviders}
              workspaceDefaultFileStorageProvider={workspaceDefaultFileStorageProvider}
              isFileStorageProvidersLoading={isFileStorageProvidersLoading}
              fileStorageProvidersError={fileStorageProvidersError ?? null}
              hasSkillFiles={hasSkillFiles}
              isSkillFilesReady={isSkillFilesReady}
              llmOptions={llmOptions}
              onSubmit={handleSubmit}
              isSubmitting={isUpdating || isCreating}
              skill={isNew ? null : currentSkill}
              allowNoCodeFlow={allowNoCodeFlow}
              getIconComponent={getIconComponent}
              isOpen
              activeTab={activeTab}
              onTabChange={handleTabChange}
              onGenerateCallbackToken={(skillId) => generateCallbackToken({ skillId })}
              isGeneratingCallbackToken={isGeneratingCallbackToken}
              onEnsureNoCodeMode={ensureNoCodeMode}
            />
            {canEditSkillFiles ? (
              <div className="mt-6">
                <SkillFilesSection
                  canEdit
                  workspaceId={workspaceId}
                  skillId={currentSkill?.id ?? null}
                />
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

export function SkillFilesSection({
  canEdit,
  workspaceId,
  skillId,
  uploadFiles,
  initialFiles,
}: {
  canEdit: boolean;
  workspaceId: string | null;
  skillId: string | null;
  uploadFiles?: (params: { workspaceId: string; skillId: string; files: File[] }) => Promise<{
    files: SkillFileListItem[];
  }>;
  initialFiles?: SkillFileListItem[];
}) {
  if (!canEdit) {
    return null;
  }

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [persistedFiles, setPersistedFiles] = useState<SkillFileListItem[]>(initialFiles ?? []);
  const skillFilesQuery = useQuery({
    queryKey: ["/api/workspaces", workspaceId, "skills", skillId, "files"],
    enabled: Boolean(workspaceId && skillId),
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/workspaces/${workspaceId}/skills/${skillId}/files`);
      return (await res.json()) as {
        files: SkillFileListItem[];
      };
    },
  });

  useEffect(() => {
    if (skillFilesQuery.data?.files) {
      setPersistedFiles(skillFilesQuery.data.files);
    }
  }, [skillFilesQuery.data]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploads, setUploads] = useState<SkillFileListItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const generateId = () => (typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Math.random().toString(36).slice(2));

  const mergeFiles = (existing: SkillFileListItem[], added: SkillFileListItem[]) => {
    const seen = new Set<string>();
    const merged: typeof existing = [];
    [...added, ...existing].forEach((item) => {
      const key = item.id ? `id:${item.id}` : `name:${item.name}-size:${item.size ?? 0}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(item);
      }
    });
    return merged;
  };

  const doUpload = uploadFiles
    ? uploadFiles
    : async (params: { workspaceId: string; skillId: string; files: File[] }) => {
        const formData = new FormData();
        params.files.forEach((file) => formData.append("files", file));
        const res = await apiRequest(
          "POST",
          `/api/workspaces/${params.workspaceId}/skills/${params.skillId}/files`,
          formData,
        );
        return (await res.json()) as {
          files: Array<{
            id?: string;
            name?: string;
            size?: number | null;
            contentType?: string | null;
            status?: string;
            errorMessage?: string | null;
            createdAt?: string | null;
          }>;
        };
      };

  const validateFiles = (files: File[]): { valid: File[]; error?: string } => {
    if (files.length > 10) {
      return { valid: [], error: "За один раз можно загрузить до 10 файлов" };
    }
    const allowedExt = [".pdf", ".docx", ".doc", ".txt"];
    const oversized = files.find((file) => file.size > 512 * 1024 * 1024);
    if (oversized) {
      return { valid: [], error: "Файл слишком большой (максимум 512MB)" };
    }
    const unsupported = files.find((file) => {
      const ext = file.name ? file.name.toLowerCase().slice(file.name.lastIndexOf(".")) : "";
      return !allowedExt.includes(ext);
    });
    if (unsupported) {
      return { valid: [], error: "Формат не поддерживается. Загрузите PDF, DOC, DOCX или TXT." };
    }
    return { valid: files };
  };

  const handleFiles = async (files: File[]) => {
    if (!workspaceId || !skillId) {
      toast({
        title: "Недоступно",
        description: "Не удалось определить рабочее пространство или навык.",
        variant: "destructive",
      });
      return;
    }
    const { valid, error } = validateFiles(files);
    if (error) {
      toast({ title: "Не удалось загрузить файлы", description: error, variant: "destructive" });
      return;
    }
    if (valid.length === 0) return;

    const pendingIds = valid.map(() => generateId());
    const pendingEntries = valid.map((file, idx) => ({
      id: pendingIds[idx],
      name: file.name,
      size: file.size,
      status: "uploading",
    }));
    setUploads((prev) => [...prev, ...pendingEntries]);
    setIsUploading(true);
    try {
      const response = await doUpload({ workspaceId, skillId, files: valid });
      const updated = pendingEntries.map((pending, idx) => {
        const fromApi = response?.files?.[idx];
        return {
          id: fromApi?.id || pending.id,
          name: fromApi?.name || pending.name,
          size: fromApi?.size ?? pending.size,
          status: fromApi?.status || "uploaded",
          error: fromApi?.status === "error" ? fromApi.errorMessage || "Не удалось загрузить файл" : undefined,
        };
      });
      const persisted = (response?.files ?? [])
        .filter((item) => item.status !== "error")
        .map((item) => ({
          id: item.id,
          name: item.name ?? "",
          size: item.size ?? null,
          contentType: item.contentType ?? null,
          status: item.status ?? "uploaded",
          errorMessage: item.errorMessage ?? null,
          createdAt: item.createdAt ?? null,
        }));
      if (persisted.length > 0) {
        setPersistedFiles((prev) => mergeFiles(prev, persisted));
      }
      setUploads((prev) => [...prev.filter((item) => !pendingIds.includes(item.id)), ...updated]);
      toast({ title: "Файлы загружены" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось загрузить файлы";
      setUploads((prev) =>
        prev.map((item) =>
          pendingIds.includes(item.id) ? { ...item, status: "error", error: message } : item,
        ),
      );
      toast({ title: "Ошибка загрузки", description: message, variant: "destructive" });
    } finally {
      setIsUploading(false);
      if (workspaceId && skillId) {
        void queryClient.invalidateQueries({
          queryKey: ["/api/workspaces", workspaceId, "skills", skillId, "files"],
        });
      }
    }
  };

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);
    const files = Array.from(event.dataTransfer.files ?? []);
    void handleFiles(files);
  };

  const onInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void handleFiles(files);
  };

  const triggerFileDialog = () => {
    fileInputRef.current?.click();
  };

  const combinedFiles = [...uploads.map((item) => ({ ...item, isPending: true })), ...persistedFiles];

  const handleDeleteConfirmed = async (fileId?: string) => {
    if (!fileId || !workspaceId || !skillId) return;
    try {
      await apiRequest("DELETE", `/api/workspaces/${workspaceId}/skills/${skillId}/files/${fileId}`);
      setPersistedFiles((prev) => prev.filter((item) => item.id !== fileId));
      toast({ title: "Файл удалён" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось удалить файл";
      toast({ title: "Ошибка удаления", description: message, variant: "destructive" });
    }
    setPendingDeleteId(null);
  };

  return (
    <Card data-testid="skill-files-section">
      <CardHeader>
        <CardTitle>Файлы навыка</CardTitle>
        <CardDescription>Загрузите документы (PDF/DOCX/TXT), чтобы навык отвечал по ним.</CardDescription>
      </CardHeader>
      <CardContent>
        <div
          className={cn(
            "border-2 border-dashed rounded-md p-4 flex flex-col gap-3 transition-colors",
            isDragOver ? "border-primary bg-muted/50" : "border-muted",
          )}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setIsDragOver(false);
          }}
          onDrop={onDrop}
        >
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <div className="mt-1 rounded-md bg-muted p-2">
                <UploadCloud className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">Перетащите файлы сюда или нажмите “Загрузить”.</p>
                <p className="text-sm text-muted-foreground">Поддерживаются PDF, DOCX, TXT. До 10 файлов за раз.</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" onClick={triggerFileDialog} data-testid="skill-files-upload" disabled={isUploading}>
                {isUploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Загрузить файлы
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.docx,.txt"
                className="hidden"
                onChange={onInputChange}
                data-testid="skill-files-input"
              />
            </div>
          </div>

          {skillFilesQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">Загружаем список файлов…</div>
          ) : skillFilesQuery.isError ? (
            <div className="text-sm text-destructive">Не удалось загрузить список файлов</div>
          ) : combinedFiles.length > 0 ? (
            <div className="space-y-2">
              {combinedFiles.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{item.name}</span>
                    {item.size ? (
                      <span className="text-xs text-muted-foreground">{(item.size / 1024).toFixed(1)} KB</span>
                    ) : null}
                    {item.error || item.errorMessage ? (
                      <span className="text-xs text-destructive">{item.error ?? item.errorMessage}</span>
                    ) : null}
                    {item.createdAt ? (
                      <span className="text-xs text-muted-foreground">
                        {new Date(item.createdAt).toLocaleString("ru-RU")}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={item.status === "error" ? "destructive" : item.status === "uploading" ? "outline" : "default"}
                    >
                      {item.status === "uploading"
                        ? "Загружается"
                        : item.status === "error"
                          ? "Ошибка"
                          : "Загружен"}
                    </Badge>
                    {item.status !== "uploading" && item.id ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPendingDeleteId(item.id ?? null)}
                        data-testid={`skill-file-delete-${item.id}`}
                      >
                        Удалить
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Файлов пока нет</div>
          )}
        </div>
      </CardContent>
      <AlertDialog open={Boolean(pendingDeleteId)} onOpenChange={(open) => !open && setPendingDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить файл?</AlertDialogTitle>
            <AlertDialogDescription>
              Файл будет удалён из навыка и перестанет использоваться в ответах. Действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isUploading} onClick={() => setPendingDeleteId(null)}>
              Отмена
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isUploading}
              onClick={() => {
                void handleDeleteConfirmed(pendingDeleteId ?? undefined);
              }}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
