import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Loader2, Edit } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { centsToCredits, formatCredits, tryParseCreditsToCents } from "@shared/credits";

type TariffSummary = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  includedCreditsAmount?: number;
  includedCreditsPeriod?: string;
};

type TariffLimit = {
  limitKey: string;
  unit: string;
  limitValue: number | null;
  isEnabled: boolean;
};

type TariffDetail = {
  plan: TariffSummary;
  limits: TariffLimit[];
};

type LimitCatalogEntry = {
  limitKey: string;
  title: string;
  description?: string;
  defaultUnit: string;
  uiGroup: string;
  uiOrder: number;
};

type LimitFormState = Record<
  string,
  {
    unit: string;
    value: number | null;
    isEnabled: boolean;
  }
>;

async function fetchTariffs(): Promise<TariffSummary[]> {
  const res = await apiRequest("GET", "/api/admin/tariffs");
  const data = await res.json();
  return data.tariffs ?? [];
}

async function fetchTariffDetail(planId: string): Promise<TariffDetail> {
  const res = await apiRequest("GET", `/api/admin/tariffs/${planId}`);
  return res.json();
}

async function fetchLimitCatalog(): Promise<LimitCatalogEntry[]> {
  const res = await apiRequest("GET", "/api/admin/tariff-limit-catalog");
  const data = await res.json();
  return data.catalog ?? [];
}

function formatLimitValue(limitValue: number | null): string {
  if (limitValue === null) return "Без ограничений";
  return limitValue.toLocaleString();
}

function getLimitLabel(limitKey: string, catalog: LimitCatalogEntry[]): string {
  const entry = catalog.find((c) => c.limitKey === limitKey);
  return entry ? entry.title : `Custom: ${limitKey}`;
}

function getLimitGroup(limitKey: string, catalog: LimitCatalogEntry[]): string {
  const entry = catalog.find((c) => c.limitKey === limitKey);
  return entry?.uiGroup ?? "Other";
}

