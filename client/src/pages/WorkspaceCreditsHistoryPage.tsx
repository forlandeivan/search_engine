import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";

type Params = { workspaceId?: string };

export default function WorkspaceCreditsHistoryPage({ params }: { params?: Params }) {
  const [, navigate] = useLocation();
  const workspaceId = params?.workspaceId;
  const backUrl = workspaceId ? `/workspaces/${workspaceId}/settings?tab=billing` : "/workspaces/settings?tab=billing";

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle>История кредитов</CardTitle>
          <CardDescription>Раздел появится в ближайших релизах.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Здесь будет отображаться детальная история начислений и списаний кредитов рабочего пространства.
          </p>
          <Button variant="outline" onClick={() => navigate(backUrl)}>
            Вернуться к тарифу
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
