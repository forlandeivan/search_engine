import { useMemo } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MessageSquarePlus, Sparkles, Brain, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// =============================================================================
// Types
// =============================================================================

type QuickAction = {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  badge?: string;
};

type QuickActionsGridProps = {
  workspaceId: string | null;
  onCreateKnowledgeBase?: () => void;
};

// =============================================================================
// Sub-components
// =============================================================================

type QuickActionCardProps = {
  action: QuickAction;
};

function QuickActionCard({ action }: QuickActionCardProps) {
  return (
    <Card
      className={`
        cursor-pointer transition-all
        hover:shadow-md hover:-translate-y-0.5
        ${action.disabled ? "opacity-50 cursor-not-allowed" : ""}
      `}
      onClick={action.disabled ? undefined : action.onClick}
      tabIndex={action.disabled ? -1 : 0}
      role="button"
      aria-label={`${action.title}: ${action.description}`}
      aria-disabled={action.disabled}
      onKeyDown={(e) => {
        if (!action.disabled && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          action.onClick();
        }
      }}
    >
      <CardContent className="flex flex-col items-center gap-2 p-4 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <action.icon className="h-5 w-5 text-primary" />
        </div>
        <div className="space-y-0.5">
          <p className="font-medium text-sm">{action.title}</p>
          <p className="text-xs text-muted-foreground">{action.description}</p>
        </div>
        {action.badge && (
          <Badge variant="secondary" className="text-xs mt-1">
            {action.badge}
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function QuickActionsGrid({
  workspaceId,
  onCreateKnowledgeBase,
}: QuickActionsGridProps) {
  const [, navigate] = useLocation();

  const actions: QuickAction[] = useMemo(() => {
    const handleNewChat = () => {
      if (workspaceId) {
        navigate(`/workspaces/${workspaceId}/chat`);
      }
    };

    const handleCreateSkill = () => {
      if (workspaceId) {
        navigate(`/workspaces/${workspaceId}/skills`);
      }
    };

    const handleCreateKnowledgeBase = () => {
      if (onCreateKnowledgeBase) {
        onCreateKnowledgeBase();
      }
    };

    const handleCreateAction = () => {
      if (workspaceId) {
        navigate(`/workspaces/${workspaceId}/actions`);
      }
    };

    return [
      {
        id: "new-chat",
        title: "Новый чат",
        description: "Начать диалог",
        icon: MessageSquarePlus,
        onClick: handleNewChat,
        disabled: !workspaceId,
      },
      {
        id: "create-skill",
        title: "Создать навык",
        description: "AI-агент",
        icon: Sparkles,
        onClick: handleCreateSkill,
        disabled: !workspaceId,
      },
      {
        id: "create-kb",
        title: "База знаний",
        description: "Добавить документы",
        icon: Brain,
        onClick: handleCreateKnowledgeBase,
        disabled: !workspaceId || !onCreateKnowledgeBase,
      },
      {
        id: "create-action",
        title: "Действие",
        description: "Автоматизация",
        icon: Zap,
        onClick: handleCreateAction,
        disabled: !workspaceId,
      },
    ];
  }, [workspaceId, navigate, onCreateKnowledgeBase]);

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Быстрые действия
      </h2>
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        {actions.map((action) => (
          <QuickActionCard key={action.id} action={action} />
        ))}
      </div>
    </section>
  );
}
