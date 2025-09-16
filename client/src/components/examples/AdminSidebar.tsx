import AdminSidebar from '../AdminSidebar';
import { SidebarProvider } from "@/components/ui/sidebar";

export default function AdminSidebarExample() {
  const style = {
    "--sidebar-width": "20rem",
    "--sidebar-width-icon": "4rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AdminSidebar />
        <div className="flex-1 p-6">
          <p className="text-muted-foreground">Основной контент будет здесь</p>
        </div>
      </div>
    </SidebarProvider>
  );
}