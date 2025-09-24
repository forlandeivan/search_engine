import { Switch, Route } from "wouter";
import { QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryClient, getQueryFn, apiRequest } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import AdminSidebar from "@/components/AdminSidebar";
import ThemeToggle from "@/components/ThemeToggle";
import SearchPage from "@/pages/SearchPage";
import AdminPage from "@/pages/AdminPage";
import PagesPage from "@/pages/PagesPage";
import TildaApiPage from "@/pages/TildaApiPage";
import VectorCollectionsPage from "@/pages/VectorCollectionsPage";
import VectorCollectionDetailPage from "@/pages/VectorCollectionDetailPage";
import ProjectDetailPage from "@/pages/ProjectDetailPage";
import KnowledgeBasePage from "@/pages/KnowledgeBasePage";
import NotFound from "@/pages/not-found";
import AuthPage from "@/pages/AuthPage";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { PublicUser } from "@shared/schema";
import type { CSSProperties } from "react";

function Router() {
  return (
    <Switch>
      <Route path="/" component={SearchPage} />
      <Route path="/admin" component={AdminPage} />
      <Route path="/admin/sites" component={AdminPage} />
      <Route path="/admin/projects/:siteId" component={ProjectDetailPage} />
      <Route path="/admin/pages" component={PagesPage} />
      <Route path="/admin/knowledge" component={KnowledgeBasePage} />
      <Route path="/admin/vector/collections/:name" component={VectorCollectionDetailPage} />
      <Route path="/admin/vector/collections" component={VectorCollectionsPage} />
      <Route path="/admin/api" component={TildaApiPage} />
      <Route path="/admin/:tab" component={AdminPage} />
      <Route component={NotFound} />
    </Switch>
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

function AppShell({ user }: { user: PublicUser }) {
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
            <Router />
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

  return <AppShell user={session.user} />;
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
