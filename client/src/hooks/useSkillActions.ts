import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export type SkillActionItem = {
  action: {
    id: string;
    label: string;
    description?: string;
    target: string;
    inputType: string;
    outputMode: string;
    scope: string;
  };
  skillAction: {
    enabled: boolean;
    enabledPlacements: string[];
    labelOverride?: string;
  } | null;
  ui: {
    effectiveLabel: string;
    editable: boolean;
  };
};

export function useSkillActions(workspaceId: string, skillId: string) {
  return useQuery({
    queryKey: ["/api/skills", skillId, "actions", workspaceId],
    queryFn: async () => {
      const res = await fetch(`/api/skills/${skillId}/actions?workspaceId=${workspaceId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load skill actions");
      const data = await res.json();
      return data.items as SkillActionItem[];
    },
    enabled: Boolean(workspaceId && skillId),
  });
}

export function useRunSkillAction(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      skillId,
      actionId,
      placement,
      target,
      selectionText,
    }: {
      skillId: string;
      actionId: string;
      placement: string;
      target: string;
      selectionText: string;
    }) => {
      const res = await fetch(`/api/skills/${skillId}/actions/${actionId}/run?workspaceId=${workspaceId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          placement,
          target,
          context: { selectionText },
        }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to run action");
      }
      return res.json();
    },
  });
}
