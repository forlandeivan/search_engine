import { Switch, Route, Link, useLocation } from "wouter";
import { useEffect } from "react";
import { QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryClient, getQueryFn, apiRequest } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import AdminSidebar from "@/components/AdminSidebar";
import MainSidebar from "@/components/MainSidebar";
import ThemeToggle from "@/components/ThemeToggle";
import WorkspaceSwitcher from "@/components/WorkspaceSwitcher";
import ApiDocsPage from "@/pages/ApiDocsPage";
import VectorCollectionsPage from "@/pages/VectorCollectionsPage";
import VectorCollectionDetailPage from "@/pages/VectorCollectionDetailPage";
import VectorStorageSettingsPage from "@/pages/VectorStorageSettingsPage";
import EmbeddingServicesPage from "@/pages/EmbeddingServicesPage";
import LlmProvidersPage from "@/pages/LlmProvidersPage";
import LlmExecutionsPage from "@/pages/LlmExecutionsPage";
import AsrExecutionsPage from "@/pages/AsrExecutionsPage";
import TtsSttProvidersPage from "@/pages/TtsSttProvidersPage";
import SpeechProviderDetailsPage from "@/pages/SpeechProviderDetailsPage";
import AuthSettingsPage from "@/pages/AuthSettingsPage";
import AdminBillingPage from "@/pages/AdminBillingPage";
import KnowledgeBasePage from "@/pages/KnowledgeBasePage";
import DashboardPage from "@/pages/DashboardPage";
import AdminUsersPage from "@/pages/AdminUsersPage";
import AdminWorkspacesPage from "@/pages/AdminWorkspacesPage";
import AdminModelsPage from "@/pages/AdminModelsPage";
import AdminUsageChargesPage from "@/pages/AdminUsageChargesPage";
import GuardBlockEventsPage from "@/pages/GuardBlockEventsPage";
import SkillsPage from "@/pages/SkillsPage";
import ChatPage from "@/pages/ChatPage";
import NotFound from "@/pages/not-found";
import AuthPage from "@/pages/AuthPage";
import VerifyEmailPage from "@/pages/VerifyEmailPage";
import ProfilePage from "@/pages/ProfilePage";
import WorkspaceActionsPage from "@/pages/WorkspaceActionsPage";
import SmtpSettingsPage from "@/pages/SmtpSettingsPage";
import WorkspaceSettingsPage from "@/pages/WorkspaceSettingsPage";
import WorkspaceCreditsHistoryPage from "@/pages/WorkspaceCreditsHistoryPage";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { PublicUser } from "@shared/schema";
import type { SessionResponse, WorkspaceState } from "@/types/session";
import type { CSSProperties } from "react";

