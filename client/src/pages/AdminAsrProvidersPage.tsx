import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

type AsrProvider = {
  id: string;
  displayName: string;
  asrProviderType: string;
  isEnabled: boolean;
  isDefaultAsr: boolean;
  status: string;
  config: {
    baseUrl?: string;
    workspaceId?: string;
    pollingIntervalMs?: number;
    timeoutMs?: number;
  };
  createdAt: string;
  updatedAt: string;
};

export default function AdminAsrProvidersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<AsrProvider | null>(null);
  const [newProvider, setNewProvider] = useState({
    displayName: "",
    baseUrl: "",
    workspaceId: "",
    pollingIntervalMs: 5000,
    timeoutMs: 3600000,
  });

  const { data: providers, isLoading } = useQuery({
    queryKey: ["admin-asr-providers"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/admin/tts-stt/asr-providers");
      const data = await response.json();
      return data.providers as AsrProvider[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof newProvider) => {
      const response = await apiRequest("POST", "/api/admin/tts-stt/asr-providers", {
        displayName: data.displayName,
        config: {
          baseUrl: data.baseUrl,
          workspaceId: data.workspaceId,
          pollingIntervalMs: data.pollingIntervalMs,
          timeoutMs: data.timeoutMs,
        },
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-asr-providers"] });
      setIsCreateDialogOpen(false);
      setNewProvider({
        displayName: "",
        baseUrl: "",
        workspaceId: "",
        pollingIntervalMs: 5000,
        timeoutMs: 3600000,
      });
      toast({
        title: "Провайдер создан",
        description: "Unica ASR провайдер успешно создан",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/admin/tts-stt/asr-providers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-asr-providers"] });
      toast({
        title: "Провайдер удален",
        description: "ASR провайдер успешно удален",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const toggleEnabledMutation = useMutation({
    mutationFn: async ({ id, isEnabled }: { id: string; isEnabled: boolean }) => {
      await apiRequest("PATCH", `/api/admin/tts-stt/asr-providers/${id}`, {
        isEnabled: !isEnabled,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-asr-providers"] });
    },
  });

  const toggleDefaultMutation = useMutation({
    mutationFn: async ({ id, nextIsDefaultAsr }: { id: string; nextIsDefaultAsr: boolean }) => {
      await apiRequest("PATCH", `/api/admin/tts-stt/asr-providers/${id}`, {
        isDefaultAsr: nextIsDefaultAsr,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-asr-providers"] });
      toast({
        title: "Провайдер по умолчанию обновлен",
        description: "Изменения сохранены",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { id: string; displayName: string; config: AsrProvider["config"] }) => {
      const response = await apiRequest("PATCH", `/api/admin/tts-stt/asr-providers/${data.id}`, {
        displayName: data.displayName,
        config: data.config,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-asr-providers"] });
      setEditingProvider(null);
      toast({
        title: "Провайдер обновлен",
        description: "Изменения сохранены",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="container mx-auto py-6">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">ASR Провайдеры</h1>
          <p className="text-muted-foreground mt-1">
            Управление провайдерами распознавания речи
          </p>
        </div>
        <Button onClick={() => setIsCreateDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Создать провайдер
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {providers?.map((provider) => (
          <Card key={provider.id}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-lg">{provider.displayName}</CardTitle>
                  <CardDescription className="mt-1">
                    {provider.asrProviderType}
                  </CardDescription>
                </div>
                <Badge variant={provider.isEnabled ? "default" : "secondary"}>
                  {provider.isEnabled ? "Активен" : "Отключен"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Base URL:</span>
                  <span className="font-mono text-xs">{provider.config.baseUrl}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Workspace:</span>
                  <span className="font-mono text-xs">{provider.config.workspaceId}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">По умолчанию:</span>
                  <Switch
                    checked={provider.isDefaultAsr}
                    onCheckedChange={(checked) =>
                      toggleDefaultMutation.mutate({ id: provider.id, nextIsDefaultAsr: checked })
                    }
                    disabled={toggleDefaultMutation.isPending}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => toggleEnabledMutation.mutate({ id: provider.id, isEnabled: provider.isEnabled })}
                >
                  {provider.isEnabled ? "Отключить" : "Включить"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditingProvider(provider)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    if (confirm("Вы уверены, что хотите удалить этот провайдер?")) {
                      deleteMutation.mutate(provider.id);
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Dialog для создания */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Создать Unica ASR провайдер</DialogTitle>
            <DialogDescription>
              Добавьте новый провайдер для распознавания речи
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="displayName">Название</Label>
              <Input
                id="displayName"
                value={newProvider.displayName}
                onChange={(e) => setNewProvider({ ...newProvider, displayName: e.target.value })}
                placeholder="Например: Unica ASR Dev"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="baseUrl">Base URL</Label>
              <Input
                id="baseUrl"
                value={newProvider.baseUrl}
                onChange={(e) => setNewProvider({ ...newProvider, baseUrl: e.target.value })}
                placeholder="https://aidev.hopper-it.ru/api"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="workspaceId">Workspace ID</Label>
              <Input
                id="workspaceId"
                value={newProvider.workspaceId}
                onChange={(e) => setNewProvider({ ...newProvider, workspaceId: e.target.value })}
                placeholder="GENERAL"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="pollingIntervalMs">Polling Interval (мс)</Label>
                <Input
                  id="pollingIntervalMs"
                  type="number"
                  value={newProvider.pollingIntervalMs}
                  onChange={(e) => setNewProvider({ ...newProvider, pollingIntervalMs: parseInt(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="timeoutMs">Timeout (мс)</Label>
                <Input
                  id="timeoutMs"
                  type="number"
                  value={newProvider.timeoutMs}
                  onChange={(e) => setNewProvider({ ...newProvider, timeoutMs: parseInt(e.target.value) })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={() => createMutation.mutate(newProvider)}
              disabled={!newProvider.displayName || !newProvider.baseUrl || !newProvider.workspaceId || createMutation.isPending}
            >
              {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Создать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog для редактирования */}
      {editingProvider && (
        <Dialog open={true} onOpenChange={() => setEditingProvider(null)}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Редактировать провайдер</DialogTitle>
              <DialogDescription>
                {editingProvider.displayName}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-displayName">Название</Label>
                <Input
                  id="edit-displayName"
                  value={editingProvider.displayName}
                  onChange={(e) => setEditingProvider({ ...editingProvider, displayName: e.target.value })}
                  placeholder="Например: Unica ASR Dev"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-baseUrl">Base URL</Label>
                <Input
                  id="edit-baseUrl"
                  value={editingProvider.config.baseUrl || ""}
                  onChange={(e) => setEditingProvider({
                    ...editingProvider,
                    config: { ...editingProvider.config, baseUrl: e.target.value }
                  })}
                  placeholder="https://aidev.hopper-it.ru/api"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-workspaceId">Workspace ID</Label>
                <Input
                  id="edit-workspaceId"
                  value={editingProvider.config.workspaceId || ""}
                  onChange={(e) => setEditingProvider({
                    ...editingProvider,
                    config: { ...editingProvider.config, workspaceId: e.target.value }
                  })}
                  placeholder="GENERAL"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-pollingIntervalMs">Polling Interval (мс)</Label>
                  <Input
                    id="edit-pollingIntervalMs"
                    type="number"
                    value={editingProvider.config.pollingIntervalMs || 5000}
                    onChange={(e) => setEditingProvider({
                      ...editingProvider,
                      config: { ...editingProvider.config, pollingIntervalMs: parseInt(e.target.value) }
                    })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-timeoutMs">Timeout (мс)</Label>
                  <Input
                    id="edit-timeoutMs"
                    type="number"
                    value={editingProvider.config.timeoutMs || 3600000}
                    onChange={(e) => setEditingProvider({
                      ...editingProvider,
                      config: { ...editingProvider.config, timeoutMs: parseInt(e.target.value) }
                    })}
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingProvider(null)}>
                Отмена
              </Button>
              <Button
                onClick={() => updateMutation.mutate({
                  id: editingProvider.id,
                  displayName: editingProvider.displayName,
                  config: editingProvider.config,
                })}
                disabled={!editingProvider.displayName || !editingProvider.config.baseUrl || !editingProvider.config.workspaceId || updateMutation.isPending}
              >
                {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Сохранить
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
