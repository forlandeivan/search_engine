import { Link, useLocation } from "wouter";
import { Home, MessageSquare, Settings, BarChart3, Users, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import judicialEmblem from "@assets/judicial-emblem.png";

type NavItem = {
  icon: typeof Home;
  label: string;
  href: string;
  testId: string;
};

const navItems: NavItem[] = [
  { icon: Home, label: "Главная", href: "/", testId: "nav-home" },
  { icon: MessageSquare, label: "Чаты", href: "#", testId: "nav-chats" },
  { icon: BarChart3, label: "Аналитика", href: "#", testId: "nav-analytics" },
  { icon: Users, label: "Пользователи", href: "#", testId: "nav-users" },
  { icon: Zap, label: "Навыки", href: "/skills", testId: "nav-skills" },
];

type ChatIconRailProps = {
  className?: string;
};

export default function ChatIconRail({ className }: ChatIconRailProps) {
  const [location] = useLocation();

  return (
    <aside
      className={cn(
        "flex h-full flex-col items-center border-r border-slate-200 bg-white py-4 px-4 dark:border-slate-800 dark:bg-slate-900",
        className
      )}
      data-testid="chat-icon-rail"
    >
      <div className="flex flex-1 flex-col items-center gap-8">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-md border border-[#0e4c7d] overflow-hidden"
          data-testid="icon-judicial-emblem"
        >
          <img
            src={judicialEmblem}
            alt="Судебный департамент"
            className="h-full w-full object-cover"
          />
        </div>

        <nav className="flex flex-col items-center gap-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));

            return (
              <Tooltip key={item.testId}>
                <TooltipTrigger asChild>
                  <Link href={item.href}>
                    <button
                      className={cn(
                        "flex h-12 w-12 items-center justify-center rounded-full transition-colors",
                        isActive
                          ? "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100"
                          : "text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                      )}
                      data-testid={item.testId}
                    >
                      <Icon className="h-6 w-6" />
                    </button>
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>{item.label}</p>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </nav>
      </div>

      <div className="mt-auto">
        <Tooltip>
          <TooltipTrigger asChild>
            <Link href="/admin">
              <button
                className="flex h-12 w-12 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                data-testid="nav-settings"
              >
                <Settings className="h-6 w-6" />
              </button>
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>Настройки</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </aside>
  );
}
