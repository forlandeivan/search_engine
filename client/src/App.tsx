import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
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
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={SearchPage} />
      <Route path="/admin" component={AdminPage} />
      <Route path="/admin/sites" component={AdminPage} />
      <Route path="/admin/projects/:siteId" component={ProjectDetailPage} />
      <Route path="/admin/pages" component={PagesPage} />
      <Route path="/admin/vector/collections/:name" component={VectorCollectionDetailPage} />
      <Route path="/admin/vector/collections" component={VectorCollectionsPage} />
      <Route path="/admin/api" component={TildaApiPage} />
      <Route path="/admin/:tab" component={AdminPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const style = {
    "--sidebar-width": "20rem",
    "--sidebar-width-icon": "4rem",
  };

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SidebarProvider style={style as React.CSSProperties}>
          <div className="flex h-screen w-full">
            <AdminSidebar />
            <div className="flex flex-col flex-1">
              <header className="flex items-center justify-between p-2 border-b">
                <SidebarTrigger data-testid="button-sidebar-toggle" />
                <ThemeToggle />
              </header>
              <main className="flex-1 overflow-auto">
                <Router />
              </main>
            </div>
          </div>
        </SidebarProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
