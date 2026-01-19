console.log("[App.tsx] Starting imports...");

import { Switch, Route, Link, useLocation } from "wouter";
console.log("[App.tsx] wouter loaded");

import { useEffect, Suspense, lazy, useState, Component, type ReactNode, type ErrorInfo } from "react";
console.log("[App.tsx] react loaded");

import { QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
console.log("[App.tsx] react-query loaded");

import { queryClient, getQueryFn, apiRequest } from "./lib/queryClient";
console.log("[App.tsx] queryClient loaded");

import { Toaster } from "@/components/ui/toaster";
console.log("[App.tsx] Toaster loaded");

import { TooltipProvider } from "@/components/ui/tooltip";
console.log("[App.tsx] TooltipProvider loaded");

import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
console.log("[App.tsx] Sidebar loaded");

import AdminSidebar from "@/components/AdminSidebar";
console.log("[App.tsx] AdminSidebar loaded");

import MainSidebar from "@/components/MainSidebar";
console.log("[App.tsx] MainSidebar loaded");

import ThemeToggle from "@/components/ThemeToggle";
console.log("[App.tsx] ThemeToggle loaded");

import WorkspaceSwitcher from "@/components/WorkspaceSwitcher";
console.log("[App.tsx] WorkspaceSwitcher loaded");

import { Loader2 } from "lucide-react";
console.log("[App.tsx] lucide-react loaded");

import { Button } from "@/components/ui/button";
console.log("[App.tsx] Button loaded");

import { useToast } from "@/hooks/use-toast";
console.log("[App.tsx] useToast loaded");

import type { PublicUser } from "@shared/schema";
import type { SessionResponse, WorkspaceState } from "@/types/session";
import type { CSSProperties } from "react";
console.log("[App.tsx] All imports complete");

// ErrorBoundary для перехвата ошибок рендеринга и предотвращения белого экрана
interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("ErrorBoundary caught error:", error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6">
          <h1 className="text-xl font-semibold text-destructive">Произошла ошибка</h1>
          <p className="text-muted-foreground text-center max-w-md">
            {this.state.error?.message || "Неизвестная ошибка приложения"}
          </p>
          <Button
            onClick={() => {
              // Очищаем кэш React Query и перезагружаем
              queryClient.clear();
              window.location.reload();
            }}
          >
            Перезагрузить
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Core pages (loaded eagerly)
import DashboardPage from "@/pages/DashboardPage";
import AuthPage from "@/pages/AuthPage";
import VerifyEmailPage from "@/pages/VerifyEmailPage";
import NotFound from "@/pages/not-found";
import ProfilePage from "@/pages/ProfilePage";

// Lazy loaded pages - Admin routes
const ApiDocsPage = lazy(() => import("@/pages/ApiDocsPage"));
const VectorCollectionsPage = lazy(() => import("@/pages/VectorCollectionsPage"));
const VectorCollectionDetailPage = lazy(() => import("@/pages/VectorCollectionDetailPage"));
const VectorStorageSettingsPage = lazy(() => import("@/pages/VectorStorageSettingsPage"));
const EmbeddingServicesPage = lazy(() => import("@/pages/EmbeddingServicesPage"));
const LlmProvidersPage = lazy(() => import("@/pages/LlmProvidersPage"));
const LlmExecutionsPage = lazy(() => import("@/pages/LlmExecutionsPage"));
const AsrExecutionsPage = lazy(() => import("@/pages/AsrExecutionsPage"));
const TtsSttProvidersPage = lazy(() => import("@/pages/TtsSttProvidersPage"));
const SpeechProviderDetailsPage = lazy(() => import("@/pages/SpeechProviderDetailsPage"));
const AuthSettingsPage = lazy(() => import("@/pages/AuthSettingsPage"));
const AdminBillingPage = lazy(() => import("@/pages/AdminBillingPage"));
const AdminUsersPage = lazy(() => import("@/pages/AdminUsersPage"));
const AdminWorkspacesPage = lazy(() => import("@/pages/AdminWorkspacesPage"));
const AdminModelsPage = lazy(() => import("@/pages/AdminModelsPage"));
const AdminUsageChargesPage = lazy(() => import("@/pages/AdminUsageChargesPage"));
const GuardBlockEventsPage = lazy(() => import("@/pages/GuardBlockEventsPage"));
const FileStorageProvidersPage = lazy(() => import("@/pages/FileStorageProvidersPage"));
const FileStorageProviderDetailsPage = lazy(() => import("@/pages/FileStorageProviderDetailsPage"));
const SmtpSettingsPage = lazy(() => import("@/pages/SmtpSettingsPage"));
const AdminIndexingRulesPage = lazy(() => import("@/pages/AdminIndexingRulesPage"));

// Lazy loaded pages - Main routes
const KnowledgeBasePage = lazy(() => import("@/pages/KnowledgeBasePage"));
const SkillsPage = lazy(() => import("@/pages/SkillsPage"));
const ChatPage = lazy(() => import("@/pages/ChatPage"));
const WorkspaceActionsPage = lazy(() => import("@/pages/WorkspaceActionsPage"));
const WorkspaceSettingsPage = lazy(() => import("@/pages/WorkspaceSettingsPage"));
const WorkspaceCreditsHistoryPage = lazy(() => import("@/pages/WorkspaceCreditsHistoryPage"));
const SkillSettingsPage = lazy(() => import("@/pages/SkillSettingsPage"));
const ActionSettingsPage = lazy(() => import("@/pages/ActionSettingsPage"));
const KnowledgeBaseIndexingHistoryPage = lazy(() => import("@/pages/KnowledgeBaseIndexingHistoryPage"));

function AdminRouter() {
  return (
    <Switch>
      <Route path="/admin/workspaces">
        <LazyRouteWrapper><AdminWorkspacesPage /></LazyRouteWrapper>
      </Route>
      <Route path="/admin/auth">
        <LazyRouteWrapper><AuthSettingsPage /></LazyRouteWrapper>
      </Route>
      <Route path="/admin/embeddings">
        <LazyRouteWrapper><EmbeddingServicesPage /></LazyRouteWrapper>
      </Route>
      <Route path="/admin/llm-executions/:executionId">
        {(params) => <LazyRouteWrapper><LlmExecutionsPage selectedExecutionId={params.executionId} /></LazyRouteWrapper>}
      </Route>
      <Route path="/admin/llm-executions">
        <LazyRouteWrapper><LlmExecutionsPage /></LazyRouteWrapper>
      </Route>
      <Route path="/admin/asr-executions/:executionId">
        {(params) => <LazyRouteWrapper><AsrExecutionsPage key={params.executionId} /></LazyRouteWrapper>}
      </Route>
      <Route path="/admin/asr-executions">
        <LazyRouteWrapper><AsrExecutionsPage /></LazyRouteWrapper>
      </Route>
      <Route path="/admin/llm">
        <LazyRouteWrapper><LlmProvidersPage /></LazyRouteWrapper>
      </Route>
      <Route path="/admin/file-storage/providers/:providerId">
        {(params) => <LazyRouteWrapper><FileStorageProviderDetailsPage providerId={params.providerId} /></LazyRouteWrapper>}
      </Route>
      <Route path="/admin/file-storage">
        <LazyRouteWrapper><FileStorageProvidersPage /></LazyRouteWrapper>
      </Route>
      <Route path="/admin/guard-blocks">
        <LazyRouteWrapper><GuardBlockEventsPage /></LazyRouteWrapper>
      </Route>
      <Route path="/admin/tts-stt/providers/:providerId">
        {(params) => <LazyRouteWrapper><SpeechProviderDetailsPage providerId={params.providerId} /></LazyRouteWrapper>}
      </Route>
      <Route path="/admin/tts-stt">
        <LazyRouteWrapper><TtsSttProvidersPage /></LazyRouteWrapper>
      </Route>
      <Route path="/admin/models">
        <LazyRouteWrapper><AdminModelsPage /></LazyRouteWrapper>
      </Route>
      <Route path="/admin/usage-charges">
        <LazyRouteWrapper><AdminUsageChargesPage /></LazyRouteWrapper>
      </Route>
      <Route path="/admin/billing">
        <LazyRouteWrapper><AdminBillingPage /></LazyRouteWrapper>
      </Route>
      <Route path="/admin/indexing-rules">
        <LazyRouteWrapper><AdminIndexingRulesPage /></LazyRouteWrapper>
      </Route>
      <Route path="/admin/settings/smtp">
        <LazyRouteWrapper><SmtpSettingsPage /></LazyRouteWrapper>
      </Route>
      <Route path="/admin/storage">
        <LazyRouteWrapper><VectorStorageSettingsPage /></LazyRouteWrapper>
      </Route>
      <Route path="/admin/users">
        <LazyRouteWrapper><AdminUsersPage /></LazyRouteWrapper>
      </Route>
      <Route path="/admin">
        <LazyRouteWrapper><AdminWorkspacesPage /></LazyRouteWrapper>
      </Route>
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
      <Route path="/workspaces/:workspaceId/chat/:chatId">
        {(params) => (
          <LazyRouteWrapper>
            <ChatPage params={params} />
          </LazyRouteWrapper>
        )}
      </Route>
      <Route path="/workspaces/:workspaceId/chat">
        {(params) => (
          <LazyRouteWrapper>
            <ChatPage params={params} />
          </LazyRouteWrapper>
        )}
      </Route>
      <Route path="/knowledge/:baseId/indexing/history">
        {(params) => <LazyRouteWrapper><KnowledgeBaseIndexingHistoryPage params={{ knowledgeBaseId: params.baseId }} /></LazyRouteWrapper>}
      </Route>
      <Route path="/knowledge/:knowledgeBaseId/node/:nodeId">
        {(params) => <LazyRouteWrapper><KnowledgeBasePage params={params} /></LazyRouteWrapper>}
      </Route>
      <Route path="/knowledge/:knowledgeBaseId">
        {(params) => <LazyRouteWrapper><KnowledgeBasePage params={params} /></LazyRouteWrapper>}
      </Route>
      <Route path="/knowledge">
        <LazyRouteWrapper><KnowledgeBasePage params={undefined} /></LazyRouteWrapper>
      </Route>
      <Route path="/skills/new">
        <LazyRouteWrapper><SkillSettingsPage isNew /></LazyRouteWrapper>
      </Route>
      <Route path="/skills/:skillId/actions/:actionId/edit">
        {(params) => <LazyRouteWrapper><ActionSettingsPage actionId={params.actionId} skillId={params.skillId} /></LazyRouteWrapper>}
      </Route>
      <Route path="/skills/:skillId/edit">
        {(params) => <LazyRouteWrapper><SkillSettingsPage skillId={params.skillId} /></LazyRouteWrapper>}
      </Route>
      <Route path="/skills">
        <LazyRouteWrapper><SkillsPage /></LazyRouteWrapper>
      </Route>
      <Route path="/workspaces/:workspaceId/actions">
        <LazyRouteWrapper><WorkspaceActionsPage /></LazyRouteWrapper>
      </Route>
      <Route path="/workspaces/actions">
        <LazyRouteWrapper><WorkspaceActionsPage /></LazyRouteWrapper>
      </Route>
      <Route path="/workspaces/:workspaceId/credits/history">
        <LazyRouteWrapper><WorkspaceCreditsHistoryPage /></LazyRouteWrapper>
      </Route>
      <Route path="/workspaces/credits/history">
        <LazyRouteWrapper><WorkspaceCreditsHistoryPage /></LazyRouteWrapper>
      </Route>
      <Route path="/workspaces/:workspaceId/settings">
        <LazyRouteWrapper><WorkspaceSettingsPage /></LazyRouteWrapper>
      </Route>
      <Route path="/workspaces/settings">
        <LazyRouteWrapper><WorkspaceSettingsPage /></LazyRouteWrapper>
      </Route>
      <Route path="/workspaces/:workspaceId/members">
        {(params) => <Redirect to={`/workspaces/${params.workspaceId}/settings?tab=members`} />}
      </Route>
      <Route path="/workspaces/members">
        <Redirect to="/workspaces/settings?tab=members" />
      </Route>
      <Route path="/vector/collections/:name">
        <LazyRouteWrapper><VectorCollectionDetailPage /></LazyRouteWrapper>
      </Route>
      <Route path="/vector/collections">
        <LazyRouteWrapper><VectorCollectionsPage /></LazyRouteWrapper>
      </Route>
      <Route path="/integrations/api">
        <LazyRouteWrapper><ApiDocsPage /></LazyRouteWrapper>
      </Route>
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

function LazyRouteWrapper({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<LoadingScreen />}>{children}</Suspense>;
}

function HeaderUserArea({ user }: { user: PublicUser }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/logout");
    },
    onSuccess: async () => {
      // Полностью удаляем session query из кеша (не устанавливаем null)
      queryClient.removeQueries({ queryKey: ["/api/auth/session"] });
      
      // Удаляем все остальные queries
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
  // Флаг для отслеживания первого рендера - при первом рендере ВСЕГДА ждём fetch
  const [initialFetchDone, setInitialFetchDone] = useState(false);
  
  const sessionQuery = useQuery({
    queryKey: ["/api/auth/session"],
    queryFn: getQueryFn<SessionResponse>({ on401: "returnNull" }),
    staleTime: 1000 * 60 * 5, // 5 минут - не обновляем сессию слишком часто
    refetchOnWindowFocus: false, // Не обновляем при фокусе окна
    refetchOnMount: 'always', // Всегда проверяем сессию при монтировании (важно после logout/login)
    retry: false, // Не ретраим неудачные запросы сессии - сразу показываем AuthPage
  });

  // Отмечаем что первый fetch завершён (успешно или с ошибкой)
  useEffect(() => {
    if (!sessionQuery.isFetching && !initialFetchDone) {
      setInitialFetchDone(true);
    }
  }, [sessionQuery.isFetching, initialFetchDone]);

  const session = sessionQuery.data;

  // Если уже авторизованы, но находитесь на /auth/*, отправляем на главную.
  useEffect(() => {
    if (session?.user && location.startsWith("/auth")) {
      setLocation("/");
    }
  }, [session?.user, location, setLocation]);

  // При первом рендере ВСЕГДА ждём завершения fetch - не доверяем кэшу
  // Это решает проблему белого экрана когда в кэше старая/невалидная сессия
  if (!initialFetchDone || sessionQuery.isLoading) {
    return <LoadingScreen />;
  }

  // Если произошла ошибка при загрузке сессии - показываем AuthPage
  if (sessionQuery.error) {
    console.error("Session query error:", sessionQuery.error);
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

  // Показываем AuthPage только если точно нет сессии
  // Дополнительно проверяем workspace.active - если его нет, сессия невалидна
  if (!session || !session.user || !session.workspace?.active) {
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

  // Генерируем ключ на основе userId для принудительного перемонтирования при смене пользователя
  const appKey = session.user.id || 'no-user';

  return (
    <ErrorBoundary
      onError={(error) => {
        console.error("App render error, clearing cache:", error);
        // При ошибке рендеринга очищаем кэш сессии
        queryClient.removeQueries({ queryKey: ["/api/auth/session"] });
      }}
    >
      <Switch key={appKey}>
        <Route path={/^\/admin(?:\/.*)?$/i}>
          {user.role === "admin" ? <AdminAppShell user={user} workspace={workspace} /> : <UnauthorizedPage />}
        </Route>
        <Route>
          <MainAppShell user={user} workspace={workspace} />
        </Route>
      </Switch>
    </ErrorBoundary>
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
