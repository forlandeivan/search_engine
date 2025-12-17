import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

type UsageChargeItem = {
  id: string;
  operationId: string | null;
  workspaceId: string;
  occurredAt: string;
  model: {
    id: string | null;
    key: string | null;
    displayName: string | null;
    modelType: string | null;
    consumptionUnit: string | null;
  } | null;
  unit: string | null;
  quantityUnits: number | null;
  quantityRaw: number | null;
  appliedCreditsPerUnit: number | null;
  creditsCharged: number;
};

type UsageChargesResponse = {
  items: UsageChargeItem[];
  total: number;
  limit: number;
  offset: number;
};

export default function AdminUsageChargesPage() {
  const chargesQuery = useQuery<UsageChargesResponse>({
    queryKey: ["/api/admin/usage/charges"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/usage/charges?limit=100");
      return (await res.json()) as UsageChargesResponse;
    },
  });

  const items = chargesQuery.data?.items ?? [];

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Журнал списаний</h1>
          <p className="text-sm text-muted-foreground">
            Дата, модель, единица потребления и списанные кредиты. Бесплатные модели отображаются с 0 кредитов.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Списания</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {chargesQuery.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Загрузка журнала...
            </div>
          ) : chargesQuery.isError ? (
            <div className="p-4 text-sm text-destructive">
              {(chargesQuery.error as Error)?.message ?? "Не удалось загрузить журнал"}
            </div>
          ) : items.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center">Записей пока нет</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Дата</TableHead>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Модель</TableHead>
                  <TableHead>Тип</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Количество</TableHead>
                  <TableHead>Credits</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="whitespace-nowrap">
                      {format(new Date(item.occurredAt), "yyyy-MM-dd HH:mm")}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{item.workspaceId}</TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span>{item.model?.displayName ?? item.model?.key ?? "—"}</span>
                        {item.model?.key && (
                          <span className="text-xs text-muted-foreground">key: {item.model.key}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{item.model?.modelType ?? "—"}</TableCell>
                    <TableCell>{item.unit ?? item.model?.consumptionUnit ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex flex-col text-sm">
                        <span>{item.quantityUnits ?? "—"}</span>
                        {item.quantityRaw !== null && item.quantityRaw !== undefined && (
                          <span className="text-xs text-muted-foreground">raw: {item.quantityRaw}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span>{item.creditsCharged}</span>
                        {item.creditsCharged === 0 && <Badge variant="outline">Бесплатная</Badge>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
