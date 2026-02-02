import { useEffect, useMemo, useState } from "react";
import { useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import { z } from "zod";
import { Sparkles, Plus, Pencil, Loader2, Copy, Ellipsis, ArrowUpDown, Search, HelpCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Field, FieldContent, FieldLabel, FieldTitle, FieldDescription } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

import { useSkills } from "@/hooks/useSkills";
import { useModels, type PublicModel } from "@/hooks/useModels";
import { useAsrProviders } from "@/hooks/useAsrProviders";
import { apiRequest } from "@/lib/queryClient";
import { getSkillIcon } from "@/lib/skill-icons";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";

import type { KnowledgeBaseSummary } from "@shared/knowledge-base";
import type { ActionDto, SkillActionDto, SkillCallbackTokenResponse } from "@shared/skills";
import type { PublicEmbeddingProvider, PublicLlmProvider } from "@shared/schema";
import type { Skill } from "@/types/skill";
import type { SessionResponse } from "@/types/session";
import type { FileStorageProviderSummary } from "@/types/file-storage-providers";

// Import from decomposed modules
import { ICON_OPTIONS, WORKSPACE_DEFAULT_PROVIDER_VALUE } from './SkillsPage/constants';
import {
  skillFormSchema,
  defaultFormValues,
  buildLlmKey,
  catalogModelMap,
  type SkillFormValues,
} from './SkillsPage/utils';
import type {
  LlmSelectionOption,
  SkillActionConfigItem,
  SkillSettingsTab,
} from './SkillsPage/types';
import {
  KnowledgeBaseMultiSelect,
  InfoTooltipIcon,
  SkillActionsPreview,
  ActionsPreviewForNewSkill,
  IconPicker,
  type SkillActionChange,
} from './SkillsPage/components';

// Re-export for backward compatibility
export { skillFormSchema, buildLlmKey, catalogModelMap, defaultFormValues, WORKSPACE_DEFAULT_PROVIDER_VALUE };
export type { SkillFormValues, LlmSelectionOption, SkillSettingsTab };

type ModelCostLevel = LlmSelectionOption["costLevel"];
const costLevelLabel: Record<ModelCostLevel, string> = {
  FREE: "Free",
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  VERY_HIGH: "Very high",
};

function SkillActionsInline({ skillId }: { skillId: string }) {
  const { data, isLoading, isError } = useQuery<SkillActionConfigItem[]>({
    queryKey: ["skill-actions-inline", skillId],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/skills/${skillId}/actions`);
      const json = await response.json();
      return (json.items ?? []) as SkillActionConfigItem[];
    },
  });

  if (isLoading) {
    return <span className="text-xs text-muted-foreground">Загрузка...</span>;
  }

  if (isError || !data) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  const enabledActions = data.filter((item) => item.skillAction?.enabled);
  if (enabledActions.length === 0) {
    return <span className="text-xs text-muted-foreground">Нет действий</span>;
  }

  const MAX_BADGES = 3;
  const visible = enabledActions.slice(0, MAX_BADGES);
  const extra = enabledActions.length - visible.length;

  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((item) => (
        <Badge key={item.action.id} variant="secondary" className="text-[11px]">
          {item.skillAction?.labelOverride ?? item.ui.effectiveLabel ?? item.action.label}
        </Badge>
      ))}
      {extra > 0 && (
        <Badge variant="outline" className="text-[11px] text-muted-foreground">
          +{extra}
        </Badge>
      )}
    </div>
  );
}

type SkillFormProps = {
  knowledgeBases: KnowledgeBaseSummary[];
  embeddingProviders: PublicEmbeddingProvider[];
  isEmbeddingProvidersLoading: boolean;
  fileStorageProviders: FileStorageProviderSummary[];
  workspaceDefaultFileStorageProvider: FileStorageProviderSummary | null;
  isFileStorageProvidersLoading?: boolean;
  fileStorageProvidersError?: Error | null;
  hasSkillFiles?: boolean;
  isSkillFilesReady?: boolean;
  llmOptions: LlmSelectionOption[];
  onSubmit: (values: SkillFormValues) => Promise<boolean>;
  isSubmitting: boolean;
  skill?: Skill | null;
  allowNoCodeFlow?: boolean;
  getIconComponent: (iconName: string | null | undefined) => JSX.Element | null;
  hideHeader?: boolean;
  isOpen?: boolean;
  activeTab?: SkillSettingsTab;
  onTabChange?: (tab: SkillSettingsTab) => void;
  onGenerateCallbackToken?: (skillId: string) => Promise<SkillCallbackTokenResponse>;
  isGeneratingCallbackToken?: boolean;
  onSkillPatched?: (skill: Skill) => void;
  onEnsureNoCodeMode?: () => Promise<void>;
  filesTabContent?: React.ReactNode;
};

export function SkillFormContent({
  knowledgeBases,
  embeddingProviders,
  isEmbeddingProvidersLoading,
  fileStorageProviders,
  workspaceDefaultFileStorageProvider,
  isFileStorageProvidersLoading = false,
  fileStorageProvidersError,
  hasSkillFiles,
  isSkillFilesReady,
  llmOptions,
  onSubmit,
  isSubmitting,
  skill,
  allowNoCodeFlow = false,
  getIconComponent,
  hideHeader = false,
  isOpen = true,
  activeTab,
  onTabChange,
  onGenerateCallbackToken,
  isGeneratingCallbackToken = false,
  onSkillPatched,
  onEnsureNoCodeMode,
  filesTabContent,
}: SkillFormProps) {
  const [internalTab, setInternalTab] = useState<SkillSettingsTab>("main");
  const form = useForm<SkillFormValues>({
    resolver: zodResolver(skillFormSchema),
    defaultValues: defaultFormValues,
  });
  const lastSavedRef = useRef<SkillFormValues>(defaultFormValues);
  const currentTab = activeTab ?? internalTab;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [skillActionsChanges, setSkillActionsChanges] = useState<SkillActionChange[]>([]);
  const [callbackTokenStatus, setCallbackTokenStatus] = useState<{
    isSet: boolean;
    lastRotatedAt: string | null;
    lastFour: string | null;
  }>({
    isSet: Boolean(skill?.noCodeConnection?.callbackTokenIsSet),
    lastRotatedAt: skill?.noCodeConnection?.callbackTokenLastRotatedAt ?? null,
    lastFour: skill?.noCodeConnection?.callbackTokenLastFour ?? null,
  });
  const [issuedCallbackToken, setIssuedCallbackToken] = useState<string | null>(null);
  const [issuedCallbackTokenMeta, setIssuedCallbackTokenMeta] = useState<{ rotatedAt: string | null; lastFour: string | null }>({
    rotatedAt: null,
    lastFour: null,
  });
  const [showCallbackTokenModal, setShowCallbackTokenModal] = useState(false);

  // Fetch ASR providers
  const { data: asrProviders } = useAsrProviders();

  const handleTabChange = (tab: string) => {
    const next: SkillSettingsTab = tab === "transcription" || tab === "actions" || tab === "files" ? tab : "main";
    if (onTabChange) {
      onTabChange(next);
    } else {
      setInternalTab(next);
    }
  };
  useEffect(() => {
    setCallbackTokenStatus({
      isSet: Boolean(skill?.noCodeConnection?.callbackTokenIsSet),
      lastRotatedAt: skill?.noCodeConnection?.callbackTokenLastRotatedAt ?? null,
      lastFour: skill?.noCodeConnection?.callbackTokenLastFour ?? null,
    });
  }, [
    skill?.id,
    skill?.noCodeConnection?.callbackTokenIsSet,
    skill?.noCodeConnection?.callbackTokenLastRotatedAt,
    skill?.noCodeConnection?.callbackTokenLastFour,
  ]);
  const callbackLink = useMemo(() => {
    const workspaceId = skill?.workspaceId;
    if (!workspaceId) {
      return null;
    }
    if (typeof window === "undefined") {
      return null;
    }
    const url = new URL("/api/no-code/callback/messages", window.location.origin);
    return url.toString();
  }, [skill?.workspaceId]);
  const transcriptCallbackLink = useMemo(() => {
    const workspaceId = skill?.workspaceId;
    if (!workspaceId) {
      return null;
    }
    if (typeof window === "undefined") {
      return null;
    }
    const url = new URL("/api/no-code/callback/transcripts", window.location.origin);
    return url.toString();
  }, [skill?.workspaceId]);
  const handleCopyCallbackLink = async () => {
    if (!callbackLink || typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      return;
    }
    try {
      await navigator.clipboard.writeText(callbackLink);
      toast({ title: "Ссылка callback скопирована" });
    } catch {
      toast({ title: "Не удалось скопировать ссылку", variant: "destructive" });
    }
  };
  const handleCopyTranscriptCallbackLink = async () => {
    if (!transcriptCallbackLink || typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      return;
    }
    try {
      await navigator.clipboard.writeText(transcriptCallbackLink);
      toast({ title: "Ссылка для транскриптов скопирована" });
    } catch {
      toast({ title: "Не удалось скопировать ссылку", variant: "destructive" });
    }
  };
  const isSystemSkill = Boolean(skill?.isSystem);
  const iconValue = form.watch("icon") ?? "";
  const transcriptionMode = form.watch("onTranscriptionMode");
  const isAutoActionMode = transcriptionMode === "auto_action";
  const transcriptionFlowMode = form.watch("transcriptionFlowMode");
  const isTranscriptionNoCode = transcriptionFlowMode === "no_code";
  const controlsDisabled = isSubmitting || isSystemSkill;
  const noCodeDisabled = controlsDisabled || !allowNoCodeFlow;
  const isNoCodeMode = form.watch("executionMode") === "no_code";
  const isStandardMode = !isNoCodeMode;
  const showRagUi = !isNoCodeMode; // Показывать RAG UI для всех режимов, кроме no-code
  const hasSkillFilesValue = Boolean(hasSkillFiles);
  const skillFilesReady = isSkillFilesReady ?? true;
  const canManageCallbackToken = Boolean(skill?.id && isNoCodeMode && allowNoCodeFlow && onGenerateCallbackToken);
  const formatDateTime = (value: string | null | undefined): string | null => {
    if (!value) return null;
    try {
      return new Date(value).toLocaleString("ru-RU");
    } catch {
      return null;
    }
  };
  const callbackTokenRotatedLabel = formatDateTime(callbackTokenStatus.lastRotatedAt);
  const providerSelection = form.watch("noCodeFileStorageProviderId") ?? WORKSPACE_DEFAULT_PROVIDER_VALUE;
  const normalizedProviderSelection =
    providerSelection && providerSelection !== WORKSPACE_DEFAULT_PROVIDER_VALUE ? providerSelection : null;
  const selectedProvider = normalizedProviderSelection
    ? fileStorageProviders.find((provider) => provider.id === normalizedProviderSelection) ?? null
    : null;
  const workspaceDefaultProvider = workspaceDefaultFileStorageProvider ?? null;
  const resolvedProvider = selectedProvider ?? (normalizedProviderSelection ? null : workspaceDefaultProvider);
  const resolvedProviderSource: "skill" | "workspace_default" | "none" =
    selectedProvider ? "skill" : resolvedProvider ? "workspace_default" : "none";
  const backendEffectiveProvider = skill?.noCodeConnection?.effectiveFileStorageProvider ?? null;
  const backendEffectiveSource = skill?.noCodeConnection?.effectiveFileStorageProviderSource ?? "none";
  const effectiveProvider =
    resolvedProvider ??
    (!form.formState.isDirty ? backendEffectiveProvider ?? null : null);
  const effectiveProviderSource =
    resolvedProviderSource !== "none"
      ? resolvedProviderSource
      : !form.formState.isDirty
        ? backendEffectiveSource ?? "none"
        : "none";
  const isBearerProvider = effectiveProvider?.authType === "bearer";
  const noCodeAuthType = isBearerProvider ? "bearer" : "none";
  const noCodeBearerTokenValue = form.watch("noCodeBearerToken");
  const bearerTokenAction = form.watch("noCodeBearerTokenAction");
  const hasBearerTokenDraft = Boolean(noCodeBearerTokenValue?.trim());
  const storedNoCodeTokenIsSet = skill?.noCodeConnection?.tokenIsSet ?? false;
  const isClearingBearerToken = bearerTokenAction === "clear";
  const isReplacingBearerToken = bearerTokenAction === "replace" || (!storedNoCodeTokenIsSet && bearerTokenAction !== "clear");
  useEffect(() => {
    const nextAuthType = isBearerProvider ? "bearer" : "none";
    if (form.getValues("noCodeAuthType") !== nextAuthType) {
      form.setValue("noCodeAuthType", nextAuthType, { shouldDirty: false });
    }
  }, [form, isBearerProvider]);
  const providerNotFound =
    normalizedProviderSelection && !selectedProvider ? normalizedProviderSelection : null;
  const handleReplaceBearerToken = () => {
    form.setValue("noCodeBearerTokenAction", "replace", { shouldDirty: true });
    form.setValue("noCodeBearerToken", "", { shouldDirty: true });
  };
  const handleClearBearerToken = () => {
    form.setValue("noCodeBearerTokenAction", "clear", { shouldDirty: true });
    form.setValue("noCodeBearerToken", "", { shouldDirty: true });
  };
  const handleCancelBearerTokenChange = () => {
    form.setValue("noCodeBearerTokenAction", storedNoCodeTokenIsSet ? "keep" : "replace", { shouldDirty: true });
    form.setValue("noCodeBearerToken", "", { shouldDirty: true });
  };
  const handleGenerateCallbackToken = async () => {
    if (!skill?.id || !onGenerateCallbackToken) {
      return;
    }
    if (!isNoCodeMode) {
      toast({
        title: "Сохраните навык в режиме No-code",
        description: "Сначала выберите No-code и сохраните навык, чтобы сгенерировать токен.",
        variant: "destructive",
      });
      return;
    }
    try {
      if (onEnsureNoCodeMode) {
        await onEnsureNoCodeMode();
      }
      const result = await onGenerateCallbackToken(skill.id);
      if (!result) {
        return;
      }
      const connection = result.skill?.noCodeConnection;
      setCallbackTokenStatus({
        isSet: Boolean(connection?.callbackTokenIsSet),
        lastRotatedAt: connection?.callbackTokenLastRotatedAt ?? result.rotatedAt ?? null,
        lastFour: connection?.callbackTokenLastFour ?? result.lastFour ?? null,
      });
      onSkillPatched?.(result.skill as unknown as Skill);
      setIssuedCallbackToken(result.token);
      setIssuedCallbackTokenMeta({ rotatedAt: result.rotatedAt ?? null, lastFour: result.lastFour ?? null });
      setShowCallbackTokenModal(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось сгенерировать токен";
      toast({
        title: "Не удалось сгенерировать токен",
        description: message,
        variant: "destructive",
      });
    }
  };
  const handleCopyCallbackToken = async () => {
    if (!issuedCallbackToken) {
      return;
    }
    try {
      if (typeof navigator !== "undefined" && navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(issuedCallbackToken);
        toast({ title: "Токен скопирован" });
      }
    } catch {
      toast({ title: "Не удалось скопировать токен", variant: "destructive" });
    }
  };
  const handleCloseCallbackTokenModal = () => {
    setShowCallbackTokenModal(false);
    setIssuedCallbackToken(null);
    setIssuedCallbackTokenMeta({ rotatedAt: null, lastFour: null });
  };
  const transcriptActionsQuery = useQuery<SkillActionConfigItem[]>({
    queryKey: ["skill-actions", skill?.id, "transcript"],
    enabled: Boolean(skill?.id),
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/skills/${skill!.id}/actions`);
      const json = await response.json();
      const items = (json.items ?? []) as SkillActionConfigItem[];
      return items.filter((item) => {
        // Фильтруем только действия с target="transcript" и включенные (enabled)
        if (item.action.target !== "transcript") {
          return false;
        }
        // Действие должно быть включено для навыка
        if (!item.skillAction?.enabled) {
          return false;
        }
        // Должен быть хотя бы один enabled placement, который есть в action.placements
        const allowedPlacements = item.action.placements ?? [];
        const enabledPlacements = item.skillAction.enabledPlacements ?? [];
        const hasValidPlacement = enabledPlacements.some((p) => allowedPlacements.includes(p));
        return hasValidPlacement;
      });
    },
  });
  const transcriptActions = transcriptActionsQuery.data ?? [];
  
  // Очищаем выбранное автодействие, если оно больше не доступно (отключено)
  useEffect(() => {
    if (!transcriptActionsQuery.isLoading && transcriptActionsQuery.data && isAutoActionMode) {
      const selectedActionId = form.getValues("onTranscriptionAutoActionId");
      if (selectedActionId && !transcriptActions.some((item) => item.action.id === selectedActionId)) {
        form.setValue("onTranscriptionAutoActionId", "", { shouldDirty: true });
      }
    }
  }, [transcriptActions, transcriptActionsQuery.isLoading, transcriptActionsQuery.data, isAutoActionMode, form]);
  const systemSkillDescription =
    skill?.systemKey === "UNICA_CHAT"
      ? "Настройки Unica Chat управляются администратором инстанса. Изменить их из рабочего пространства нельзя."
      : "Системные навыки управляются администратором и недоступны для редактирования.";

  const sortedKnowledgeBases = useMemo(() => {
    return [...knowledgeBases].sort((a, b) => a.name.localeCompare(b.name, "ru", { sensitivity: "base" }));
  }, [knowledgeBases]);
  const executionMode = form.watch("executionMode");
  const knowledgeBaseIds = form.watch("knowledgeBaseIds");
  
  // Получаем embedding-провайдер из правил индексации (если доступно для админов)
  const indexingRulesQuery = useQuery({
    queryKey: ["/api/admin/indexing-rules"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/admin/indexing-rules");
      return (await response.json()) as { embeddingsProvider: string; embeddingsModel: string };
    },
    retry: false,
    enabled: true, // Пытаемся загрузить, если пользователь админ
    staleTime: 60000, // Кэшируем на 1 минуту
  });
  
  // Получаем название embedding-провайдера из правил индексации (для админов)
  const embeddingProviderFromRules = indexingRulesQuery.data?.embeddingsProvider;
  const embeddingProviderName = useMemo(() => {
    if (embeddingProviderFromRules && embeddingProviders.length > 0) {
      const provider = embeddingProviders.find((p) => p.id === embeddingProviderFromRules);
      return provider?.name ?? embeddingProviderFromRules;
    }
    return null;
  }, [embeddingProviderFromRules, embeddingProviders]);

  // Автоматическое определение режима при изменении баз знаний
  useEffect(() => {
    if (executionMode === "no_code") {
      // Для no-code режима всегда llm, не меняем
      return;
    }
    const hasSelectedBases = (knowledgeBaseIds?.length ?? 0) > 0;
    if (!hasSelectedBases && !skillFilesReady) {
      return;
    }
    const hasRagSources = hasSelectedBases || hasSkillFilesValue;
    const newMode = hasRagSources ? "rag" : "llm";
    form.setValue("mode", newMode, { shouldDirty: true });
  }, [knowledgeBaseIds, executionMode, form, hasSkillFilesValue, skillFilesReady]);

  const effectiveLlmOptions = useMemo(() => {
    if (!skill?.llmProviderConfigId || !skill?.modelId) {
      return llmOptions;
    }

    const key = buildLlmKey(skill.llmProviderConfigId, skill.modelId);
    if (llmOptions.some((option) => option.key === key)) {
      return llmOptions;
    }

    const fallbackOption: LlmSelectionOption = {
      key,
      label: `${skill.llmProviderConfigId} · ${skill.modelId}`,
      providerId: skill.llmProviderConfigId,
      providerName: skill.llmProviderConfigId,
      modelId: skill.modelId,
      modelDisplayName: skill.modelId,
      costLevel: "MEDIUM",
      providerIsActive: false,
      disabled: true,
      catalogModel: null,
    };

    return [...llmOptions, fallbackOption];
  }, [llmOptions, skill]);

  useEffect(() => {
    if (!isOpen) {
      const nextValues = { ...defaultFormValues };
      form.reset(nextValues);
      lastSavedRef.current = nextValues;
      return;
    }

    if (skill) {
      const ragConfig = skill.ragConfig ?? {
        topK: 5,
        minScore: 0.7,
        maxContextTokens: null,
        showSources: true,
        historyMessagesLimit: 6,
        historyCharsLimit: 4000,
        enableQueryRewriting: true,
        queryRewriteModel: null,
        enableContextCaching: false,
        contextCacheTtlSeconds: 300,
        embeddingProviderId: null,
        bm25Weight: null,
        bm25Limit: null,
        vectorWeight: null,
        vectorLimit: null,
        llmTemperature: null,
        llmMaxTokens: null,
        llmResponseFormat: null,
      };

      const llmKey = buildLlmKey(skill.llmProviderConfigId ?? "", skill.modelId ?? "");
      const noCodeConnection = skill.noCodeConnection ?? {
        endpointUrl: null,
        fileEventsUrl: null,
        fileStorageProviderId: null,
        selectedFileStorageProviderId: null,
        effectiveFileStorageProvider: null,
        effectiveFileStorageProviderSource: "none" as const,
        authType: "none" as "none" | "bearer",
        tokenIsSet: false,
        callbackTokenIsSet: false,
        callbackTokenLastRotatedAt: null,
        callbackTokenLastFour: null,
      };
      const nextValues: SkillFormValues = {
        name: skill.name ?? "",
        description: skill.description ?? "",
        executionMode: skill.executionMode ?? "standard",
        mode: skill.mode ?? "llm",
        knowledgeBaseIds: skill.knowledgeBaseIds ?? [],
        llmKey,
        llmTemperature:
          ragConfig.llmTemperature === null || ragConfig.llmTemperature === undefined
            ? ""
            : String(ragConfig.llmTemperature),
        llmMaxTokens:
          ragConfig.llmMaxTokens === null || ragConfig.llmMaxTokens === undefined
            ? ""
            : String(ragConfig.llmMaxTokens),
        systemPrompt: skill.systemPrompt ?? "",
        icon: skill.icon ?? "",
        transcriptionFlowMode: skill.transcriptionFlowMode ?? "standard",
        asrProviderId: skill.asrProviderId ?? null,
        onTranscriptionMode: skill.onTranscriptionMode ?? "raw_only",
        onTranscriptionAutoActionId: skill.onTranscriptionAutoActionId ?? "",
        noCodeFileStorageProviderId:
          noCodeConnection.selectedFileStorageProviderId ??
          noCodeConnection.fileStorageProviderId ??
          WORKSPACE_DEFAULT_PROVIDER_VALUE,
        noCodeEndpointUrl: noCodeConnection.endpointUrl ?? "",
        noCodeAuthType: noCodeConnection.authType ?? "none",
        ragShowSources: ragConfig.showSources ?? true,
        ragHistoryMessagesLimit: ragConfig.historyMessagesLimit ?? 6,
        ragHistoryCharsLimit: ragConfig.historyCharsLimit ?? 4000,
        ragEnableQueryRewriting: ragConfig.enableQueryRewriting ?? true,
        ragQueryRewriteModel: ragConfig.queryRewriteModel ?? "",
        ragEnableContextCaching: ragConfig.enableContextCaching ?? false,
        ragContextCacheTtlSeconds: ragConfig.contextCacheTtlSeconds ?? 300,
        noCodeBearerToken: "",
        noCodeBearerTokenAction: noCodeConnection.tokenIsSet ? "keep" : "replace",
      };
      form.reset(nextValues);
      lastSavedRef.current = nextValues;
      return;
    }

    const fallbackLlmKey = effectiveLlmOptions.find((option) => !option.disabled)?.key ?? "";
    
    // Find default ASR provider for new skills
    const defaultAsrProvider = asrProviders?.find(p => p.isDefaultAsr);
    const defaultAsrProviderId = defaultAsrProvider?.id ?? null;
    
    const nextValues = { 
      ...defaultFormValues, 
      llmKey: fallbackLlmKey,
      asrProviderId: defaultAsrProviderId,
    };
    form.reset(nextValues);
    lastSavedRef.current = nextValues;
  }, [isOpen, skill, form, effectiveLlmOptions, asrProviders]);

  const handleSubmit = form.handleSubmit(async (values) => {
    if (isSystemSkill) {
      return;
    }
    form.clearErrors();
    
    let hasValidationErrors = false;
    
    // Валидация стандартного режима транскрибации
    if (values.transcriptionFlowMode === "standard" && !values.asrProviderId) {
      form.setError("asrProviderId", {
        type: "manual",
        message: "Выберите ASR провайдер для стандартного режима транскрибации",
      });
      hasValidationErrors = true;
    }
    
    if (values.executionMode === "no_code") {
      const endpoint = (values.noCodeEndpointUrl ?? "").trim();
      if (!endpoint) {
        form.setError("noCodeEndpointUrl", { type: "manual", message: "Укажите message URL для no-code" });
        hasValidationErrors = true;
      }
      if (!effectiveProvider) {
        form.setError("noCodeFileStorageProviderId", {
          type: "manual",
          message: "Выберите файловый провайдер или задайте дефолт в воркспейсе",
        });
        hasValidationErrors = true;
      }
      if (isBearerProvider) {
        const action = form.getValues("noCodeBearerTokenAction");
        const tokenDraft = (form.getValues("noCodeBearerToken") ?? "").trim();
        const hasToken = action === "keep" ? storedNoCodeTokenIsSet || Boolean(tokenDraft) : Boolean(tokenDraft);
        if (!hasToken) {
          form.setError("noCodeBearerToken", {
            type: "manual",
            message: "Bearer токен обязателен для выбранного провайдера",
          });
          hasValidationErrors = true;
        }
      }
    }
    
    if (hasValidationErrors) {
      // Переключаемся на вкладку с ошибкой
      if (form.formState.errors.asrProviderId) {
        handleTabChange("transcription");
      }
      toast({
        title: "Ошибка валидации",
        description: "Пожалуйста, заполните все обязательные поля",
        variant: "destructive",
      });
      return;
    }
    try {
      // Автоматическое определение режима на основе баз знаний
      const hasRagSources =
        values.executionMode !== "no_code" &&
        (values.knowledgeBaseIds.length > 0 || hasSkillFilesValue);
      const autoMode = values.executionMode === "no_code" ? "llm" : hasRagSources ? "rag" : "llm";

      const nextValues: SkillFormValues = {
        ...values,
        mode: autoMode,
        noCodeAuthType: noCodeAuthType,
        noCodeBearerTokenAction:
          values.noCodeBearerTokenAction ?? (storedNoCodeTokenIsSet ? "keep" : "replace"),
      };
      if (!isBearerProvider) {
        nextValues.noCodeBearerTokenAction = "clear";
        nextValues.noCodeBearerToken = "";
      }
      const didSave = await onSubmit(nextValues);
      if (didSave) {
        // Сохраняем изменения действий если они есть
        if (skillActionsChanges.length > 0 && skill?.id) {
          try {
            const autoActionId = form.getValues("onTranscriptionAutoActionId") || skill?.onTranscriptionAutoActionId || null;
            
            // Проверяем, не пытаются ли отключить автодействие
            if (autoActionId) {
              const autoActionChange = skillActionsChanges.find(c => c.actionId === autoActionId);
              if (autoActionChange && !autoActionChange.enabled) {
                toast({
                  title: "Невозможно отключить автодействие",
                  description: "Это действие используется как автодействие для транскрипции. Сначала выберите другое действие или отключите автодействие на вкладке «Транскрипция».",
                  variant: "destructive",
                });
                throw new Error("Нельзя отключить действие, используемое как автодействие");
              }
            }
            
            for (const change of skillActionsChanges) {
              const response = await apiRequest("PUT", `/api/skills/${skill.id}/actions/${change.actionId}`, {
                enabled: change.enabled,
                enabledPlacements: change.enabledPlacements,
                labelOverride: change.labelOverride,
              });
              if (!response.ok) {
                throw new Error(`Не удалось сохранить действие ${change.actionId}`);
              }
            }
            // Инвалидируем и перезагружаем запрос действий, чтобы обновить данные на фронтенде
            await queryClient.invalidateQueries({ queryKey: ["skill-actions", skill.id] });
            await queryClient.refetchQueries({ queryKey: ["skill-actions", skill.id] });
            // Очищаем изменения после успешного сохранения и обновления данных
            setSkillActionsChanges([]);
          } catch (err) {
            const message = err instanceof Error ? err.message : "Не удалось сохранить изменения действий";
            toast({
              title: "Ошибка сохранения действий",
              description: message,
              variant: "destructive",
            });
            // Не блокируем дальнейшие действия, даже если не удалось сохранить действия
          }
        }
        
        const normalized: SkillFormValues = {
          ...nextValues,
          name: nextValues.name.trim(),
          description: nextValues.description?.trim() ?? "",
          systemPrompt: nextValues.systemPrompt?.trim() ?? "",
          icon: nextValues.icon?.trim() ?? "",
          noCodeFileStorageProviderId:
            nextValues.noCodeFileStorageProviderId ?? WORKSPACE_DEFAULT_PROVIDER_VALUE,
          noCodeBearerToken: "",
          noCodeBearerTokenAction: nextValues.noCodeBearerTokenAction === "clear" ? "replace" : "keep",
        };
        lastSavedRef.current = normalized;
        form.reset(normalized);
      }
    } catch {
      // Ошибка обрабатывается в родителе через toast, оставляем форму dirty.
    }
  });

  const selectedKnowledgeBasesDisabled = sortedKnowledgeBases.length === 0;
  const llmDisabled = effectiveLlmOptions.length === 0;

  const renderIconPreview = (iconName: string | null | undefined, className = "h-5 w-5") => {
    const Icon = getSkillIcon(iconName);
    return Icon ? <Icon className={className} /> : null;
  };

  const isDirty = form.formState.isDirty || skillActionsChanges.length > 0;

  const handleReset = () => {
    form.reset(lastSavedRef.current);
    setSkillActionsChanges([]); // Сбрасываем изменения действий
  };

  return (
    <>
      <Form {...form}>
        <form onSubmit={handleSubmit} className="flex flex-col">
          <Tabs value={currentTab} onValueChange={handleTabChange}>
            {/* Sticky Tabs Header */}
            <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm">
              <div className="mx-auto w-full max-w-4xl px-4 md:px-6">
                {!hideHeader && isSystemSkill && (
                  <Alert variant="default" className="mt-3 mb-4 md:mt-4">
                    <AlertTitle>Системный навык</AlertTitle>
                    <AlertDescription>{systemSkillDescription}</AlertDescription>
                  </Alert>
                )}
                <TabsList variant="line">
                  <TabsTrigger variant="line" value="main" data-testid="skill-settings-tab-main">
                    Основное
                  </TabsTrigger>
                  <TabsTrigger variant="line" value="transcription" data-testid="skill-settings-tab-transcription">
                    Транскрипция
                  </TabsTrigger>
                  <TabsTrigger variant="line" value="actions">
                    Действия
                  </TabsTrigger>
                  <TabsTrigger variant="line" value="files">
                    Файлы навыка
                  </TabsTrigger>
                </TabsList>
              </div>
            </div>

            <TabsContent value="main" className="mx-auto w-full max-w-4xl px-4 py-4 md:px-6 md:py-6">
              <div className="space-y-8">
                <fieldset disabled={controlsDisabled} className="space-y-8">
                  <div className="space-y-4">
                    <h3 className="text-base font-semibold text-foreground">Метаданные</h3>
                    <div className="space-y-4" data-testid="skill-icon-name-row">
                      <FormField
                        control={form.control}
                        name="icon"
                        render={({ field }) => (
                          <FormItem className="grid grid-cols-[200px_1fr] gap-4 items-start">
                            <FormLabel className="pt-2.5 text-sm font-medium">Иконка</FormLabel>
                            <FormControl>
                              <div className="flex items-center gap-3">
                                <IconPicker
                                  value={field.value ?? ""}
                                  onChange={(icon) => field.onChange(icon)}
                                  renderIcon={(iconName, className = "h-5 w-5") =>
                                    renderIconPreview(iconName, className)
                                  }
                                />
                                <span className="text-sm text-muted-foreground" data-testid="skill-icon-label">
                                  {iconValue ? iconValue : "Не выбрана"}
                                </span>
                              </div>
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                          <FormItem className="grid grid-cols-[200px_1fr] gap-4 items-start">
                            <FormLabel className="pt-2.5 text-sm font-medium">Название</FormLabel>
                            <div className="space-y-2">
                              <FormControl>
                                <Input
                                  {...field}
                                  placeholder="Например: Бизнес-процессы"
                                  data-testid="skill-name-input"
                                />
                              </FormControl>
                              <FormMessage className="text-xs text-destructive leading-tight" />
                            </div>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="description"
                        render={({ field }) => (
                          <FormItem className="grid grid-cols-[200px_1fr] gap-4 items-start">
                            <FormLabel className="pt-2.5 text-sm font-medium">Описание</FormLabel>
                            <div className="space-y-2">
                              <FormControl>
                                <Textarea
                                  {...field}
                                  placeholder="Когда использовать навык и чем он помогает"
                                  rows={3}
                                  data-testid="skill-description-input"
                                />
                              </FormControl>
                              <FormMessage className="text-xs text-destructive leading-tight" />
                            </div>
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <FormField
                      control={form.control}
                      name="executionMode"
                      render={({ field }) => (
                        <FormItem className="grid grid-cols-[200px_1fr] gap-4 items-start">
                          <div className="pt-2.5">
                            <FormLabel className="text-sm font-medium">Обработка</FormLabel>
                          </div>
                          <FormControl>
                            <RadioGroup 
                              value={field.value} 
                              onValueChange={controlsDisabled ? undefined : field.onChange} 
                              className="flex flex-col gap-3"
                            >
                              <FieldLabel htmlFor="execution-mode-standard" className="cursor-pointer">
                                <Field 
                                  orientation="horizontal"
                                  className="rounded-lg border-2 p-4 transition-all has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 has-[:data-state=checked]:border-primary has-[:data-state=checked]:bg-accent/50 border-muted bg-card hover:bg-accent/30"
                                >
                                  <FieldContent>
                                    <FieldTitle>Внутри платформы</FieldTitle>
                                    <FieldDescription>
                                      С использованием LLM и RAG
                                    </FieldDescription>
                                  </FieldContent>
                                  <RadioGroupItem
                                    value="standard"
                                    id="execution-mode-standard"
                                    disabled={controlsDisabled}
                                    data-testid="execution-mode-standard"
                                  />
                                </Field>
                              </FieldLabel>

                              <FieldLabel htmlFor="execution-mode-no-code" className="cursor-pointer">
                                <Field 
                                  orientation="horizontal"
                                  className="rounded-lg border-2 p-4 transition-all has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 has-[:data-state=checked]:border-primary has-[:data-state=checked]:bg-accent/50 border-muted bg-card hover:bg-accent/30"
                                >
                                  <FieldContent>
                                    <div className="flex items-center gap-2">
                                      <FieldTitle>Внешний сценарий</FieldTitle>
                                      {!allowNoCodeFlow && (
                                        <Badge variant="secondary" className="text-xs">Premium</Badge>
                                      )}
                                    </div>
                                    <FieldDescription>
                                      На no-code через webhook
                                    </FieldDescription>
                                  </FieldContent>
                                  <RadioGroupItem
                                    value="no_code"
                                    id="execution-mode-no-code"
                                    disabled={noCodeDisabled}
                                    data-testid="execution-mode-no-code"
                                  />
                                </Field>
                              </FieldLabel>
                            </RadioGroup>
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>

                {isStandardMode ? (
                  <>
                    <div className="space-y-4">
                      <div>
                        <h3 className="text-base font-semibold text-foreground">Инструкция</h3>
                        <p className="text-sm text-muted-foreground mt-1">
                          Системный промпт для модели LLM
                        </p>
                      </div>
                      <div className="space-y-4">
                        <FormField
                          control={form.control}
                          name="systemPrompt"
                          render={({ field }) => (
                            <FormItem className="space-y-2">
                              <FormLabel className="sr-only">Инструкция</FormLabel>
                              <FormControl>
                                <Textarea
                                  {...field}
                                  placeholder="Добавьте инструкции для модели"
                                  className="min-h-[220px]"
                                  data-testid="skill-instruction-textarea"
                                />
                              </FormControl>
                              <p className="text-xs text-muted-foreground leading-tight">
                                Всегда отправляется в LLM.
                              </p>
                              <FormMessage className="text-xs text-destructive leading-tight" />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <h3 className="text-base font-semibold text-foreground">Модель LLM</h3>
                        <p className="text-sm text-muted-foreground mt-1">
                          Используется для генеративных ответов навыка
                        </p>
                      </div>
                      <div className="space-y-4">
                        <FormField
                          control={form.control}
                          name="llmKey"
                          render={({ field }) => (
                            <FormItem className="grid grid-cols-[200px_1fr] gap-4 items-start">
                              <FormLabel className="pt-2.5 text-sm font-medium">LLM провайдер и модель</FormLabel>
                              <div className="space-y-2">
                                <FormControl>
                                  <Select value={field.value} onValueChange={field.onChange} disabled={llmDisabled || controlsDisabled}>
                                    <SelectTrigger data-testid="llm-model-select">
                                      <SelectValue placeholder="Выберите модель" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {effectiveLlmOptions.map((option) => (
                                        <SelectItem key={option.key} value={option.key} disabled={option.disabled}>
                                          <div className="flex flex-col gap-0.5">
                                            <div className="flex items-center gap-2">
                                              <span className="font-medium">{option.label}</span>
                                              <Badge variant="outline" className="uppercase tracking-wide">
                                                {costLevelLabel[option.costLevel]}
                                              </Badge>
                                            </div>
                                            {!option.providerIsActive && (
                                              <span className="text-xs text-muted-foreground">Провайдер отключён</span>
                                            )}
                                          </div>
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </FormControl>
                                <p className="text-xs text-muted-foreground leading-tight">
                                  Используется для генеративных ответов навыка.
                                </p>
                                <FormMessage className="text-xs text-destructive leading-tight" />
                              </div>
                            </FormItem>
                          )}
                        />

                        {executionMode !== "standard" && (
                          <Accordion type="single" collapsible>
                          <AccordionItem value="llm-advanced" className="border-none">
                            <AccordionTrigger className="py-2" data-testid="llm-advanced-accordion">
                              Параметры LLM
                            </AccordionTrigger>
                            <AccordionContent>
                              <div className="grid gap-4 md:grid-cols-2">
                                <FormField
                                  control={form.control}
                                  name="llmTemperature"
                                  render={({ field }) => (
                                    <FormItem>
                                      <div className="flex items-center gap-2">
                                        <FormLabel>Температура</FormLabel>
                                        <InfoTooltipIcon text="Определяет вариативность ответа модели. Чем выше значение, тем более креативный ответ." />
                                      </div>
                                      <FormControl>
                                        <Input
                                          type="number"
                                          step="0.1"
                                          min={0}
                                          max={2}
                                          placeholder="0.7"
                                          value={field.value ?? ""}
                                          onChange={(event) => field.onChange(event.target.value)}
                                          data-testid="llm-temperature-input"
                                        />
                                      </FormControl>
                                      <FormDescription className="text-xs text-muted-foreground leading-tight">
                                        Оставьте пустым, чтобы использовать значения провайдера.
                                      </FormDescription>
                                      <FormMessage className="text-xs text-destructive leading-tight" />
                                    </FormItem>
                                  )}
                                />
                                <FormField
                                  control={form.control}
                                  name="llmMaxTokens"
                                  render={({ field }) => (
                                    <FormItem>
                                      <div className="flex items-center gap-2">
                                        <FormLabel>Макс. токенов ответа</FormLabel>
                                        <InfoTooltipIcon text="Ограничивает длину ответа модели. Если пусто — используем настройки провайдера." />
                                      </div>
                                      <FormControl>
                                        <Input
                                          type="number"
                                          min={16}
                                          max={4096}
                                          placeholder="1024"
                                          value={field.value ?? ""}
                                          onChange={(event) => field.onChange(event.target.value)}
                                          data-testid="llm-max-tokens-input"
                                        />
                                      </FormControl>
                                      <FormMessage className="text-xs text-destructive leading-tight" />
                                    </FormItem>
                                  )}
                                />
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                          </Accordion>
                        )}
                      </div>
                    </div>
                    {showRagUi ? (
                    <div className="space-y-4">
                      <div>
                        <h3 className="text-base font-semibold text-foreground">Источники знаний</h3>
                        <p className="text-sm text-muted-foreground mt-1">
                          Базы знаний и файлы для поиска информации{form.watch("mode") === "rag" && " (режим RAG активен)"}
                        </p>
                      </div>
                      <div className="space-y-6">
                        {executionMode !== "no_code" && (
                          <div className="grid gap-6">
                            <FormField
                              control={form.control}
                              name="knowledgeBaseIds"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Базы знаний</FormLabel>
                                  <FormControl>
                                    <KnowledgeBaseMultiSelect
                                      value={field.value}
                                      onChange={field.onChange}
                                      knowledgeBases={sortedKnowledgeBases}
                                      disabled={selectedKnowledgeBasesDisabled || controlsDisabled}
                                      embeddingProviderName={embeddingProviderName}
                                    />
                                  </FormControl>
                                  <FormDescription className="text-xs text-muted-foreground leading-tight">
                                    {field.value.length > 0 && embeddingProviderName
                                      ? `Все выбранные базы знаний используют embedding-провайдер "${embeddingProviderName}" из правил индексации`
                                      : field.value.length > 0 && !embeddingProviderName && indexingRulesQuery.isError
                                        ? "Не удалось загрузить информацию о embedding-провайдере. Валидация будет выполнена на сервере."
                                        : field.value.length > 0 && !embeddingProviderName && !indexingRulesQuery.isError && !indexingRulesQuery.isLoading
                                          ? "Все базы знаний используют embedding-провайдер из правил индексации"
                                          : null}
                                  </FormDescription>
                                  <FormMessage className="text-xs text-destructive leading-tight" />
                                </FormItem>
                              )}
                            />
                            
                            <FormField
                              control={form.control}
                              name="ragShowSources"
                              render={({ field }) => (
                                <FormItem>
                                  <div className="flex items-center justify-between rounded-lg border p-3">
                                    <div className="space-y-0.5">
                                      <FormLabel className="text-sm font-medium">
                                        Показывать источники
                                      </FormLabel>
                                      <p className="text-xs text-muted-foreground">
                                        Отображать ссылки на документы базы знаний после ответа
                                      </p>
                                    </div>
                                    <FormControl>
                                      <Switch
                                        checked={field.value ?? true}
                                        onCheckedChange={field.onChange}
                                        disabled={controlsDisabled}
                                      />
                                    </FormControl>
                                  </div>
                                  <FormMessage className="text-xs text-destructive leading-tight" />
                                </FormItem>
                              )}
                            />

                            <div className="rounded-lg border p-4 space-y-4">
                              <div className="flex items-center gap-2">
                                <FormLabel className="text-sm font-medium">История диалога</FormLabel>
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-xs">
                                      <p className="text-xs">
                                        Настройка количества сообщений и символов из истории разговора, которые будут использоваться для улучшения поиска в базе знаний.
                                      </p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              </div>

                              <FormField
                                control={form.control}
                                name="ragHistoryMessagesLimit"
                                render={({ field }) => (
                                  <FormItem>
                                    <div className="space-y-2">
                                      <div className="flex items-center justify-between">
                                        <FormLabel className="text-sm font-medium">
                                          Максимум сообщений
                                        </FormLabel>
                                        <span className="text-sm text-muted-foreground">
                                          {field.value ?? 6}
                                        </span>
                                      </div>
                                      <FormControl>
                                        <Slider
                                          value={[field.value ?? 6]}
                                          onValueChange={(values) => field.onChange(values[0])}
                                          min={0}
                                          max={20}
                                          step={1}
                                          disabled={controlsDisabled}
                                          className="w-full"
                                        />
                                      </FormControl>
                                      <FormDescription className="text-xs text-muted-foreground">
                                        0 = история отключена, 20 = максимум
                                      </FormDescription>
                                      <FormMessage className="text-xs text-destructive leading-tight" />
                                    </div>
                                  </FormItem>
                                )}
                              />

                              <FormField
                                control={form.control}
                                name="ragHistoryCharsLimit"
                                render={({ field }) => (
                                  <FormItem>
                                    <div className="space-y-2">
                                      <div className="flex items-center justify-between">
                                        <FormLabel className="text-sm font-medium">
                                          Максимум символов
                                        </FormLabel>
                                        <span className="text-sm text-muted-foreground">
                                          {field.value ? field.value.toLocaleString('ru-RU') : '4,000'}
                                        </span>
                                      </div>
                                      <FormControl>
                                        <Slider
                                          value={[field.value ?? 4000]}
                                          onValueChange={(values) => field.onChange(values[0])}
                                          min={0}
                                          max={50000}
                                          step={500}
                                          disabled={controlsDisabled}
                                          className="w-full"
                                        />
                                      </FormControl>
                                      <FormDescription className="text-xs text-muted-foreground">
                                        Ограничение по символам для экономии токенов
                                      </FormDescription>
                                      <FormMessage className="text-xs text-destructive leading-tight" />
                                    </div>
                                  </FormItem>
                                )}
                              />
                            </div>
                          </div>
                        )}

                        {/* Query Rewriting */}
                        <div className="space-y-4 border-t pt-4">
                          <div className="flex items-center gap-2">
                            <FormLabel className="text-sm font-medium">Умное переформулирование запросов</FormLabel>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs">
                                  <p className="text-xs">
                                    Автоматически улучшает уточняющие вопросы (например, "А какие исключения?", "Подробнее про пункт 2") для лучшего поиска в базе знаний.
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>

                          <FormField
                            control={form.control}
                            name="ragEnableQueryRewriting"
                            render={({ field }) => (
                              <FormItem className="flex items-center justify-between rounded-lg border p-3">
                                <div className="space-y-0.5">
                                  <FormLabel className="text-sm font-medium">
                                    Включить переформулирование
                                  </FormLabel>
                                  <FormDescription className="text-xs text-muted-foreground">
                                    Переформулирует уточняющие вопросы с учётом истории диалога
                                  </FormDescription>
                                </div>
                                <FormControl>
                                  <Switch
                                    checked={field.value ?? true}
                                    onCheckedChange={field.onChange}
                                    disabled={controlsDisabled}
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />

                          {form.watch("ragEnableQueryRewriting") && (
                            <FormField
                              control={form.control}
                              name="ragQueryRewriteModel"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-sm font-medium">
                                    Модель для переформулирования
                                  </FormLabel>
                                  <FormControl>
                                    <Select
                                      value={field.value && field.value !== "" ? field.value : "__default__"}
                                      onValueChange={(value) => field.onChange(value === "__default__" ? "" : value)}
                                      disabled={controlsDisabled}
                                    >
                                      <SelectTrigger>
                                        <SelectValue placeholder="Использовать основную модель" />
                                      </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="__default__">Основная модель навыка</SelectItem>
                                          {effectiveLlmOptions
                                            .filter((opt) => !opt.disabled)
                                            .map((opt) => {
                                              const [providerId, modelId] = opt.key.split("::");
                                              return (
                                                <SelectItem key={opt.key} value={modelId}>
                                                  {opt.label} {opt.costLevel !== "FREE" && `(${costLevelLabel[opt.costLevel]})`}
                                                </SelectItem>
                                              );
                                            })}
                                        </SelectContent>
                                    </Select>
                                  </FormControl>
                                  <FormDescription className="text-xs text-muted-foreground">
                                    Рекомендуется использовать быструю модель для минимизации задержки
                                  </FormDescription>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          )}
                        </div>

                        {/* Context Caching */}
                        <div className="space-y-4 border-t pt-4">
                          <div className="flex items-center gap-2">
                            <FormLabel className="text-sm font-medium">Кэширование контекста</FormLabel>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs">
                                  <p className="text-xs">
                                    Переиспользует найденные документы в рамках одного диалога для ускорения ответов на уточняющие вопросы.
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>

                          <FormField
                            control={form.control}
                            name="ragEnableContextCaching"
                            render={({ field }) => (
                              <FormItem className="flex items-center justify-between rounded-lg border p-3">
                                <div className="space-y-0.5">
                                  <FormLabel className="text-sm font-medium">
                                    Включить кэширование
                                  </FormLabel>
                                  <FormDescription className="text-xs text-muted-foreground">
                                    Сохранять результаты поиска между запросами в диалоге
                                  </FormDescription>
                                </div>
                                <FormControl>
                                  <Switch
                                    checked={field.value ?? false}
                                    onCheckedChange={field.onChange}
                                    disabled={controlsDisabled}
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />

                          {form.watch("ragEnableContextCaching") && (
                            <FormField
                              control={form.control}
                              name="ragContextCacheTtlSeconds"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-sm font-medium">
                                    Время жизни кэша (секунды)
                                  </FormLabel>
                                  <FormControl>
                                    <Input
                                      type="number"
                                      min={60}
                                      max={1800}
                                      value={field.value ?? 300}
                                      onChange={(e) => field.onChange(parseInt(e.target.value) || 300)}
                                      disabled={controlsDisabled}
                                    />
                                  </FormControl>
                                  <FormDescription className="text-xs text-muted-foreground">
                                    По умолчанию: 300 секунд (5 минут). Минимум: 60, максимум: 1800.
                                  </FormDescription>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                    ) : null}
                  </>
                ) : null}

                {isNoCodeMode ? (
                  <>
                    <div className="space-y-4">
                      <div>
                        <h3 className="text-base font-semibold text-foreground">No-code подключение</h3>
                        <p className="text-sm text-muted-foreground mt-1">
                          {allowNoCodeFlow
                            ? "URL и авторизация для внешнего сценария"
                            : "Доступно только на премиум-тарифе"}
                        </p>
                      </div>
                      <div className="space-y-4">
                            <FormField
                              control={form.control}
                              name="noCodeEndpointUrl"
                              render={({ field }) => (
                                <FormItem className="grid grid-cols-[200px_1fr] gap-4 items-start">
                                  <FormLabel className="pt-2.5 text-sm font-medium">URL сценария</FormLabel>
                                  <div className="space-y-2">
                                    <FormControl>
                                      <Input
                                        {...field}
                                        placeholder="https://example.com/no-code"
                                        disabled={noCodeDisabled}
                                        data-testid="skill-no-code-endpoint-input"
                                        className="h-9"
                                      />
                                    </FormControl>
                                    <FormDescription className="text-xs text-muted-foreground leading-tight">
                                      {noCodeDisabled
                                        ? "Доступно только на премиум-тарифе."
                                        : "Сюда будет приходить запрос, когда выбранно выполнение в no-code режиме."}
                                    </FormDescription>
                                    <FormMessage className="text-xs text-destructive leading-tight" />
                                  </div>
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={form.control}
                              name="noCodeFileStorageProviderId"
                              render={({ field }) => (
                                <FormItem className="grid grid-cols-[200px_1fr] gap-4 items-start">
                                  <FormLabel className="pt-2.5 text-sm font-medium">File Storage Provider</FormLabel>
                                  <div className="space-y-2">
                                    <Select
                                      value={field.value ?? WORKSPACE_DEFAULT_PROVIDER_VALUE}
                                      onValueChange={noCodeDisabled ? undefined : field.onChange}
                                      disabled={noCodeDisabled || isFileStorageProvidersLoading}
                                    >
                                      <FormControl>
                                        <SelectTrigger className="h-9">
                                          <SelectValue placeholder="Выберите провайдера" />
                                        </SelectTrigger>
                                      </FormControl>
                                      <SelectContent>
                                        <SelectItem value={WORKSPACE_DEFAULT_PROVIDER_VALUE}>
                                          {workspaceDefaultProvider
                                            ? `Использовать дефолт воркспейса (${workspaceDefaultProvider.name})`
                                            : "Использовать дефолт воркспейса (не задан)"}
                                        </SelectItem>
                                        {fileStorageProviders.map((provider) => (
                                          <SelectItem key={provider.id} value={provider.id}>
                                            {provider.name} · {provider.authType === "bearer" ? "Bearer" : "Без авторизации"}
                                          </SelectItem>
                                        ))}
                                        {providerNotFound ? (
                                          <SelectItem value={providerNotFound}>
                                            Неизвестный провайдер ({providerNotFound})
                                          </SelectItem>
                                        ) : null}
                                      </SelectContent>
                                    </Select>
                                    <FormDescription className="text-xs text-muted-foreground leading-tight">
                                      Выберите провайдера хранения файлов или оставьте дефолт воркспейса.
                                    </FormDescription>
                                    <FormMessage className="text-xs text-destructive leading-tight" />
                                    {isFileStorageProvidersLoading ? (
                                      <p className="text-xs text-muted-foreground">Загружаем провайдеры…</p>
                                    ) : null}
                                    {fileStorageProvidersError ? (
                                      <p className="text-xs text-destructive">{fileStorageProvidersError.message}</p>
                                    ) : null}
                                    {providerNotFound && !isFileStorageProvidersLoading ? (
                                      <Alert variant="destructive">
                                        <AlertTitle>Сохранённый провайдер недоступен</AlertTitle>
                                        <AlertDescription>
                                          Выберите активный провайдер или дефолт воркспейса, чтобы продолжить.
                                        </AlertDescription>
                                      </Alert>
                                    ) : null}
                                    {effectiveProvider ? (
                                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                        <Badge variant="secondary" className="text-[10px] uppercase">
                                          {effectiveProviderSource === "workspace_default" ? "Дефолт воркспейса" : "Выбран в навыке"}
                                        </Badge>
                                        <span>
                                          {effectiveProvider.name} · {effectiveProvider.authType === "bearer" ? "Bearer" : "Без авторизации"}
                                        </span>
                                      </div>
                                    ) : null}
                                    {effectiveProviderSource === "none" && !isFileStorageProvidersLoading ? (
                                      <Alert variant="destructive">
                                        <AlertTitle>Нет активного провайдера</AlertTitle>
                                        <AlertDescription>
                                          Воркспейс не имеет дефолта, выберите провайдера вручную.
                                        </AlertDescription>
                                      </Alert>
                                    ) : null}
                                  </div>
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={form.control}
                              name="noCodeAuthType"
                              render={() => (
                                <FormItem>
                                  <FormLabel>Авторизация</FormLabel>
                                  <FormDescription className="text-xs text-muted-foreground leading-tight">
                                    Тип авторизации определяется выбранным файловым провайдером.
                                  </FormDescription>
                                  <FormControl>
                                    <RadioGroup
                                      value={noCodeAuthType}
                                      onValueChange={() => undefined}
                                      className="grid gap-3 md:grid-cols-2"
                                      disabled
                                    >
                                      <label className="relative cursor-pointer rounded-lg border border-border bg-background px-4 py-4 transition-colors hover:bg-accent/40">
                                        <RadioGroupItem
                                          value="none"
                                          className="peer sr-only"
                                          disabled
                                          data-testid="no-code-auth-none"
                                        />
                                        <div className="flex items-start gap-3">
                                          <div className="h-4 w-4 rounded-full border border-muted peer-checked:border-primary peer-checked:bg-primary" aria-hidden="true" />
                                          <div>
                                            <p className="text-sm font-medium">Без авторизации</p>
                                            <p className="text-xs text-muted-foreground">Провайдер не требует токен.</p>
                                          </div>
                                        </div>
                                        <div className="pointer-events-none absolute inset-0 rounded-lg border border-transparent peer-checked:border-primary peer-checked:bg-accent/40" />
                                      </label>
                                      <label className="relative cursor-pointer rounded-lg border border-border bg-background px-4 py-4 transition-colors hover:bg-accent/40">
                                        <RadioGroupItem
                                          value="bearer"
                                          className="peer sr-only"
                                          disabled
                                          data-testid="no-code-auth-bearer"
                                        />
                                        <div className="flex items-start gap-3">
                                          <div className="h-4 w-4 rounded-full border border-muted peer-checked:border-primary peer-checked:bg-primary" aria-hidden="true" />
                                          <div>
                                            <p className="text-sm font-medium">Bearer token</p>
                                            <p className="text-xs text-muted-foreground">Требуется провайдером, передаём в Authorization.</p>
                                          </div>
                                        </div>
                                        <div className="pointer-events-none absolute inset-0 rounded-lg border border-transparent peer-checked:border-primary peer-checked:bg-accent/40" />
                                      </label>
                                    </RadioGroup>
                                  </FormControl>
                                </FormItem>
                              )}
                            />
                            {isBearerProvider && (
                              <FormField
                                control={form.control}
                                name="noCodeBearerToken"
                                render={({ field }) => (
                                  <FormItem className="grid gap-2">
                                    <div className="flex items-center justify-between gap-3">
                                      <div className="space-y-1">
                                        <FormLabel>Bearer токен</FormLabel>
                                        <p className="text-xs text-muted-foreground">Токен хранится на уровне навыка и не отображается после сохранения.</p>
                                      </div>
                                      <Badge variant={storedNoCodeTokenIsSet ? "default" : "outline"}>
                                        {storedNoCodeTokenIsSet ? "Задан" : "Не задан"}
                                      </Badge>
                                    </div>
                                    {isClearingBearerToken && storedNoCodeTokenIsSet ? (
                                      <Alert variant="destructive">
                                        <AlertTitle>Токен будет очищен</AlertTitle>
                                        <AlertDescription>Сохраните изменения, чтобы удалить токен.</AlertDescription>
                                      </Alert>
                                    ) : null}
                                    {isReplacingBearerToken && (
                                      <div className="grid gap-1.5">
                                        <FormControl>
                                          <Input
                                            {...field}
                                            type="password"
                                            placeholder="Введите токен"
                                            disabled={noCodeDisabled}
                                            autoComplete="off"
                                            data-testid="skill-no-code-token-input"
                                            className="h-9"
                                          />
                                        </FormControl>
                                        <FormDescription className="text-xs text-muted-foreground leading-tight">
                                          {storedNoCodeTokenIsSet
                                            ? hasBearerTokenDraft
                                              ? "После сохранения токен будет заменён."
                                              : "Токен задан. Введите новый, чтобы заменить."
                                            : "Токен будет сохранён и скрыт после сохранения."}
                                        </FormDescription>
                                        <FormMessage className="text-xs text-destructive leading-tight" />
                                      </div>
                                    )}
                                    {storedNoCodeTokenIsSet ? (
                                      <div className="flex flex-wrap items-center gap-2">
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          className="h-9"
                                          disabled={noCodeDisabled}
                                          onClick={handleReplaceBearerToken}
                                        >
                                          Заменить
                                        </Button>
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          className="h-9"
                                          disabled={noCodeDisabled}
                                          onClick={handleClearBearerToken}
                                        >
                                          Очистить
                                        </Button>
                                        {bearerTokenAction !== "keep" ? (
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-9"
                                            disabled={noCodeDisabled}
                                            onClick={handleCancelBearerTokenChange}
                                          >
                                            Отмена
                                          </Button>
                                        ) : null}
                                      </div>
                                    ) : null}
                                  </FormItem>
                                )}
                              />
                            )}

                        <div className="rounded-lg border border-border bg-background/60 p-4 space-y-3">
                              <div className="flex items-center justify-between">
                                <p className="text-sm font-semibold">Callback-ссылка</p>
                                <Badge variant={callbackLink ? "default" : "outline"}>
                                  {callbackLink ? "Генерируется" : "Не создана"}
                                </Badge>
                              </div>
                              {callbackLink ? (
                                <div className="flex flex-wrap items-center gap-2">
                                  <Input
                                    value={callbackLink}
                                    readOnly
                                    className="flex-1 min-w-0 text-xs"
                                    data-testid="callback-link-input"
                                  />
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-9"
                                    disabled={!callbackLink}
                                    onClick={handleCopyCallbackLink}
                                  >
                                    <Copy className="mr-1 h-4 w-4" />
                                    Скопировать
                                  </Button>
                                </div>
                              ) : (
                                <p className="text-xs text-muted-foreground">
                                  Сохраните навык в режиме No-code, чтобы получить ссылку.
                                </p>
                              )}
                          <p className="text-xs text-muted-foreground">
                            Используйте ваш bearer token из профиля в заголовке <code className="text-xs bg-muted px-1 py-0.5 rounded">Authorization: Bearer &lt;ваш_token&gt;</code> для авторизации запросов.
                          </p>
                        </div>
                      </div>
                    </div>
                  </>
                ) : null}
              </fieldset>
              </div>
            </TabsContent>

            <TabsContent value="transcription" className="mx-auto w-full max-w-4xl px-4 py-4 md:px-6 md:py-6">
              <div className="space-y-8">
                <fieldset disabled={controlsDisabled} className="space-y-8">
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-base font-semibold text-foreground">Маршрут транскрибации</h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        Обработка файлов и транскрипций (не влияет на чат)
                      </p>
                    </div>
                    <div className="space-y-4">
                      <FormField
                        control={form.control}
                        name="transcriptionFlowMode"
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <RadioGroup
                                value={field.value}
                                onValueChange={controlsDisabled ? undefined : field.onChange}
                                className="grid gap-3 md:grid-cols-2"
                              >
                                <div className="rounded-lg border p-3">
                                  <label className="flex items-start gap-3 text-sm font-medium leading-tight">
                                    <RadioGroupItem
                                      value="standard"
                                      id="transcription-flow-standard"
                                      className="mt-1"
                                      disabled={controlsDisabled}
                                    />
                                    <span>
                                      Стандартный
                                      <span className="block text-xs font-normal text-muted-foreground">
                                        Используем текущий встроенный пайплайн транскрибации.
                                      </span>
                                    </span>
                                  </label>
                                </div>
                                <div className="rounded-lg border p-3">
                                  <label className="flex items-start gap-3 text-sm font-medium leading-tight">
                                    <RadioGroupItem
                                      value="no_code"
                                      id="transcription-flow-no-code"
                                      className="mt-1"
                                      disabled={controlsDisabled}
                                    />
                                    <span>
                                      Через no-code
                                      <span className="block text-xs font-normal text-muted-foreground">
                                        Отправляем событие в ваш no-code сценарий и ждём ответ оттуда.
                                      </span>
                                    </span>
                                  </label>
                                </div>
                              </RadioGroup>
                            </FormControl>
                            <FormMessage className="text-xs text-destructive leading-tight" />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>

                  {/* ASR Provider Selection (только для стандартного режима) */}
                  {!isTranscriptionNoCode && (
                    <div className="space-y-4">
                      <div>
                        <h3 className="text-base font-semibold text-foreground">ASR провайдер</h3>
                        <p className="text-sm text-muted-foreground mt-1">
                          Провайдер для распознавания речи
                        </p>
                      </div>
                      <FormField
                        control={form.control}
                        name="asrProviderId"
                        render={({ field }) => (
                          <FormItem className="grid grid-cols-[200px_1fr] gap-4 items-start">
                            <FormLabel className="pt-2.5 text-sm font-medium">Провайдер</FormLabel>
                            <div className="space-y-2">
                              <FormControl>
                                <Select
                                  value={field.value ?? ""}
                                  onValueChange={field.onChange}
                                  disabled={controlsDisabled}
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="Выберите ASR провайдер..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {asrProviders?.map((provider) => (
                                      <SelectItem key={provider.id} value={provider.id}>
                                        {provider.displayName} ({provider.asrProviderType})
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </FormControl>
                              <p className="text-sm text-muted-foreground">
                                Провайдер для распознавания речи. Обязателен для стандартного режима транскрибации.
                              </p>
                              <FormMessage className="text-xs text-destructive leading-tight" />
                            </div>
                          </FormItem>
                        )}
                      />
                    </div>
                  )}

                  {isTranscriptionNoCode ? (
                    <div className="space-y-4">
                      <div>
                        <h3 className="text-base font-semibold text-foreground">Callback для транскриптов</h3>
                        <p className="text-sm text-muted-foreground mt-1">
                          No-code сценарий для обработки транскриптов
                        </p>
                      </div>
                      <div className="space-y-3">
                        <div className="rounded-lg border border-border bg-background/60 p-4 space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-semibold">Callback-ссылка для транскриптов</p>
                            <Badge variant={transcriptCallbackLink ? "default" : "outline"}>
                              {transcriptCallbackLink ? "Генерируется" : "Не создана"}
                            </Badge>
                          </div>
                          {transcriptCallbackLink ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <Input value={transcriptCallbackLink} readOnly className="flex-1 min-w-0 text-xs" />
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-9"
                                disabled={!transcriptCallbackLink}
                                onClick={handleCopyTranscriptCallbackLink}
                              >
                                <Copy className="mr-1 h-4 w-4" />
                                Скопировать
                              </Button>
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              Сохраните навык в режиме No-code, чтобы получить ссылку.
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground">
                            Пример: POST /api/no-code/callback/transcripts с заголовком Authorization: Bearer &lt;ваш_token_из_профиля&gt; и JSON{" "}
                            {`{ "workspaceId": "...", "chatId": "...", "fullText": "...", "title": "...", "previewText": "..." }`}.
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="space-y-4">
                    <div>
                      <h3 className="text-base font-semibold text-foreground">Поведение при транскрибировании</h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        Сырая стенограмма или автозапуск действия
                      </p>
                    </div>
                    <div className="space-y-4">
                      <FormField
                        control={form.control}
                        name="onTranscriptionMode"
                        render={({ field }) => (
                          <FormItem className="grid grid-cols-[200px_1fr] gap-4 items-start">
                            <FormLabel className="pt-2.5 text-sm font-medium">Режим</FormLabel>
                            <div className="space-y-2">
                              <FormControl>
                                <RadioGroup
                                  value={field.value}
                                  onValueChange={controlsDisabled ? undefined : field.onChange}
                                  className="grid gap-3 md:grid-cols-2"
                                >
                                <div className="rounded-lg border p-3">
                                  <label className="flex items-start gap-3 text-sm font-medium leading-tight">
                                    <RadioGroupItem
                                      value="raw_only"
                                      id="transcription-mode-raw"
                                      className="mt-1"
                                      disabled={controlsDisabled}
                                    />
                                    <span>
                                      Только транскрипция
                                      <span className="block text-xs font-normal text-muted-foreground">
                                        Создаётся сырая стенограмма без дополнительных шагов.
                                      </span>
                                    </span>
                                  </label>
                                </div>
                                <div className="rounded-lg border p-3">
                                  <label className="flex items-start gap-3 text-sm font-medium leading-tight">
                                    <RadioGroupItem
                                      value="auto_action"
                                      id="transcription-mode-auto"
                                      className="mt-1"
                                      disabled={controlsDisabled}
                                    />
                                    <span>
                                      Транскрипция + авто-действие
                                      <span className="block text-xs font-normal text-muted-foreground">
                                        После получения стенограммы запускается выбранное действие.
                                      </span>
                                    </span>
                                  </label>
                                </div>
                                </RadioGroup>
                              </FormControl>
                              <FormMessage className="text-xs text-destructive leading-tight" />
                            </div>
                          </FormItem>
                        )}
                      />

                      {isAutoActionMode ? (
                        <FormField
                          control={form.control}
                          name="onTranscriptionAutoActionId"
                          render={({ field }) => (
                            <FormItem className="grid grid-cols-[200px_1fr] gap-4 items-start">
                              <FormLabel className="pt-2.5 text-sm font-medium">Действие для авто-запуска</FormLabel>
                              <div className="space-y-2">
                                {skill ? (
                                  <FormControl>
                                  <Select
                                    value={field.value ?? ""}
                                    onValueChange={field.onChange}
                                    disabled={controlsDisabled || transcriptActionsQuery.isLoading || transcriptActions.length === 0}
                                  >
                                    <SelectTrigger>
                                      <SelectValue
                                        placeholder={
                                          transcriptActionsQuery.isLoading
                                            ? "Загружаем действия..."
                                            : transcriptActions.length === 0
                                              ? "Нет включенных действий с целью «Стенограмма»"
                                              : "Выберите действие"
                                        }
                                      />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {transcriptActions.map((item) => (
                                        <SelectItem key={item.action.id} value={item.action.id}>
                                          {item.action.label}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </FormControl>
                              ) : (
                                <div className="rounded-md border border-dashed bg-slate-50 p-3 text-sm text-muted-foreground dark:border-slate-700 dark:bg-slate-900/40">
                                Доступно после сохранения навыка. Сначала создайте навык, затем выберите авто-действие.
                              </div>
                            )}
                              <FormDescription className="text-xs text-muted-foreground leading-tight">
                                Покажем превью обработанного результата и откроем вкладку действия при просмотре стенограммы.
                              </FormDescription>
                              <FormMessage className="text-xs text-destructive leading-tight" />
                            </div>
                          </FormItem>
                        )}
                      />
                    ) : null}
                    </div>
                  </div>
                </fieldset>
              </div>
            </TabsContent>

            <TabsContent value="actions" className="mx-auto w-full max-w-4xl px-4 py-4 md:px-6 md:py-6">
              <div className="space-y-8">
                <fieldset disabled={controlsDisabled}>
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-base font-semibold text-foreground">Настройка доступных действий и их отображения</h3>
                    </div>
                    <div>
                      {isSystemSkill ? (
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-muted-foreground dark:border-slate-700 dark:bg-slate-900/40">
                          Настройка действий недоступна для системных навыков.
                        </div>
                      ) : skill?.id ? (
                        <SkillActionsPreview 
                          skillId={skill.id} 
                          onChange={setSkillActionsChanges}
                          pendingChanges={skillActionsChanges}
                          autoActionId={form.watch("onTranscriptionAutoActionId") || skill?.onTranscriptionAutoActionId || null}
                        />
                      ) : (
                        <ActionsPreviewForNewSkill />
                      )}
                    </div>
                  </div>
                </fieldset>
              </div>
            </TabsContent>

            <TabsContent value="files" className="mx-auto w-full max-w-4xl px-4 py-4 md:px-6 md:py-6">
              {filesTabContent || (
                <div className="space-y-8">
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-base font-semibold text-foreground">Файлы навыка</h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        Загрузите документы для обучения навыка
                      </p>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">
                        {skill?.id ? "Файлы доступны после сохранения навыка" : "Сначала создайте навык"}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>

          {/* Sticky Footer - Always visible */}
          <div className="sticky bottom-0 z-20 border-t bg-background/95 backdrop-blur-sm">
            <div className="mx-auto w-full max-w-4xl px-4 py-3 md:px-6 md:py-4">
              <div className="flex items-center justify-between gap-4">
                <div className="text-sm text-muted-foreground">
                  {isDirty ? "Есть несохраненные изменения" : "Все изменения сохранены"}
                </div>
                <div className="flex gap-3">
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={handleReset} 
                    disabled={!isDirty || isSubmitting}
                  >
                    Отмена
                  </Button>
                  <Button
                    type="submit"
                    disabled={!isDirty || isSubmitting || isSystemSkill}
                    data-testid="save-button"
                  >
                    {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                    {isSystemSkill ? "Недоступно" : "Сохранить"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </form>
      </Form>
      <Dialog
        open={showCallbackTokenModal}
        onOpenChange={(open) => {
          if (open) {
            setShowCallbackTokenModal(true);
          } else {
            handleCloseCallbackTokenModal();
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>API-токен для входящих callback</DialogTitle>
            <DialogDescription>
              Токен показывается один раз. Сохраните его и передавайте в заголовке Authorization: Bearer.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border bg-muted px-3 py-2 font-mono text-sm break-all">
            {issuedCallbackToken ?? "—"}
          </div>
          <div className="flex items-center justify-between gap-3">
            {issuedCallbackTokenMeta.lastFour ? (
              <span className="text-xs text-muted-foreground">Окончание {issuedCallbackTokenMeta.lastFour}</span>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!issuedCallbackToken}
                onClick={handleCopyCallbackToken}
              >
                Скопировать
              </Button>
              <Button type="button" size="sm" onClick={handleCloseCallbackTokenModal}>
                Закрыть
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}


async function fetchKnowledgeBases(workspaceId: string): Promise<KnowledgeBaseSummary[]> {
  const response = await apiRequest("GET", "/api/knowledge/bases", undefined, undefined, { workspaceId });
  const data = await response.json();
  // Поддержка обоих форматов: массив или { bases: [...] }
  if (Array.isArray(data)) return data;
  if (data?.bases && Array.isArray(data.bases)) return data.bases;
  return [];
}

export default function SkillsPage() {
  const [, navigate] = useLocation();
  const openSkill = (url: string, e?: { metaKey?: boolean; ctrlKey?: boolean; button?: number }) => {
    const openInNewTab = Boolean(e?.metaKey || e?.ctrlKey || e?.button === 1);
    if (openInNewTab) {
      window.open(url, "_blank");
    } else {
      navigate(url);
    }
  };
  const { data: session } = useQuery<SessionResponse>({
    queryKey: ["/api/auth/session"],
  });
  const workspaceId = session?.workspace?.active?.id ?? session?.activeWorkspaceId ?? null;
  const {
    skills,
    isLoading: isSkillsLoading,
    isError,
    error,
    refetch: refetchSkills,
  } = useSkills({ workspaceId, enabled: Boolean(workspaceId) });
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
  const { toast } = useToast();
  const [archiveTarget, setArchiveTarget] = useState<Skill | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<"name" | "updatedAt">("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const knowledgeBaseMap = useMemo(() => {
    return new Map(knowledgeBases.map((kb) => [kb.id, kb]));
  }, [knowledgeBases]);

  const sortedSkills = useMemo(() => {
    // Фильтрация по поисковому запросу
    let filtered = skills.filter((skill) => {
      if (!searchQuery.trim()) return true;
      const query = searchQuery.toLowerCase();
      const name = skill.name?.toLowerCase() ?? "";
      const description = skill.description?.toLowerCase() ?? "";
      const id = skill.id.toLowerCase();
      return name.includes(query) || description.includes(query) || id.includes(query);
    });

    // Сортировка
    return [...filtered].sort((a, b) => {
      let aValue: string | number;
      let bValue: string | number;

      if (sortField === "name") {
        aValue = a.name?.toLowerCase() ?? "";
        bValue = b.name?.toLowerCase() ?? "";
      } else {
        aValue = new Date(a.updatedAt).getTime();
        bValue = new Date(b.updatedAt).getTime();
      }

      const comparison = typeof aValue === "string" 
        ? aValue.localeCompare(bValue as string, "ru")
        : aValue - (bValue as number);

      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [skills, searchQuery, sortField, sortDirection]);

  const llmOptions = useMemo<LlmSelectionOption[]>(() => {
    const options: LlmSelectionOption[] = [];
    const byProvider = catalogLlmModels.reduce<Record<string, typeof catalogLlmModels>>((acc, model) => {
      if (!model.providerId) return acc;
      acc[model.providerId] = acc[model.providerId] ?? [];
      acc[model.providerId].push(model);
      return acc;
    }, {});

    for (const provider of llmProviders) {
      const models = byProvider[provider.id] ?? [];
      for (const model of models) {
        const labelText = model.displayName;
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

  const llmOptionByKey = useMemo(() => {
    return new Map(llmOptions.map((option) => [option.key, option]));
  }, [llmOptions]);

  const dateFormatter = useMemo(() => {
    return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" });
  }, []);

  const creationDisabledReason = (() => {
    if (llmOptions.length === 0) {
      return "Подключите активного провайдера LLM с моделью из каталога.";
    }
    return null;
  })();

  const handleEditClick = (skill: Skill) => {
    if (skill.isSystem) {
      toast({
        title: "Системный навык",
        description:
          skill.systemKey === "UNICA_CHAT"
            ? "Настройки Unica Chat управляются администратором инстанса."
            : "Системные навыки нельзя изменять в рабочем пространстве.",
        variant: "destructive",
      });
      return;
    }
    navigate(`/skills/${skill.id}/edit`);
  };

  const handleArchiveSkill = async (skill: Skill) => {
    setArchiveTarget(skill);
  };

  const confirmArchiveSkill = async () => {
    if (!archiveTarget) return;
    setIsArchiving(true);
    try {
      if (!workspaceId) {
        throw new Error("Рабочее пространство не выбрано");
      }
      const response = await apiRequest(
        "DELETE",
        `/api/skills/${archiveTarget.id}`,
        { workspaceId },
        undefined,
        { workspaceId },
      );
      const payload = await response.json().catch(() => ({}));
      await refetchSkills();
      toast({
        title: "Навык архивирован",
        description:
          typeof payload?.archivedChats === "number"
            ? `В архив переведено чатов: ${payload.archivedChats}`
            : undefined,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось архивировать навык";
      toast({ title: "Ошибка", description: message, variant: "destructive" });
    } finally {
      setIsArchiving(false);
      setArchiveTarget(null);
    }
  };

  const renderKnowledgeBases = (skill: Skill) => {
    const ids = skill.knowledgeBaseIds ?? [];
    if (ids.length === 0) {
      return <span className="text-sm text-muted-foreground">Не выбрано</span>;
    }

    return (
      <div className="flex flex-wrap gap-1">
        {ids.map((id) => {
          const kb = knowledgeBaseMap.get(id);
          return (
            <Badge key={id} variant="secondary" className="text-xs">
              {kb ? kb.name : `#${id}`}
            </Badge>
          );
        })}
      </div>
    );
  };

  const renderLlmInfo = (skill: Skill) => {
    if (!skill.llmProviderConfigId || !skill.modelId) {
      return <span className="text-sm text-muted-foreground">Не задано</span>;
    }

    const key = buildLlmKey(skill.llmProviderConfigId, skill.modelId);
    const option = llmOptionByKey.get(key);
    const isActive = option ? option.providerIsActive : true;
    const label = option ? option.label : `${skill.llmProviderConfigId} · ${skill.modelId}`;

    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium leading-tight">{label}</p>
          {option && (
            <Badge variant="outline" className="uppercase tracking-wide">
              {costLevelLabel[option.costLevel]}
            </Badge>
          )}
        </div>
        {!isActive && <p className="text-xs text-muted-foreground">Провайдер отключён</p>}
      </div>
    );
  };

  const showLoadingState =
    isSkillsLoading ||
    knowledgeBaseQuery.isLoading ||
    isLlmLoading ||
    isEmbeddingProvidersLoading ||
    isModelsLoading;

  const getIconComponent = (iconName: string | null | undefined) => {
    const Icon = getSkillIcon(iconName);
    return Icon ? <Icon className="h-5 w-5" /> : null;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 px-6 pt-6">
        <h1 className="text-3xl font-semibold">Навыки ассистента</h1>
        <Button onClick={() => navigate("/skills/new")} disabled={Boolean(creationDisabledReason)}>
          <Plus />
          Создать навык
        </Button>
      </div>

      {(isError || knowledgeBaseQuery.error || llmError || modelsError || embeddingProvidersError) && (
        <Alert variant="destructive" className="mx-6">
          <AlertTitle>Не удалось загрузить данные</AlertTitle>
          <AlertDescription>
            {error?.message ||
              (knowledgeBaseQuery.error as Error | undefined)?.message ||
              (llmError as Error | undefined)?.message ||
              (modelsError as Error | undefined)?.message}
          </AlertDescription>
        </Alert>
      )}

      <div className="mx-6">
        {showLoadingState ? (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Загрузка данных...
          </div>
        ) : skills.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Пока нет ни одного навыка — создайте первый, чтобы ускорить ответы ассистента.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Поиск по навыкам..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="text-sm text-muted-foreground">
                {sortedSkills.length === skills.length
                  ? `Всего навыков: ${skills.length}`
                  : `Найдено: ${sortedSkills.length} из ${skills.length}`}
              </div>
            </div>
            
            <div className="rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[60px] text-center">Иконка</TableHead>
                    <TableHead className="w-[220px]">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="-ml-3 h-8 data-[state=open]:bg-accent"
                        onClick={() => {
                          if (sortField === "name") {
                            setSortDirection(sortDirection === "asc" ? "desc" : "asc");
                          } else {
                            setSortField("name");
                            setSortDirection("asc");
                          }
                        }}
                      >
                        Название
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                      </Button>
                    </TableHead>
                    <TableHead>Описание</TableHead>
                    <TableHead className="w-[200px]">Действия</TableHead>
                    <TableHead className="w-[220px]">Базы знаний</TableHead>
                    <TableHead className="w-[220px]">LLM модель</TableHead>
                    <TableHead className="w-[140px]">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="-ml-3 h-8 data-[state=open]:bg-accent"
                        onClick={() => {
                          if (sortField === "updatedAt") {
                            setSortDirection(sortDirection === "asc" ? "desc" : "asc");
                          } else {
                            setSortField("updatedAt");
                            setSortDirection("asc");
                          }
                        }}
                      >
                        Обновлено
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                      </Button>
                    </TableHead>
                    <TableHead className="w-[80px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedSkills.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="h-24 text-center">
                        <div className="text-sm text-muted-foreground">
                          {searchQuery ? (
                            <>
                              Ничего не найдено по запросу "<span className="font-medium">{searchQuery}</span>"
                            </>
                          ) : (
                            "Нет навыков"
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    sortedSkills.map((skill) => (
                    <TableRow
                      key={skill.id}
                      role="button"
                      tabIndex={0}
                      className="cursor-pointer hover:bg-muted/40 focus-visible:outline-none focus-visible:ring focus-visible:ring-primary/40"
                      onClick={(e) => openSkill(`/skills/${skill.id}/edit`, e)}
                      data-testid={`skill-row-${skill.id}`}
                      onMouseDown={(e) => {
                        if (e.button === 1 || e.ctrlKey || e.metaKey) {
                          e.preventDefault();
                          openSkill(`/skills/${skill.id}/edit`, e);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openSkill(`/skills/${skill.id}/edit`);
                        }
                      }}
                    >
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center">
                        {getIconComponent(skill.icon) ? (
                          getIconComponent(skill.icon)
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold leading-tight">{skill.name ?? "Без названия"}</p>
                          {skill.isSystem && (
                            <Badge variant="outline" className="text-[10px] uppercase">
                              Системный
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">ID: {skill.id}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      {skill.description ? (
                        <p className="text-sm text-muted-foreground line-clamp-3">{skill.description}</p>
                      ) : (
                        <span className="text-sm text-muted-foreground">Нет описания</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <SkillActionsInline skillId={skill.id} />
                    </TableCell>
                    <TableCell>{renderKnowledgeBases(skill)}</TableCell>
                    <TableCell>{renderLlmInfo(skill)}</TableCell>
                    <TableCell>
                      <p className="text-sm text-muted-foreground">
                        {dateFormatter.format(new Date(skill.updatedAt))}
                      </p>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {skill.status === "archived" && (
                          <Badge variant="secondary" className="text-[10px] uppercase">
                            Архив
                          </Badge>
                        )}
                        {!skill.isSystem && (
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              asChild
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                aria-label="Действия с навыком"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Ellipsis className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleEditClick(skill);
                                }}
                              >
                                <Pencil className="mr-2 h-4 w-4" />
                                Редактировать
                              </DropdownMenuItem>
                              {skill.status !== "archived" && (
                                <DropdownMenuItem
                                  className="text-red-600 focus:text-red-700"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleArchiveSkill(skill);
                                  }}
                                >
                                  Архивировать
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </TableCell>
                    </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>

      <Dialog open={Boolean(archiveTarget)} onOpenChange={(open) => !open && setArchiveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Архивировать навык?</DialogTitle>
            <DialogDescription>
              Навык будет помечен как архивный. Новые чаты с ним создать нельзя. Все связанные чаты перейдут в режим
              только чтения.
            </DialogDescription>
          </DialogHeader>
          <Separator />
          <div className="space-y-2 text-sm">
            <p className="font-semibold">{archiveTarget?.name ?? "Без названия"}</p>
            <p className="text-muted-foreground">ID: {archiveTarget?.id}</p>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => setArchiveTarget(null)} disabled={isArchiving}>
              Отмена
            </Button>
            <Button type="button" variant="destructive" onClick={confirmArchiveSkill} disabled={isArchiving}>
              {isArchiving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Архивировать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

