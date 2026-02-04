console.log("[App.tsx] Starting imports...");

import { Switch, Route, useLocation } from "wouter";
console.log("[App.tsx] wouter loaded");

import { useEffect, useLayoutEffect, useRef, Suspense, useState, Component, type ReactNode, type ErrorInfo } from "react";
console.log("[App.tsx] react loaded");

import { lazyWithRetry, isChunkLoadError, canAutoReload, performAutoReload, clearAllCachesAndReload, resetReloadCounter } from "@/lib/lazy-with-retry";
console.log("[App.tsx] lazy-with-retry loaded");

import { QueryClientProvider, useQuery } from "@tanstack/react-query";
console.log("[App.tsx] react-query loaded");

import { queryClient, getQueryFn } from "./lib/queryClient";
console.log("[App.tsx] queryClient loaded");

import { isApiError } from "@/lib/api-errors";
console.log("[App.tsx] api-errors loaded");

import { Toaster } from "@/components/ui/toaster";
console.log("[App.tsx] Toaster loaded");

import { MaintenanceBanner } from "@/components/maintenance-mode/MaintenanceBanner";
console.log("[App.tsx] MaintenanceBanner loaded");

import { MaintenanceOverlay } from "@/components/maintenance-mode/MaintenanceOverlay";
console.log("[App.tsx] MaintenanceOverlay loaded");

import { useMaintenanceStatus } from "@/hooks/use-maintenance-status";
console.log("[App.tsx] useMaintenanceStatus loaded");

import { useToast } from "@/hooks/use-toast";
console.log("[App.tsx] useToast loaded");

import { TooltipProvider } from "@/components/ui/tooltip";
console.log("[App.tsx] TooltipProvider loaded");

import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
console.log("[App.tsx] Sidebar loaded");

import AdminSidebar from "@/components/AdminSidebar";
console.log("[App.tsx] AdminSidebar loaded");

import MainSidebar from "@/components/MainSidebar";
console.log("[App.tsx] MainSidebar loaded");


import { Loader2 } from "lucide-react";
console.log("[App.tsx] lucide-react loaded");

import { Button } from "@/components/ui/button";
console.log("[App.tsx] Button loaded");



import type { PublicUser } from "@shared/schema";
import type { SessionResponse, WorkspaceState } from "@/types/session";
console.log("[App.tsx] All imports complete");

const ADMIN_MAINTENANCE_ACCESS_KEY = "maintenance-admin-access-until";
const ADMIN_MAINTENANCE_SESSION_KEY = "maintenance-admin-session";
const ADMIN_MAINTENANCE_ACCESS_TTL_MS = 60 * 60 * 1000;

function setAdminMaintenanceAccess(): void {
  try {
    sessionStorage.setItem(
      ADMIN_MAINTENANCE_ACCESS_KEY,
      String(Date.now() + ADMIN_MAINTENANCE_ACCESS_TTL_MS),
    );
  } catch {
    // ignore storage errors
  }
}

