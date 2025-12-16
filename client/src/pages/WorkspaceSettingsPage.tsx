import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import WorkspaceMembersPage from "@/pages/WorkspaceMembersPage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import type { SessionResponse } from "@/types/session";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { WorkspaceIcon } from "@/components/WorkspaceIcon";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

function useWorkspaceInfo(workspaceId?: string | null) {
  return useQuery({
    queryKey: ["/api/auth/session"],
    queryFn: getQueryFn<SessionResponse>({ on401: "returnNull" }),
    staleTime: 60 * 1000,
    select: (data) =>
      data?.workspace.active && workspaceId && data.workspace.active.id === workspaceId
        ? data.workspace.active
        : data?.workspace.active,
  });
}

type WorkspaceUsageSummary = {
  workspaceId: string;
  period: { periodCode: string; periodYear: number; periodMonth: number; start: string; end: string };
  totalTokens: number;
  byModelTotal: Array<{ provider: string; model: string; tokens: number }>;
  timeseries: Array<{ provider: string; model: string; points: Array<{ date: string; tokens: number }> }>;
};
type WorkspaceAsrUsageSummary = {
  workspaceId: string;
  period: { periodCode: string; periodYear: number; periodMonth: number; start: string; end: string };
  totalMinutes: number;
  byProviderModelTotal: Array<{ provider: string | null; model: string | null; minutes: number }>;
  timeseries: Array<{ date: string; minutes: number }>;
  timeseriesByProviderModel: Array<{ provider: string | null; model: string | null; points: Array<{ date: string; minutes: number }> }>;
};
type WorkspaceStorageUsageSummary = {
  workspaceId: string;
  period: { periodCode: string; periodYear: number; periodMonth: number; start: string; end: string };
  storageBytes: number;
};
type WorkspaceObjectUsageSummary = {
  workspaceId: string;
  period: { periodCode: string; periodYear: number; periodMonth: number; start: string; end: string };
  skillsCount: number;
  actionsCount: number;
  knowledgeBasesCount: number;
  membersCount: number;
};
type WorkspaceQdrantUsageSummary = {
  workspaceId: string;
  collectionsCount: number;
  pointsCount: number;
  storageBytes: number;
};
type UsageResourceType = "llm" | "embeddings" | "asr" | "storage" | "objects" | "qdrant";

function formatPeriodLabel(periodCode: string): string {
  const [year, month] = periodCode.split("-");
  return `${month}.${year}`;
}

function buildPeriods(): string[] {
  const now = new Date();
  const periods: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    const dt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const year = dt.getUTCFullYear();
    const month = `${dt.getUTCMonth() + 1}`.padStart(2, "0");
    periods.push(`${year}-${month}`);
  }
  return periods;
}

function useWorkspaceLlmUsage(workspaceId: string | null, periodCode: string) {
  return useQuery<WorkspaceUsageSummary, Error>({
    queryKey: ["workspace-llm-usage", workspaceId, periodCode],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/workspaces/${workspaceId}/usage/llm${periodCode ? `?period=${periodCode}` : ""}`,
        undefined,
        undefined,
        { workspaceId: workspaceId ?? undefined },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Не удалось загрузить usage");
      }
      return (await res.json()) as WorkspaceUsageSummary;
    },
    staleTime: 30 * 1000,
  });
}

function useWorkspaceEmbeddingUsage(workspaceId: string | null, periodCode: string) {
  return useQuery<WorkspaceUsageSummary, Error>({
    queryKey: ["workspace-embedding-usage", workspaceId, periodCode],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/workspaces/${workspaceId}/usage/embeddings${periodCode ? `?period=${periodCode}` : ""}`,
        undefined,
        undefined,
        { workspaceId: workspaceId ?? undefined },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Не удалось загрузить usage");
      }
      return (await res.json()) as WorkspaceUsageSummary;
    },
    staleTime: 30 * 1000,
  });
}

