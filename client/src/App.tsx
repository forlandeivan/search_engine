import { Switch, Route } from "wouter";
import { QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryClient, getQueryFn, apiRequest } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import AdminSidebar from "@/components/AdminSidebar";
import MainSidebar from "@/components/MainSidebar";
import ThemeToggle from "@/components/ThemeToggle";
import SearchPage from "@/pages/SearchPage";
import AdminPage from "@/pages/AdminPage";
import PagesPage from "@/pages/PagesPage";
import TildaApiPage from "@/pages/TildaApiPage";
import VectorCollectionsPage from "@/pages/VectorCollectionsPage";
import VectorCollectionDetailPage from "@/pages/VectorCollectionDetailPage";
import VectorStorageSettingsPage from "@/pages/VectorStorageSettingsPage";
import EmbeddingServicesPage from "@/pages/EmbeddingServicesPage";
import ProjectDetailPage from "@/pages/ProjectDetailPage";
import KnowledgeBasePage from "@/pages/KnowledgeBasePage";
import AdminUsersPage from "@/pages/AdminUsersPage";
import NotFound from "@/pages/not-found";
import AuthPage from "@/pages/AuthPage";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { PublicUser } from "@shared/schema";
import type { CSSProperties } from "react";

function AdminRouter() {
  return (
    <Switch>
      <Route path="/admin/embeddings" component={EmbeddingServicesPage} />
      <Route path="/admin/storage" component={VectorStorageSettingsPage} />
      <Route path="/admin/users" component={AdminUsersPage} />
      <Route path="/admin" component={AdminUsersPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function MainRouter() {
  return (
    <Switch>
      <Route path="/projects/:siteId" component={ProjectDetailPage} />
      <Route path="/projects" component={AdminPage} />
      <Route path="/knowledge" component={KnowledgeBasePage} />
      <Route path="/pages" component={PagesPage} />
      <Route path="/vector/collections/:name" component={VectorCollectionDetailPage} />
      <Route path="/vector/collections" component={VectorCollectionsPage} />
      <Route path="/integrations/api" component={TildaApiPage} />
      <Route path="/" component={SearchPage} />
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
    <div className="flex items-center gap-3">
      <div className="hidden sm:block text-right leading-tight">
        <p className="text-sm font-medium">{user.fullName}</p>
        <p className="text-xs text-muted-foreground">{user.email}</p>
      </div>
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

function AdminAppShell({ user }: { user: PublicUser }) {
  const style = {
    "--sidebar-width": "20rem",
    "--sidebar-width-icon": "4rem",
  } as CSSProperties;

  return (
    <SidebarProvider style={style}>
      <div className="flex h-screen w-full">
        <AdminSidebar />
        <div className="flex flex-col flex-1">
          <header className="flex items-center justify-between p-2 border-b gap-2">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <HeaderUserArea user={user} />
          </header>
          <main className="flex-1 overflow-auto">
            <AdminRouter />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function MainAppShell({ user }: { user: PublicUser }) {
  const style = {
    "--sidebar-width": "20rem",
    "--sidebar-width-icon": "4rem",
  } as CSSProperties;

  return (
    <SidebarProvider style={style}>
      <div className="flex h-screen w-full">
        <MainSidebar showAdminLink={user.role === "admin"} />
        <div className="flex flex-col flex-1">
          <header className="flex items-center justify-between p-2 border-b gap-2">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <HeaderUserArea user={user} />
          </header>
          <main className="flex-1 overflow-auto">
            <MainRouter />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function AppContent() {
  const sessionQuery = useQuery({
    queryKey: ["/api/auth/session"],
    queryFn: getQueryFn<{ user: PublicUser }>({ on401: "returnNull" }),
    staleTime: 0,
  });

  if (sessionQuery.isLoading) {
    return <LoadingScreen />;
  }

  const session = sessionQuery.data;

  if (!session || !session.user) {
    return <AuthPage />;
  }

  const { user } = session;

  return (
    <Switch>
      <Route path="/admin/:rest*">
        {user.role === "admin" ? <AdminAppShell user={user} /> : <UnauthorizedPage />}
      </Route>
      <Route>
        <MainAppShell user={user} />
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
