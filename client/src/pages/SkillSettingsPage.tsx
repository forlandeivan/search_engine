import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
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
import { useCreateSkill, useSkills, useUpdateSkill } from "@/hooks/useSkills";
import { useModels, type PublicModel } from "@/hooks/useModels";
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
} from "./SkillsPage";

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

type VectorCollectionSummary = {
  name: string;
};

type VectorCollectionsResponse = {
  collections: VectorCollectionSummary[];
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

  const vectorCollectionsQuery = useQuery<VectorCollectionsResponse>({
    queryKey: ["/api/vector/collections", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      if (!workspaceId) {
        throw new Error("Рабочее пространство не выбрано");
      }
      const response = await apiRequest("GET", "/api/vector/collections", undefined, undefined, { workspaceId });
      return (await response.json()) as VectorCollectionsResponse;
    },
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
  const vectorCollections = vectorCollectionsQuery.data?.collections ?? [];
  const vectorCollectionsError = vectorCollectionsQuery.error as Error | undefined;
  const embeddingProviders = embeddingProvidersResponse?.providers ?? [];
  const embeddingProvidersError = embeddingProvidersErrorRaw as Error | undefined;

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

    const ragTopK = Math.max(1, parseIntegerOrDefault(values.ragTopK, 5));
    const ragMinScore = parseScoreOrDefault(values.ragMinScore, 0.7);
    const sanitizedMaxTokens = values.ragMaxContextTokens?.trim();
    let ragMaxContextTokens: number | null = null;
    if (sanitizedMaxTokens) {
      const parsed = Number.parseInt(sanitizedMaxTokens, 10);
      ragMaxContextTokens = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
    const ragCollectionIds =
      values.ragMode === "selected_collections"
        ? values.ragCollectionIds.map((name) => name.trim()).filter((name) => name.length > 0)
        : [];
    const hasRagSources = values.knowledgeBaseIds.length > 0 || ragCollectionIds.length > 0;
    const llmTemperature = parseTemperatureOrNull(values.llmTemperature);
    const llmMaxTokens = parseMaxTokensOrNull(values.llmMaxTokens);
    const autoActionId =
      values.onTranscriptionMode === "auto_action" && values.onTranscriptionAutoActionId
        ? values.onTranscriptionAutoActionId.trim() || null
        : null;

    const payload: SkillPayload = {
      name: values.name.trim(),
      description: values.description?.trim() ? values.description.trim() : null,
      systemPrompt: values.systemPrompt?.trim() ? values.systemPrompt.trim() : null,
      icon: values.icon?.trim() ? values.icon.trim() : null,
      knowledgeBaseIds: values.knowledgeBaseIds,
      executionMode: values.executionMode,
      mode: hasRagSources ? "rag" : "llm",
      llmProviderConfigId: providerId,
      modelId: resolvedModel.key,
      ragConfig: {
        mode: values.ragMode,
        collectionIds: ragCollectionIds,
        topK: ragTopK,
        minScore: ragMinScore,
        maxContextTokens: ragMaxContextTokens,
        showSources: values.ragShowSources,
        embeddingProviderId:
          values.ragEmbeddingProviderId && values.ragEmbeddingProviderId !== "__none"
            ? values.ragEmbeddingProviderId.trim()
            : null,
        bm25Weight: null,
        bm25Limit: null,
        vectorWeight: null,
        vectorLimit: null,
        llmTemperature,
        llmMaxTokens,
        llmResponseFormat: null,
      },
      onTranscriptionMode: values.onTranscriptionMode,
      onTranscriptionAutoActionId: autoActionId,
    };

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
    knowledgeBaseQuery.isLoading ||
    vectorCollectionsQuery.isLoading ||
    isEmbeddingProvidersLoading ||
    isLlmLoading ||
    isModelsLoading;

  const error =
    (isNew ? null : skillsError) ||
    knowledgeBaseQuery.error ||
    vectorCollectionsError ||
    embeddingProvidersError ||
    llmError ||
    modelsError;

  const getIconComponent = (iconName: string | null | undefined) => {
    if (!iconName) return null;
    const iconMap = LucideIcons as unknown as Record<string, ComponentType<{ className?: string }>>;
    const Icon = iconMap[iconName];
    return Icon ? <Icon className="h-5 w-5" /> : null;
  };

  const skillName = currentSkill?.name?.trim() || (isNew ? "Новый навык" : "Навык");

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
          <SkillFormContent
            knowledgeBases={knowledgeBases}
            vectorCollections={vectorCollections}
            isVectorCollectionsLoading={vectorCollectionsQuery.isLoading}
            embeddingProviders={embeddingProviders}
            isEmbeddingProvidersLoading={isEmbeddingProvidersLoading}
            llmOptions={llmOptions}
            onSubmit={handleSubmit}
            isSubmitting={isUpdating || isCreating}
            skill={isNew ? null : currentSkill}
            getIconComponent={getIconComponent}
            isOpen
            activeTab={activeTab}
            onTabChange={handleTabChange}
          />
        )}
      </div>
    </div>
  );
}