function AdminRouter() {
  return (
    <Switch>
      <Route path="/admin/workspaces" component={AdminWorkspacesPage} />
      <Route path="/admin/auth" component={AuthSettingsPage} />
      <Route path="/admin/embeddings" component={EmbeddingServicesPage} />
      <Route path="/admin/llm-executions/:executionId">
        {(params) => <LlmExecutionsPage selectedExecutionId={params.executionId} />}
      </Route>
      <Route path="/admin/llm-executions">
        <LlmExecutionsPage />
      </Route>
      <Route path="/admin/asr-executions/:executionId">
        {(params) => <AsrExecutionsPage key={params.executionId} />}
      </Route>
      <Route path="/admin/asr-executions">
        <AsrExecutionsPage />
      </Route>
      <Route path="/admin/llm" component={LlmProvidersPage} />
      <Route path="/admin/guard-blocks" component={GuardBlockEventsPage} />
      <Route path="/admin/tts-stt/providers/:providerId">
        {(params) => <SpeechProviderDetailsPage providerId={params.providerId} />}
      </Route>
      <Route path="/admin/tts-stt" component={TtsSttProvidersPage} />
      <Route path="/admin/models" component={AdminModelsPage} />
      <Route path="/admin/usage-charges" component={AdminUsageChargesPage} />
      <Route path="/admin/billing" component={AdminBillingPage} />
      <Route path="/admin/settings/smtp" component={SmtpSettingsPage} />
      <Route path="/admin/storage" component={VectorStorageSettingsPage} />
      <Route path="/admin/users" component={AdminUsersPage} />
      <Route path="/admin" component={AdminWorkspacesPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function MainRouter() {
  const Redirect = ({ to }: { to: string }) => {
    const [, navigate] = useLocation();
    useEffect(() => {
      navigate(to);
    }, [navigate, to]);
    return null;
  };

  return (
    <Switch>
      <Route path="/workspaces/:workspaceId/chat/:chatId" component={ChatPage} />
      <Route path="/workspaces/:workspaceId/chat" component={ChatPage} />
      <Route path="/knowledge/:knowledgeBaseId/node/:nodeId" component={KnowledgeBasePage} />
      <Route path="/knowledge/:knowledgeBaseId" component={KnowledgeBasePage} />
      <Route path="/knowledge" component={KnowledgeBasePage} />
      <Route path="/skills" component={SkillsPage} />
      <Route path="/workspaces/:workspaceId/actions" component={WorkspaceActionsPage} />
      <Route path="/workspaces/actions" component={WorkspaceActionsPage} />
      <Route path="/workspaces/:workspaceId/credits/history" component={WorkspaceCreditsHistoryPage} />
      <Route path="/workspaces/credits/history" component={WorkspaceCreditsHistoryPage} />
      <Route path="/workspaces/:workspaceId/settings" component={WorkspaceSettingsPage} />
      <Route path="/workspaces/settings" component={WorkspaceSettingsPage} />
      <Route path="/workspaces/:workspaceId/members">
        {(params) => <Redirect to={`/workspaces/${params.workspaceId}/settings?tab=members`} />}
      </Route>
      <Route path="/workspaces/members">
        <Redirect to="/workspaces/settings?tab=members" />
      </Route>
      <Route path="/vector/collections/:name" component={VectorCollectionDetailPage} />
      <Route path="/vector/collections" component={VectorCollectionsPage} />
      <Route path="/integrations/api" component={ApiDocsPage} />
      <Route path="/profile" component={ProfilePage} />
      <Route path="/" component={DashboardPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function UnauthorizedPage() {
  return (
    <div className="p-6 space-y-2">
      <h1 className="text-2xl font-semibold">Недостаточно прав</h1>
      <p className="text-muted-foreground">
        У вас нет доступа к административной панели. Обратитесь к администратору для получения прав.
      </p>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" />
      <p className="text-sm">Загрузка...</p>
    </div>
  );
}

function HeaderUserArea({ user }: { user: PublicUser }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/logout");
    },
    onSuccess: async () => {
      queryClient.setQueryData(["/api/auth/session"], null);
      queryClient.removeQueries({
        predicate: (query) => {
          const [key] = query.queryKey as [unknown, ...unknown[]];
          return key !== "/api/auth/session";
        },
      });
      toast({ title: "Вы вышли из системы" });
    },
    onError: (error: Error) => {
      toast({
        title: "Не удалось выйти",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="flex items-center gap-2">
      <Button asChild variant="ghost" size="sm" data-testid="button-open-profile">
        <Link href="/profile">Профиль</Link>
      </Button>
      <ThemeToggle />
      <Button
        size="sm"
        variant="outline"
        onClick={() => logoutMutation.mutate()}
        disabled={logoutMutation.isPending}
      >
        {logoutMutation.isPending ? "Выходим..." : "Выйти"}
      </Button>
    </div>
  );
}

function AdminAppShell({ user, workspace }: { user: PublicUser; workspace: WorkspaceState }) {
  const style = {
    // Ширина сайдбара: на десктопе до ~330px, на средних экранах ужимается (clamp)
    "--sidebar-width": "clamp(240px, 25vw, 330px)",
    "--sidebar-width-icon": "48px",
  } as CSSProperties;

  return (
    <SidebarProvider style={style}>
      <div className="flex h-screen w-full">
        <AdminSidebar user={user} />
        <div className="flex min-w-0 flex-col flex-1">
          <header className="flex items-center justify-between p-2 border-b gap-2">
            <div className="flex items-center gap-2">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
              <WorkspaceSwitcher workspace={workspace} />
            </div>
            <HeaderUserArea user={user} />
          </header>
          <main className="app-main flex-1 min-h-0 overflow-auto">
            <AdminRouter />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function MainAppShell({ user, workspace }: { user: PublicUser; workspace: WorkspaceState }) {
  const style = {
    // Ширина сайдбара: на десктопе до ~330px, на средних экранах ужимается (clamp)
    "--sidebar-width": "clamp(240px, 25vw, 330px)",
    "--sidebar-width-icon": "48px",
  } as CSSProperties;

  return (
    <SidebarProvider style={style}>
      <div className="flex h-screen w-full">
        <MainSidebar
          showAdminLink={user.role === "admin"}
          user={user}
          workspaceId={workspace.active?.id}
          iconUrl={workspace.active?.iconUrl}
        />
        <div className="flex min-w-0 flex-col flex-1">
          <header className="flex items-center justify-between p-2 border-b gap-2">
            <div className="flex items-center gap-2">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
              <WorkspaceSwitcher workspace={workspace} />
            </div>
            <HeaderUserArea user={user} />
          </header>
          <main className="app-main flex-1 min-h-0 overflow-auto">
            <MainRouter />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function AppContent() {
  const [location, setLocation] = useLocation();
  const sessionQuery = useQuery({
    queryKey: ["/api/auth/session"],
    queryFn: getQueryFn<SessionResponse>({ on401: "returnNull" }),
    staleTime: 0,
  });

  const session = sessionQuery.data;

  // Если уже авторизованы, но находитесь на /auth/*, отправляем на главную.
  useEffect(() => {
    if (session?.user && location.startsWith("/auth")) {
      setLocation("/");
    }
  }, [session?.user, location, setLocation]);

  if (sessionQuery.isLoading) {
    return <LoadingScreen />;
  }

  // Если уже авторизованы, но находитесь на /auth/*, отправляем на главную.
  if (!session || !session.user) {
    return (
      <Switch>
        <Route path="/auth/verify-email">
          <VerifyEmailPage />
        </Route>
        <Route>
          <AuthPage />
        </Route>
      </Switch>
    );
  }

  const { user, workspace } = session;

  return (
    <Switch>
      <Route path={/^\/admin(?:\/.*)?$/i}>
        {user.role === "admin" ? <AdminAppShell user={user} workspace={workspace} /> : <UnauthorizedPage />}
      </Route>
      <Route>
        <MainAppShell user={user} workspace={workspace} />
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppContent />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