function useWorkspaceAsrUsage(workspaceId: string | null, periodCode: string) {
  return useQuery<WorkspaceAsrUsageSummary, Error>({
    queryKey: ["workspace-asr-usage", workspaceId, periodCode],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/workspaces/${workspaceId}/usage/asr${periodCode ? `?period=${periodCode}` : ""}`,
        undefined,
        undefined,
        { workspaceId: workspaceId ?? undefined },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Не удалось загрузить usage");
      }
      return (await res.json()) as WorkspaceAsrUsageSummary;
    },
    staleTime: 30 * 1000,
  });
}

function useWorkspaceStorageUsage(workspaceId: string | null, periodCode: string) {
  return useQuery<WorkspaceStorageUsageSummary, Error>({
    queryKey: ["workspace-storage-usage", workspaceId, periodCode],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/workspaces/${workspaceId}/usage/storage${periodCode ? `?period=${periodCode}` : ""}`,
        undefined,
        undefined,
        { workspaceId: workspaceId ?? undefined },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Не удалось загрузить usage");
      }
      return (await res.json()) as WorkspaceStorageUsageSummary;
    },
    staleTime: 30 * 1000,
  });
}

function useWorkspaceObjectsUsage(workspaceId: string | null, periodCode: string) {
  return useQuery<WorkspaceObjectUsageSummary, Error>({
    queryKey: ["workspace-objects-usage", workspaceId, periodCode],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/workspaces/${workspaceId}/usage/objects${periodCode ? `?period=${periodCode}` : ""}`,
        undefined,
        undefined,
        { workspaceId: workspaceId ?? undefined },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Не удалось загрузить usage");
      }
      return (await res.json()) as WorkspaceObjectUsageSummary;
    },
    staleTime: 30 * 1000,
  });
}

function useWorkspaceQdrantUsage(workspaceId: string | null) {
  return useQuery<WorkspaceQdrantUsageSummary, Error>({
    queryKey: ["workspace-qdrant-usage", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/workspaces/${workspaceId}/usage/qdrant`,
        undefined,
        undefined,
        { workspaceId: workspaceId ?? undefined },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || body.error || "Не удалось загрузить usage");
      }
      return (await res.json()) as WorkspaceQdrantUsageSummary;
    },
    staleTime: 30 * 1000,
  });
}