function hasAdminMaintenanceAccess(): boolean {
  try {
    const raw = sessionStorage.getItem(ADMIN_MAINTENANCE_ACCESS_KEY);
    if (!raw) {
      return false;
    }
    const until = Number(raw);
    if (!Number.isFinite(until)) {
      sessionStorage.removeItem(ADMIN_MAINTENANCE_ACCESS_KEY);
      return false;
    }
    if (Date.now() > until) {
      sessionStorage.removeItem(ADMIN_MAINTENANCE_ACCESS_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function storeAdminMaintenanceSession(session: SessionResponse): void {
  try {
    sessionStorage.setItem(
      ADMIN_MAINTENANCE_SESSION_KEY,
      JSON.stringify({
        user: session.user,
        workspace: session.workspace,
        activeWorkspaceId: session.activeWorkspaceId ?? null,
      }),
    );
  } catch {
    // ignore storage errors
  }
}

function readAdminMaintenanceSession(): SessionResponse | null {
  try {
    const raw = sessionStorage.getItem(ADMIN_MAINTENANCE_SESSION_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as SessionResponse | null;
    if (!parsed || parsed.user?.role !== "admin") {
      return null;
    }
    if (!parsed.workspace?.active) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isStoredAdminRole(): boolean {
  try {
    const raw = sessionStorage.getItem(ADMIN_MAINTENANCE_SESSION_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { user?: { role?: string } } | null;
    return parsed?.user?.role === "admin";
  } catch {
    return false;
  }
}

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
    
    // Если это ошибка загрузки чанка и можно выполнить автоперезагрузку
    if (isChunkLoadError(error) && canAutoReload()) {
      console.info("[ErrorBoundary] Chunk load error detected, performing auto-reload...");
      performAutoReload();
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      
      const isChunkError = isChunkLoadError(this.state.error);
      
      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-6 bg-background">
          <div className="flex flex-col items-center gap-4 max-w-md text-center">
            <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
              <svg
                className="w-8 h-8 text-destructive"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            
            <h1 className="text-2xl font-semibold text-foreground">
              {isChunkError ? "Требуется обновление" : "Произошла ошибка"}
            </h1>
            
            <p className="text-muted-foreground">
              {isChunkError
                ? "Приложение было обновлено. Пожалуйста, перезагрузите страницу, чтобы применить изменения."
                : (this.state.error?.message || "Неизвестная ошибка приложения. Пожалуйста, попробуйте перезагрузить страницу.")}
            </p>
            
            <div className="flex flex-col sm:flex-row gap-3 mt-2">
              <Button
                size="lg"
                onClick={() => {
                  // Очищаем кэш React Query и перезагружаем
                  queryClient.clear();
                  // Сбрасываем счетчики перезагрузок
                  resetReloadCounter();
                  window.location.reload();
                }}
              >
                Перезагрузить страницу
              </Button>
              
              {isChunkError && (
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => {
                    queryClient.clear();
                    clearAllCachesAndReload();
                  }}
                >
                  Очистить кэш
                </Button>
              )}
            </div>
            
            {isChunkError && (
              <p className="text-xs text-muted-foreground mt-4">
                Если перезагрузка не помогает — нажмите "Очистить кэш" или перезапустите dev-сервер
              </p>
            )}
          </div>
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
import AcceptInvitePage from "@/pages/AcceptInvitePage";
import NotFound from "@/pages/not-found";
import ProfilePage from "@/pages/ProfilePage";

// Lazy loaded pages - Admin routes (с автоперезагрузкой при ошибке загрузки чанков)
const ApiDocsPage = lazyWithRetry(() => import("@/pages/ApiDocsPage"));
const VectorCollectionsPage = lazyWithRetry(() => import("@/pages/VectorCollectionsPage"));
const VectorCollectionDetailPage = lazyWithRetry(() => import("@/pages/VectorCollectionDetailPage"));
const VectorStorageSettingsPage = lazyWithRetry(() => import("@/pages/VectorStorageSettingsPage"));
const EmbeddingServicesPage = lazyWithRetry(() => import("@/pages/EmbeddingServicesPage"));
const LlmProvidersPage = lazyWithRetry(() => import("@/pages/LlmProvidersPage"));
const LlmExecutionsPage = lazyWithRetry(() => import("@/pages/LlmExecutionsPage"));
const AsrExecutionsPage = lazyWithRetry(() => import("@/pages/AsrExecutionsPage"));
const TtsSttProvidersPage = lazyWithRetry(() => import("@/pages/TtsSttProvidersPage"));
const SpeechProviderDetailsPage = lazyWithRetry(() => import("@/pages/SpeechProviderDetailsPage"));
const AdminAsrProvidersPage = lazyWithRetry(() => import("@/pages/AdminAsrProvidersPage"));
const AuthSettingsPage = lazyWithRetry(() => import("@/pages/AuthSettingsPage"));
const AdminBillingPage = lazyWithRetry(() => import("@/pages/AdminBillingPage"));
const AdminUsersPage = lazyWithRetry(() => import("@/pages/AdminUsersPage"));
const AdminWorkspacesPage = lazyWithRetry(() => import("@/pages/AdminWorkspacesPage"));
const AdminModelsPage = lazyWithRetry(() => import("@/pages/AdminModelsPage"));
const AdminUsageChargesPage = lazyWithRetry(() => import("@/pages/AdminUsageChargesPage"));
const GuardBlockEventsPage = lazyWithRetry(() => import("@/pages/GuardBlockEventsPage"));
const FileStorageProvidersPage = lazyWithRetry(() => import("@/pages/FileStorageProvidersPage"));
const FileStorageProviderDetailsPage = lazyWithRetry(() => import("@/pages/FileStorageProviderDetailsPage"));
const SmtpSettingsPage = lazyWithRetry(() => import("@/pages/SmtpSettingsPage"));
const AdminIndexingRulesPage = lazyWithRetry(() => import("@/pages/AdminIndexingRulesPage"));
const AdminMaintenanceModePage = lazyWithRetry(() => import("@/pages/AdminMaintenanceModePage"));

// Lazy loaded pages - Main routes (с автоперезагрузкой при ошибке загрузки чанков)
const KnowledgeBasePage = lazyWithRetry(() => import("@/pages/KnowledgeBasePage"));
const SkillsPage = lazyWithRetry(() => import("@/pages/SkillsPage"));
const ChatPage = lazyWithRetry(() => import("@/pages/ChatPage"));
const WorkspaceActionsPage = lazyWithRetry(() => import("@/pages/WorkspaceActionsPage"));
const WorkspaceSettingsPage = lazyWithRetry(() => import("@/pages/WorkspaceSettingsPage"));
const WorkspaceCreditsHistoryPage = lazyWithRetry(() => import("@/pages/WorkspaceCreditsHistoryPage"));
const SkillSettingsPage = lazyWithRetry(() => import("@/pages/SkillSettingsPage"));
const ActionSettingsPage = lazyWithRetry(() => import("@/pages/ActionSettingsPage"));
const KnowledgeBaseIndexingHistoryPage = lazyWithRetry(() => import("@/pages/KnowledgeBaseIndexingHistoryPage"));

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
      <Route path="/admin/asr-providers">
        <LazyRouteWrapper><AdminAsrProvidersPage /></LazyRouteWrapper>
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
      <Route path="/admin/settings/maintenance">
        <LazyRouteWrapper><AdminMaintenanceModePage /></LazyRouteWrapper>
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
  // Убеждаемся, что компонент рендерится только внутри QueryClientProvider
  return (
    <Suspense fallback={<LoadingScreen />}>
      {children}
    </Suspense>
  );
}

function AdminAppShell({ user, workspace }: { user: PublicUser; workspace: WorkspaceState }) {
  return (
    <SidebarProvider>
      <div className="flex min-h-0 flex-1 w-full overflow-hidden">
        <AdminSidebar user={user} workspace={workspace} />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex h-12 items-center px-2 md:hidden">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
          </div>
          <main className="app-main flex-1 min-h-0 overflow-auto">
            <AdminRouter />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function MainAppShell({ user, workspace }: { user: PublicUser; workspace: WorkspaceState }) {
  return (
    <SidebarProvider>
      <div className="flex min-h-0 flex-1 w-full overflow-hidden">
        <MainSidebar showAdminLink={user.role === "admin"} user={user} workspace={workspace} />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex h-12 items-center px-2 md:hidden">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
          </div>
          <main className="app-main flex min-h-0 flex-1 flex-col overflow-auto">
            <div className="flex min-h-0 flex-1 flex-col">
              <MainRouter />
            </div>
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
  const { toast } = useToast();
  
  const sessionQuery = useQuery({
    queryKey: ["/api/auth/session"],
    queryFn: getQueryFn<SessionResponse>({ on401: "returnNull" }),
    staleTime: 1000 * 60 * 5, // 5 минут - не обновляем сессию слишком часто
    refetchOnWindowFocus: false, // Не обновляем при фокусе окна
    refetchOnMount: true, // Проверяем сессию при монтировании, если данные устарели
    retry: false, // Не ретраим неудачные запросы сессии - сразу показываем AuthPage
  });

  // Проверяем, была ли выполнена автоматическая перезагрузка
  useEffect(() => {
    const reloadCount = parseInt(sessionStorage.getItem("chunk-reload-count") || "0", 10);
    const wasAutoReloaded = sessionStorage.getItem("chunk-auto-reload-success");
    
    if (reloadCount > 0 && !wasAutoReloaded) {
      // Помечаем что уведомление показано
      sessionStorage.setItem("chunk-auto-reload-success", "true");
      
      // Показываем уведомление об успешной перезагрузке
      toast({
        title: "Приложение обновлено",
        description: "Страница была автоматически перезагружена для применения обновлений.",
        duration: 5000,
      });
      
      // Очищаем счетчики перезагрузок после успешной загрузки
      setTimeout(() => {
        sessionStorage.removeItem("chunk-reload-attempt");
        sessionStorage.removeItem("chunk-reload-count");
        sessionStorage.removeItem("chunk-auto-reload-success");
      }, 1000);
    }
  }, []); // Выполняется один раз при монтировании

  // Отмечаем что первый fetch завершён (успешно или с ошибкой)
  useEffect(() => {
    if (!sessionQuery.isFetching && !initialFetchDone) {
      setInitialFetchDone(true);
    }
  }, [sessionQuery.isFetching, initialFetchDone]);

  const cachedSession = queryClient.getQueryData<SessionResponse>(["/api/auth/session"]);
  const isAdminMaintenanceRoute = location.startsWith("/admin/settings/maintenance");
  const isMaintenanceSessionError =
    isApiError(sessionQuery.error) && sessionQuery.error.code === "MAINTENANCE_MODE";
  const storedAdminSession =
    isAdminMaintenanceRoute && isMaintenanceSessionError ? readAdminMaintenanceSession() : null;
  const session = sessionQuery.data ?? cachedSession ?? storedAdminSession ?? null;
  const canAccessAdminDuringMaintenance =
    isAdminMaintenanceRoute && (session?.user?.role === "admin" || hasAdminMaintenanceAccess());

  useEffect(() => {
    if (session?.user?.role === "admin") {
      setAdminMaintenanceAccess();
      storeAdminMaintenanceSession(session);
    }
  }, [session?.user?.role, session]);

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

  if (sessionQuery.error && isMaintenanceSessionError && !canAccessAdminDuringMaintenance) {
    return null;
  }

  // Если произошла ошибка при загрузке сессии - показываем AuthPage
  if (sessionQuery.error && !(isMaintenanceSessionError && canAccessAdminDuringMaintenance)) {
    console.error("Session query error:", sessionQuery.error);
    return (
      <AppFrame>
        <Switch>
          <Route path="/auth/verify-email">
            <VerifyEmailPage />
          </Route>
          <Route path="/invite/:token">
            <AcceptInvitePage />
          </Route>
          <Route>
            <AuthPage />
          </Route>
        </Switch>
      </AppFrame>
    );
  }

  // Показываем AuthPage только если точно нет сессии
  // Дополнительно проверяем workspace.active - если его нет, сессия невалидна
  if (!session || !session.user || !session.workspace?.active) {
    return (
      <AppFrame>
        <Switch>
          <Route path="/auth/verify-email">
            <VerifyEmailPage />
          </Route>
          <Route path="/invite/:token">
            <AcceptInvitePage />
          </Route>
          <Route>
            <AuthPage />
          </Route>
        </Switch>
      </AppFrame>
    );
  }

  const { user, workspace } = session;

  // Генерируем ключ на основе userId для принудительного перемонтирования при смене пользователя
  const appKey = session.user.id || 'no-user';

  const workspaceId = workspace.active?.id ?? null;

  return (
    <AppFrame>
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
        <Route path="/invite/:token">
          <AcceptInvitePage />
        </Route>
        <Route>
          <MainAppShell user={user} workspace={workspace} />
        </Route>
      </Switch>
      </ErrorBoundary>
    </AppFrame>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MaintenanceLayer />
        <AppContent />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

function MaintenanceLayer() {
  const [location] = useLocation();
  const maintenance = useMaintenanceStatus();
  const cachedSession = queryClient.getQueryData<SessionResponse>(["/api/auth/session"]);
  const isAdminMaintenanceRoute = location.startsWith("/admin/settings/maintenance");
  const canAccessAdminDuringMaintenance =
    isAdminMaintenanceRoute && (cachedSession?.user?.role === "admin" || hasAdminMaintenanceAccess());
  const shouldShowOverlay =
    (maintenance.status === "active" || maintenance.status === "unknown") && !canAccessAdminDuringMaintenance;
  const safeMode = maintenance.status === "unknown";
  const isAdmin =
    cachedSession?.user?.role === "admin" ||
    hasAdminMaintenanceAccess() ||
    readAdminMaintenanceSession()?.user?.role === "admin" ||
    isStoredAdminRole();

  return (
    <>
      {shouldShowOverlay ? (
        <MaintenanceOverlay status={maintenance.data} safeMode={safeMode} isAdmin={isAdmin} />
      ) : null}
    </>
  );
}

function AppFrame({ children }: { children: ReactNode }) {
  const maintenance = useMaintenanceStatus();
  const shouldShowBanner = maintenance.status === "scheduled" && Boolean(maintenance.data);
  const bannerRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const root = document.documentElement;

    if (!shouldShowBanner || !bannerRef.current) {
      root.style.setProperty("--app-banner-offset", "0px");
      return;
    }

    const updateOffset = () => {
      if (!bannerRef.current) return;
      const height = bannerRef.current.getBoundingClientRect().height;
      root.style.setProperty("--app-banner-offset", `${Math.ceil(height)}px`);
    };

    updateOffset();
    const observer = new ResizeObserver(updateOffset);
    observer.observe(bannerRef.current);
    window.addEventListener("resize", updateOffset);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateOffset);
      root.style.setProperty("--app-banner-offset", "0px");
    };
  }, [shouldShowBanner, maintenance.data]);

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden">
      {shouldShowBanner && maintenance.data ? (
        <div ref={bannerRef} className="relative z-[11] shrink-0">
          <MaintenanceBanner status={maintenance.data} />
        </div>
      ) : null}
      <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}
