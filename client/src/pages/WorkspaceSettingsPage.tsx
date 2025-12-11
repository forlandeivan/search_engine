import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import WorkspaceMembersPage from "@/pages/WorkspaceMembersPage";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import type { SessionResponse } from "@/types/session";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { WorkspaceIcon } from "@/components/WorkspaceIcon";
import { useToast } from "@/hooks/use-toast";

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

export default function WorkspaceSettingsPage({ params }: { params?: { workspaceId?: string } }) {
  const [location, navigate] = useLocation();
  const workspaceIdFromRoute = params?.workspaceId ?? undefined;
  const sessionWorkspaceQuery = useWorkspaceInfo(workspaceId);
  const { toast } = useToast();

  const workspaceName = useMemo(() => {
    const active = sessionWorkspaceQuery.data;
    return active?.name ?? "Рабочее пространство";
  }, [sessionWorkspaceQuery.data]);

  const urlSearchParams = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const initialTab = (urlSearchParams.get("tab") ?? "general") as "general" | "members";
  const [tab, setTab] = useState<"general" | "members">(initialTab === "members" ? "members" : "general");

  useEffect(() => {
    const params = new URLSearchParams(location.split("?")[1] ?? "");
    const tabParam = params.get("tab");
    if (tabParam === "members" || tabParam === "general") {
      setTab(tabParam);
    }
  }, [location]);

  const handleTabChange = (value: string) => {
    const next = value === "members" ? "members" : "general";
    setTab(next);
    const base = location.split("?")[0];
    navigate(`${base}?tab=${next}`);
  };

  const [name, setName] = useState(workspaceName);
  const [description, setDescription] = useState("");
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [resetIcon, setResetIcon] = useState(false);
  const effectiveWorkspaceId = workspaceIdFromRoute ?? sessionWorkspaceQuery.data?.id ?? null;

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
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Рабочее пространство</h1>
        <p className="text-sm text-muted-foreground">{workspaceName}</p>
      </div>

      <Tabs value={tab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="general">Основное</TabsTrigger>
          <TabsTrigger value="members">Участники</TabsTrigger>
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
                  <Button onClick={handleSave}>Сохранить</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="members" className="mt-4">
          <WorkspaceMembersPage />
        </TabsContent>
      </Tabs>
    </div>
  );
}