export default function WorkspaceSettingsPage({ params }: { params?: { workspaceId?: string } }) {
  const [location, navigate] = useLocation();
  const workspaceIdFromRoute = params?.workspaceId ?? undefined;
  const sessionWorkspaceQuery = useWorkspaceInfo(workspaceIdFromRoute);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const workspaceName = useMemo(() => {
    const active = sessionWorkspaceQuery.data;
    return active?.name ?? "Рабочее пространство";
  }, [sessionWorkspaceQuery.data]);

  const urlSearchParams = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const initialTab = (urlSearchParams.get("tab") ?? "general") as "general" | "members" | "usage";
  const [tab, setTab] = useState<"general" | "members" | "usage">(
    initialTab === "members" || initialTab === "usage" ? initialTab : "general",
  );

  useEffect(() => {
    const params = new URLSearchParams(location.split("?")[1] ?? "");
    const tabParam = params.get("tab");
    if (tabParam === "members" || tabParam === "general" || tabParam === "usage") {
      setTab(tabParam);
    }
  }, [location]);

  const handleTabChange = (value: string) => {
    const next = value === "members" || value === "usage" ? value : "general";
    setTab(next);
    const base = location.split("?")[0];
    navigate(`${base}?tab=${next}`);
  };

  const [name, setName] = useState(workspaceName);
  const [description, setDescription] = useState("");
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [resetIcon, setResetIcon] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const effectiveWorkspaceId = workspaceIdFromRoute ?? sessionWorkspaceQuery.data?.id ?? null;
  const workspacePlanQuery = useQuery({
    queryKey: ["workspace-plan", effectiveWorkspaceId],
    enabled: Boolean(effectiveWorkspaceId),
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/workspaces/${effectiveWorkspaceId}/plan`,
        undefined,
        undefined,
        { workspaceId: effectiveWorkspaceId ?? undefined },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Не удалось загрузить тариф");
      }
      return (await res.json()) as { plan: { id: string; code: string; name: string; description?: string | null } };
    },
    staleTime: 60 * 1000,
  });
  const availablePeriods = useMemo(() => buildPeriods(), []);
  const [selectedPeriod, setSelectedPeriod] = useState<string>(availablePeriods[0]);
  const [usageType, setUsageType] = useState<UsageResourceType>("llm");
  const llmUsageQuery = useWorkspaceLlmUsage(effectiveWorkspaceId, selectedPeriod);
  const embeddingUsageQuery = useWorkspaceEmbeddingUsage(
    usageType === "embeddings" ? effectiveWorkspaceId : null,
    selectedPeriod,
  );
  const asrUsageQuery = useWorkspaceAsrUsage(usageType === "asr" ? effectiveWorkspaceId : null, selectedPeriod);
  const storageUsageQuery = useWorkspaceStorageUsage(
    usageType === "storage" ? effectiveWorkspaceId : null,
    selectedPeriod,
  );
  const objectsUsageQuery = useWorkspaceObjectsUsage(
    usageType === "objects" ? effectiveWorkspaceId : null,
    selectedPeriod,
  );
  const qdrantUsageQuery = useWorkspaceQdrantUsage(usageType === "qdrant" ? effectiveWorkspaceId : null);

  const usageQuery =
    usageType === "llm"
      ? llmUsageQuery
      : usageType === "embeddings"
        ? embeddingUsageQuery
        : usageType === "asr"
          ? asrUsageQuery
          : usageType === "storage"
            ? storageUsageQuery
            : usageType === "objects"
              ? objectsUsageQuery
              : qdrantUsageQuery;
  const isAsr = usageType === "asr";
  const isStorage = usageType === "storage";
  const isObjects = usageType === "objects";
  const isQdrant = usageType === "qdrant";
  const usageTitle =
    usageType === "llm"
      ? "Потребление LLM токенов"
      : usageType === "embeddings"
        ? "Потребление Embeddings токенов"
        : usageType === "asr"
          ? "Потребление ASR (минуты)"
          : usageType === "storage"
            ? "Потребление хранилища (Storage)"
            : usageType === "objects"
              ? "Потребление объектов (skills, actions, KB, участники)"
              : "Потребление Qdrant (коллекции/точки)";
  const usageDescription =
    usageType === "llm"
      ? "Итоги за выбранный месяц и разбивка по провайдерам/моделям. Источник: workspace usage ledger."
      : usageType === "embeddings"
        ? "Итоги за выбранный месяц и разбивка по провайдерам/моделям для эмбеддингов. Источник: workspace embedding usage ledger."
        : usageType === "asr"
          ? "Итоги за выбранный месяц по минутам транскрибации (ASR) и разбивка по провайдерам/моделям. Источник: workspace ASR usage ledger."
          : usageType === "storage"
            ? "Итоги за выбранный месяц по объёму хранилища. Источник: workspace storage usage."
            : usageType === "objects"
              ? "Текущее количество объектов в рабочем пространстве за выбранный период: навыки, действия, базы знаний и участники."
              : "Текущее состояние Qdrant по рабочему пространству: коллекции, точки, оценка занимаемого объёма.";

  useEffect(() => {
    setName(workspaceName);
    setIconPreview(sessionWorkspaceQuery.data?.iconUrl ?? null);
    setDescription(sessionWorkspaceQuery.data?.description ?? "");
  }, [workspaceName, sessionWorkspaceQuery.data?.iconUrl, sessionWorkspaceQuery.data?.description]);

  const handleFileSelect = (file: File | null) => {
    if (!file) return;
    const validTypes = ["image/png", "image/jpeg", "image/svg+xml"];
    if (!validTypes.includes(file.type)) {
      toast({
        title: "Неверный формат",
        description: "Допустимы только PNG, JPEG или SVG",
        variant: "destructive",
      });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast({
        title: "Слишком большой файл",
        description: "Размер иконки не должен превышать 2 МБ",
        variant: "destructive",
      });
      return;
    }
    setIconFile(file);
    setResetIcon(false);
    const reader = new FileReader();
    reader.onload = (e) => setIconPreview(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleResetIcon = () => {
    setIconFile(null);
    setIconPreview(null);
    setResetIcon(true);
  };

  const handleSave = async () => {
    if (!effectiveWorkspaceId) {
      toast({ title: "Нет рабочего пространства", variant: "destructive" });
      return;
    }

    setIsSaving(true);

    // Пока сервер не поддерживает изменение названия/описания, сохраняем только иконку.
    try {
      if (iconFile) {
        const formData = new FormData();
        formData.append("file", iconFile);
        const res = await fetch(`/api/workspaces/${effectiveWorkspaceId}/icon`, {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message || "Не удалось загрузить иконку");
        }
        const data = await res.json();
        setIconPreview(data.iconUrl ?? null);
        setIconFile(null);
        setResetIcon(false);
        queryClient.setQueryData(["/api/auth/session"], (prev: SessionResponse | null | undefined) => {
          if (!prev) return prev;
          const active = prev.workspace.active;
          const memberships = prev.workspace.memberships.map((m) =>
            m.id === active.id ? { ...m, iconUrl: data.iconUrl ?? null } : m
          );
          return {
            ...prev,
            workspace: {
              ...prev.workspace,
              active: { ...active, iconUrl: data.iconUrl ?? null },
              memberships,
            },
          };
        });
        toast({ title: "Иконка обновлена" });
      } else if (resetIcon) {
        const res = await apiRequest("DELETE", `/api/workspaces/${effectiveWorkspaceId}/icon`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message || "Не удалось сбросить иконку");
        }
        const data = await res.json();
        setIconPreview(data.iconUrl ?? null);
        setResetIcon(false);
        queryClient.setQueryData(["/api/auth/session"], (prev: SessionResponse | null | undefined) => {
          if (!prev) return prev;
          const active = prev.workspace.active;
          const memberships = prev.workspace.memberships.map((m) =>
            m.id === active.id ? { ...m, iconUrl: null } : m
          );
          return {
            ...prev,
            workspace: {
              ...prev.workspace,
              active: { ...active, iconUrl: null },
              memberships,
            },
          };
        });
        toast({ title: "Иконка сброшена" });
      } else {
        toast({ title: "Изменений нет" });
      }
    } catch (error) {
      toast({
        title: "Ошибка сохранения",
        description: error instanceof Error ? error.message : "Не удалось сохранить изменения",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Рабочее пространство</h1>
          {workspacePlanQuery.isLoading ? (
            <Skeleton className="h-6 w-28" />
          ) : workspacePlanQuery.isError ? (
            <Badge variant="outline">Тариф: неизвестно</Badge>
          ) : workspacePlanQuery.data?.plan ? (
            <Badge variant="secondary" className="text-sm font-medium">
              Тариф: {workspacePlanQuery.data.plan.name || workspacePlanQuery.data.plan.code}
            </Badge>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">{workspaceName}</p>
      </div>

      <Tabs value={tab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="general">Основное</TabsTrigger>
          <TabsTrigger value="members">Участники</TabsTrigger>
          <TabsTrigger value="usage">Потребление</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Основные настройки</CardTitle>
              <CardDescription>Настройте имя, описание и иконку рабочего пространства.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="workspace-name">Название рабочего пространства</Label>
                    <Input
                      id="workspace-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Введите название"
                      disabled
                    />
                    <p className="text-xs text-muted-foreground">
                      Переименование будет доступно после обновления бэкенда. Сейчас поле только для просмотра.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Владелец</Label>
                    <Input
                      value={
                        sessionWorkspaceQuery.data?.ownerFullName ||
                        sessionWorkspaceQuery.data?.ownerEmail ||
                        "—"
                      }
                      disabled
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="workspace-description">Описание</Label>
                  <Textarea
                    id="workspace-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Краткое описание рабочего пространства"
                    rows={4}
                    disabled
                  />
                  <p className="text-xs text-muted-foreground">
                    Редактирование описания будет добавлено позже. Сейчас поле только для просмотра.
                  </p>
                </div>

                <div className="space-y-3">
                  <Label>Иконка рабочего пространства</Label>
                  <div className="flex flex-col gap-3 md:flex-row md:items-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-md border bg-white shadow-sm">
                      <WorkspaceIcon iconUrl={iconPreview} size={48} />
                    </div>
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => document.getElementById("workspace-icon-input")?.click()}
                        >
                          Загрузить иконку
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={handleResetIcon}
                          disabled={!resetIcon && !iconFile && !sessionWorkspaceQuery.data?.iconUrl}
                        >
                          Сбросить
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Допустимые форматы: PNG, JPEG, SVG. Максимальный размер 2 МБ.
                      </p>
                      <input
                        id="workspace-icon-input"
                        type="file"
                        accept="image/png,image/jpeg,image/svg+xml"
                        className="hidden"
                        onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null)}
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button onClick={handleSave} disabled={isSaving || (!iconFile && !resetIcon)}>
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {isSaving ? "Сохраняем..." : "Сохранить"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="members" className="mt-4">
          <WorkspaceMembersPage />
        </TabsContent>

        <TabsContent value="usage" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>{usageTitle}</CardTitle>
              <CardDescription>{usageDescription}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-4">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Тип потребления</p>
                  <Select value={usageType} onValueChange={(value) => setUsageType(value as UsageResourceType)}>
                    <SelectTrigger className="w-40">
                      <SelectValue placeholder="Тип" />
                    </SelectTrigger>
                    <SelectContent>
                    <SelectItem value="llm">LLM</SelectItem>
                    <SelectItem value="embeddings">Embeddings</SelectItem>
                    <SelectItem value="asr">ASR</SelectItem>
                    <SelectItem value="storage">Storage</SelectItem>
                    <SelectItem value="objects">Объекты</SelectItem>
                    <SelectItem value="qdrant">Qdrant</SelectItem>
                  </SelectContent>
                </Select>
              </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Месяц</p>
                  <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
                    <SelectTrigger className="w-40">
                      <SelectValue placeholder="Период" />
                    </SelectTrigger>
                    <SelectContent>
                      {availablePeriods.map((period) => (
                        <SelectItem key={period} value={period}>
                          {formatPeriodLabel(period)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">
                    {isStorage
                      ? "Занято в хранилище"
                      : isAsr
                        ? "Итого минут"
                        : isObjects
                          ? "Итого объектов"
                          : isQdrant
                            ? "Коллекции / точки"
                            : "Итого токенов"}
                  </p>
                  {usageQuery.isLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Загрузка...
                    </div>
                  ) : (
                    <p className="text-2xl font-semibold">
                      {isStorage
                        ? (() => {
                            const bytes = (usageQuery.data as WorkspaceStorageUsageSummary | undefined)?.storageBytes ?? null;
                            if (bytes === null) return "—";
                            const gb = bytes / 1024 ** 3;
                            return `${gb.toLocaleString("ru-RU", {
                              minimumFractionDigits: 3,
                              maximumFractionDigits: 3,
                            })} GB`;
                          })()
                        : isAsr
                          ? (usageQuery.data as WorkspaceAsrUsageSummary | undefined)?.totalMinutes?.toLocaleString("ru-RU") ?? "—"
                          : isObjects
                            ? (() => {
                                const data = usageQuery.data as WorkspaceObjectUsageSummary | undefined;
                                if (!data) return "—";
                                const total =
                                  (data.skillsCount ?? 0) +
                                  (data.actionsCount ?? 0) +
                                  (data.knowledgeBasesCount ?? 0) +
                                  (data.membersCount ?? 0);
                                return total.toLocaleString("ru-RU");
                              })()
                            : isQdrant
                              ? (() => {
                                  const data = usageQuery.data as WorkspaceQdrantUsageSummary | undefined;
                                  if (!data) return "—";
                                  return `${data.collectionsCount.toLocaleString("ru-RU")} / ${data.pointsCount.toLocaleString("ru-RU")}`;
                                })()
                            : (usageQuery.data as WorkspaceUsageSummary | undefined)?.totalTokens?.toLocaleString("ru-RU") ?? "—"}
                    </p>
                  )}
                </div>
              </div>

              {usageQuery.isError && (
                <div className="text-sm text-destructive">Не удалось загрузить usage: {usageQuery.error?.message}</div>
              )}

              {!usageQuery.isLoading && !usageQuery.isError && !isAsr && !isStorage && !isObjects && !isQdrant && (
                <>
                  {(usageQuery.data as WorkspaceUsageSummary | undefined)?.byModelTotal?.length === 0 && (
                    <p className="text-sm text-muted-foreground">За выбранный период данных нет.</p>
                  )}

                  {(usageQuery.data as WorkspaceUsageSummary | undefined)?.byModelTotal &&
                    (usageQuery.data as WorkspaceUsageSummary).byModelTotal.length > 0 && (
                      <>
                        <div className="space-y-2">
                          <p className="text-sm font-medium">Разбивка по моделям</p>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Провайдер</TableHead>
                                <TableHead>Модель</TableHead>
                                <TableHead className="text-right">Токены</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {(usageQuery.data as WorkspaceUsageSummary).byModelTotal.map((row) => (
                                <TableRow key={`${row.provider}-${row.model}`}>
                                  <TableCell className="font-medium">{row.provider}</TableCell>
                                  <TableCell>{row.model}</TableCell>
                                  <TableCell className="text-right">{row.tokens.toLocaleString("ru-RU")}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>

                        <div className="space-y-2">
                          <p className="text-sm font-medium">Помесячная серия по дням</p>
                          <div className="grid gap-3 md:grid-cols-2">
                            {(usageQuery.data as WorkspaceUsageSummary).timeseries.map((series) => (
                              <div key={`${series.provider}-${series.model}`} className="rounded-md border p-3">
                                <p className="text-sm font-medium">
                                  {series.provider} · {series.model}
                                </p>
                                <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                                  {series.points.length === 0 && <p>Нет точек за период</p>}
                                  {series.points.map((p) => (
                                    <div key={`${series.provider}-${series.model}-${p.date}`} className="flex justify-between">
                                      <span>{p.date}</span>
                                      <span>{p.tokens.toLocaleString("ru-RU")}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                  )}
                </>
              )}

              {!usageQuery.isLoading && !usageQuery.isError && isObjects && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Значения берутся из агрегата usage за выбранный период и обновляются при CRUD-операциях над объектами.
                  </p>
                  <div className="grid gap-3 md:grid-cols-2">
                    {[
                      { label: "Навыки", value: (usageQuery.data as WorkspaceObjectUsageSummary | undefined)?.skillsCount ?? 0 },
                      { label: "Действия", value: (usageQuery.data as WorkspaceObjectUsageSummary | undefined)?.actionsCount ?? 0 },
                      {
                        label: "Базы знаний",
                        value: (usageQuery.data as WorkspaceObjectUsageSummary | undefined)?.knowledgeBasesCount ?? 0,
                      },
                      { label: "Участники", value: (usageQuery.data as WorkspaceObjectUsageSummary | undefined)?.membersCount ?? 0 },
                    ].map((item) => (
                      <div key={item.label} className="rounded-md border p-3">
                        <p className="text-sm text-muted-foreground">{item.label}</p>
                        <p className="text-2xl font-semibold">{item.value.toLocaleString("ru-RU")}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!usageQuery.isLoading && !usageQuery.isError && isQdrant && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Значения хранятся персистентно (без месячного сброса) и отражают текущее состояние коллекций Qdrant по рабочему пространству.
                  </p>
                  <div className="grid gap-3 md:grid-cols-3">
                    {[
                      { label: "Коллекции", value: (usageQuery.data as WorkspaceQdrantUsageSummary | undefined)?.collectionsCount ?? 0 },
                      { label: "Точки (points)", value: (usageQuery.data as WorkspaceQdrantUsageSummary | undefined)?.pointsCount ?? 0 },
                      {
                        label: "Объём (байт)",
                        value: (usageQuery.data as WorkspaceQdrantUsageSummary | undefined)?.storageBytes ?? 0,
                        format: (n: number) => n.toLocaleString("ru-RU"),
                      },
                    ].map((item) => (
                      <div key={item.label} className="rounded-md border p-3">
                        <p className="text-sm text-muted-foreground">{item.label}</p>
                        <p className="text-2xl font-semibold">
                          {item.format ? item.format(item.value) : item.value.toLocaleString("ru-RU")}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!usageQuery.isLoading && !usageQuery.isError && isAsr && (
                <>
                  {(usageQuery.data as WorkspaceAsrUsageSummary | undefined)?.byProviderModelTotal?.length === 0 &&
                    (usageQuery.data as WorkspaceAsrUsageSummary | undefined)?.timeseries?.length === 0 && (
                      <p className="text-sm text-muted-foreground">За выбранный период данных нет.</p>
                    )}

                  {(usageQuery.data as WorkspaceAsrUsageSummary | undefined)?.byProviderModelTotal &&
                    (usageQuery.data as WorkspaceAsrUsageSummary).byProviderModelTotal.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-sm font-medium">Разбивка по провайдеру/модели</p>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Провайдер</TableHead>
                              <TableHead>Модель</TableHead>
                              <TableHead className="text-right">Минуты</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {(usageQuery.data as WorkspaceAsrUsageSummary).byProviderModelTotal.map((row, idx) => (
                              <TableRow key={`${row.provider ?? "unknown"}-${row.model ?? "unknown"}-${idx}`}>
                                <TableCell className="font-medium">{row.provider ?? "—"}</TableCell>
                                <TableCell>{row.model ?? "—"}</TableCell>
                                <TableCell className="text-right">{row.minutes.toLocaleString("ru-RU")}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}

                  {(((usageQuery.data as WorkspaceAsrUsageSummary | undefined)?.timeseries?.length ?? 0) > 0) && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Таймсерия по дням (все провайдеры)</p>
                      <div className="rounded-md border p-3">
                        <div className="space-y-1 text-sm text-muted-foreground">
                          {(usageQuery.data as WorkspaceAsrUsageSummary).timeseries.map((p) => (
                            <div key={p.date} className="flex justify-between">
                              <span>{p.date}</span>
                              <span>{p.minutes.toLocaleString("ru-RU")}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {(((usageQuery.data as WorkspaceAsrUsageSummary | undefined)?.timeseriesByProviderModel?.length ?? 0) > 0) && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Таймсерия по дням и моделям</p>
                      <div className="grid gap-3 md:grid-cols-2">
                        {(usageQuery.data as WorkspaceAsrUsageSummary).timeseriesByProviderModel.map((series, idx) => (
                          <div key={`${series.provider ?? "unknown"}-${series.model ?? "unknown"}-${idx}`} className="rounded-md border p-3">
                            <p className="text-sm font-medium">
                              {series.provider ?? "—"} · {series.model ?? "—"}
                            </p>
                            <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                              {series.points.length === 0 && <p>Нет точек за период</p>}
                              {series.points.map((p) => (
                                <div key={`${series.provider ?? "unknown"}-${series.model ?? "unknown"}-${p.date}`} className="flex justify-between">
                                  <span>{p.date}</span>
                                  <span>{p.minutes.toLocaleString("ru-RU")}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {!usageQuery.isLoading && !usageQuery.isError && isStorage && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Значение берётся из текущего периода storage usage и обновляется при upload/delete, плюс периодический
                    reconcile.
                  </p>
                  {((usageQuery.data as WorkspaceStorageUsageSummary | undefined)?.storageBytes ?? 0) === 0 && (
                    <p className="text-sm text-muted-foreground">За выбранный период данных нет.</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