export default function AdminBillingPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [formLimits, setFormLimits] = useState<LimitFormState>({});
  const [isSaving, setIsSaving] = useState(false);
  const [creditsAmount, setCreditsAmount] = useState<string>("0.00");

  const tariffsQuery = useQuery({
    queryKey: ["admin", "tariffs"],
    queryFn: fetchTariffs,
  });

  const limitCatalogQuery = useQuery({
    queryKey: ["admin", "tariff-limit-catalog"],
    queryFn: fetchLimitCatalog,
  });

  const detailQuery = useQuery({
    queryKey: ["admin", "tariff-detail", selectedPlanId],
    queryFn: () => fetchTariffDetail(selectedPlanId!),
    enabled: Boolean(selectedPlanId),
  });

  useEffect(() => {
    if (detailQuery.data?.limits) {
      const next: LimitFormState = {};
      detailQuery.data.limits.forEach((lim) => {
        next[lim.limitKey] = {
          unit: lim.unit,
          value: lim.limitValue,
          isEnabled: lim.isEnabled,
        };
      });
      setFormLimits(next);
    }
    if (detailQuery.data?.plan) {
      const amount = detailQuery.data.plan.includedCreditsAmount ?? 0;
      setCreditsAmount(formatCredits(amount));
    }
  }, [detailQuery.data]);

  const catalog = limitCatalogQuery.data ?? [];

  const groupedLimits = useMemo(() => {
    const limits = detailQuery.data?.limits ?? [];
    const groups = new Map<string, TariffLimit[]>();
    limits.forEach((lim) => {
      const group = getLimitGroup(lim.limitKey, catalog);
      if (!groups.has(group)) {
        groups.set(group, []);
      }
      groups.get(group)!.push(lim);
    });
    for (const list of groups.values()) {
      list.sort((a, b) => {
        const orderA = catalog.find((c) => c.limitKey === a.limitKey)?.uiOrder ?? 999;
        const orderB = catalog.find((c) => c.limitKey === b.limitKey)?.uiOrder ?? 999;
        return orderA - orderB;
      });
    }
    return groups;
  }, [catalog, detailQuery.data?.limits]);

  const handleLimitValueChange = (limitKey: string, value: number | null) => {
    setFormLimits((prev) => ({
      ...prev,
      [limitKey]: {
        ...(prev[limitKey] ?? { unit: "count", isEnabled: true, value: null }),
        value,
      },
    }));
  };

  const handleLimitEnabledChange = (limitKey: string, isEnabled: boolean) => {
    setFormLimits((prev) => ({
      ...prev,
      [limitKey]: {
        ...(prev[limitKey] ?? { unit: "count", value: null }),
        isEnabled,
      },
    }));
  };

  const handleLimitUnit = (limitKey: string, unit: string) => {
    setFormLimits((prev) => ({
      ...prev,
      [limitKey]: {
        ...(prev[limitKey] ?? { value: null, isEnabled: true }),
        unit,
      },
    }));
  };

  const saveLimits = async () => {
    if (!selectedPlanId) return;
    setIsSaving(true);
    try {
      const creditsAmountCents = tryParseCreditsToCents(creditsAmount);
      if (creditsAmountCents === null || creditsAmountCents < 0) {
        toast({ variant: "destructive", title: "Ошибка", description: "Укажите корректное число кредитов (>= 0)" });
        return;
      }

      await apiRequest("PUT", `/api/admin/tariffs/${selectedPlanId}`, {
        includedCreditsAmount: creditsAmount,
        includedCreditsPeriod: "monthly",
      });
      const limitsPayload = Object.entries(formLimits).map(([limitKey, data]) => ({
        limitKey,
        unit: data.unit,
        limitValue: data.value,
        isEnabled: data.isEnabled,
      }));
      await apiRequest("PUT", `/api/admin/tariffs/${selectedPlanId}/limits`, { limits: limitsPayload });
      toast({ title: "Сохранено", description: "Лимиты тарифа обновлены" });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin", "tariff-detail", selectedPlanId] }),
        queryClient.invalidateQueries({ queryKey: ["admin", "tariffs"] }),
      ]);
      setSelectedPlanId(null);
    } catch (error: any) {
      toast({ variant: "destructive", title: "Ошибка сохранения", description: error?.message ?? "Не удалось сохранить" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="h-4 w-4" />
          <span>Админка · Биллинг</span>
        </div>
        <h1 className="text-2xl font-semibold">Биллинг</h1>
        <p className="text-sm text-muted-foreground">Управление тарифами и лимитами.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Разделы биллинга</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="tariffs">
            <TabsList>
              <TabsTrigger value="tariffs">Тарифы</TabsTrigger>
              <TabsTrigger value="usage" disabled>
                Usage (скоро)
              </TabsTrigger>
            </TabsList>
            <TabsContent value="tariffs" className="pt-4 space-y-3">
              {tariffsQuery.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Загружаем тарифы...</span>
                </div>
              ) : tariffsQuery.isError ? (
                <div className="text-sm text-destructive">Не удалось загрузить тарифы</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Название</TableHead>
                      <TableHead>Код</TableHead>
                      <TableHead>Статус</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(tariffsQuery.data ?? []).map((plan) => (
                      <TableRow key={plan.id}>
                        <TableCell>
                          <div className="font-medium">{plan.name}</div>
                          <div className="text-xs text-muted-foreground">{plan.description}</div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{plan.code}</TableCell>
                        <TableCell>
                          {plan.isActive ? (
                            <Badge variant="secondary">Активен</Badge>
                          ) : (
                            <Badge variant="outline">Отключен</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSelectedPlanId(plan.id)}
                            className="inline-flex items-center gap-2"
                          >
                            <Edit className="h-4 w-4" />
                            Редактировать
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>
            <TabsContent value="usage" className="pt-4">
              <p className="text-sm text-muted-foreground">Раздел появится в следующих итерациях.</p>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={Boolean(selectedPlanId)} onOpenChange={(open) => !open && setSelectedPlanId(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Лимиты тарифа</DialogTitle>
          </DialogHeader>
          {detailQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Загружаем тариф...</span>
            </div>
          ) : detailQuery.isError ? (
            <div className="text-sm text-destructive">Не удалось загрузить тариф</div>
          ) : detailQuery.data ? (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium">{detailQuery.data.plan.name}</p>
                <p className="text-xs text-muted-foreground">{detailQuery.data.plan.code}</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 rounded-lg border p-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Кредиты по подписке (в месяц)</Label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={creditsAmount}
                    onChange={(e) => setCreditsAmount(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Пользователь увидит это как ежемесячный бюджет кредитов по тарифу.
                  </p>
                </div>
                <div className="flex flex-col justify-center rounded-md border bg-muted/50 p-3 text-sm">
                  <p className="font-medium">Превью для пользователя</p>
                  <p className="text-muted-foreground">
                    Включено в план:{" "}
                    {(() => {
                      const cents = tryParseCreditsToCents(creditsAmount);
                      return cents === null ? "—" : formatCredits(centsToCredits(cents));
                    })()}{" "}
                    кредит(ов) / месяц
                  </p>
                  <p className="text-xs text-muted-foreground">Период: ежемесячно</p>
                </div>
              </div>
              <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
                {Array.from(groupedLimits.entries()).map(([group, limits]) => (
                  <Card key={group}>
                    <CardHeader>
                      <CardTitle className="text-base">{group}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {limits.map((limit) => {
                        const current = formLimits[limit.limitKey] ?? {
                          unit: limit.unit,
                          value: limit.limitValue,
                          isEnabled: limit.isEnabled,
                        };
                        const isUnlimited = current.value === null;
                        return (
                          <div key={limit.limitKey} className="rounded-lg border p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="space-y-1">
                                <p className="font-medium">
                                  {getLimitLabel(limit.limitKey, catalog)}{" "}
                                  <span className="text-xs text-muted-foreground">({limit.limitKey})</span>
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {catalog.find((c) => c.limitKey === limit.limitKey)?.description ?? "Пользовательский лимит"}
                                </p>
                              </div>
                              <Switch
                                checked={current.isEnabled}
                                onCheckedChange={(v) => handleLimitEnabledChange(limit.limitKey, v)}
                              />
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="w-1/3">
                                <Label className="text-xs text-muted-foreground">Значение</Label>
                                <Input
                                  type="number"
                                  min={0}
                                  disabled={!current.isEnabled || isUnlimited}
                                  value={current.value === null ? "" : current.value}
                                  onChange={(e) =>
                                    handleLimitValueChange(
                                      limit.limitKey,
                                      e.target.value === "" ? null : Math.max(0, Number(e.target.value)),
                                    )
                                  }
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Единицы</Label>
                                <Badge variant="outline" className="font-mono">
                                  {current.unit}
                                </Badge>
                              </div>
                              <div className="flex items-center gap-2">
                                <Checkbox
                                  id={`unlimited-${limit.limitKey}`}
                                  checked={isUnlimited}
                                  onCheckedChange={(v) => handleLimitValueChange(limit.limitKey, v ? null : 0)}
                                  disabled={!current.isEnabled}
                                />
                                <Label htmlFor={`unlimited-${limit.limitKey}`} className="text-sm">
                                  Без ограничений
                                </Label>
                              </div>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Текущее значение: {formatLimitValue(current.value)}
                            </div>
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setSelectedPlanId(null)}>
                  Отмена
                </Button>
                <Button onClick={saveLimits} disabled={isSaving}>
                  {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Сохранить
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
