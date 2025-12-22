import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Skill, SkillPayload } from "@/types/skill";
import type { SkillCallbackTokenResponse } from "@shared/skills";

const buildSkillsQueryKey = (workspaceId: string | null, includeArchived: boolean) =>
  ["skills", workspaceId ?? "none", includeArchived ? "all" : "active"] as const;

type SkillResponse = { skill: Skill };
type SkillListResponse = { skills: Skill[] };

async function fetchSkills(workspaceId: string, includeArchived?: boolean): Promise<Skill[]> {
  const params = includeArchived ? "?status=all" : "";
  const response = await apiRequest(
    "GET",
    `/api/skills${params}`,
    undefined,
    undefined,
    { workspaceId },
  );
  const payload = (await response.json()) as SkillListResponse;
  return payload.skills ?? [];
}

async function createSkill(workspaceId: string, payload: SkillPayload): Promise<Skill> {
  const response = await apiRequest(
    "POST",
    "/api/skills",
    { ...payload, workspaceId },
    undefined,
    { workspaceId },
  );
  const data = (await response.json()) as SkillResponse;
  return data.skill;
}

async function updateSkill(workspaceId: string, skillId: string, payload: SkillPayload): Promise<Skill> {
  const response = await apiRequest(
    "PUT",
    `/api/skills/${skillId}`,
    { ...payload, workspaceId },
    undefined,
    { workspaceId },
  );
  const data = (await response.json()) as SkillResponse;
  return data.skill;
}

async function generateCallbackToken(workspaceId: string, skillId: string): Promise<SkillCallbackTokenResponse> {
  const response = await apiRequest(
    "POST",
    `/api/skills/${skillId}/no-code/callback-token`,
    { workspaceId },
    undefined,
    { workspaceId },
  );
  const data = (await response.json()) as SkillCallbackTokenResponse;
  return data;
}

export function useSkills(options: { workspaceId: string | null; enabled?: boolean; includeArchived?: boolean }) {
  const { workspaceId, enabled = true, includeArchived = false } = options;
  const shouldFetch = Boolean(enabled && workspaceId);
  const query = useQuery<Skill[], Error>({
    queryKey: buildSkillsQueryKey(workspaceId ?? null, includeArchived),
    queryFn: () => fetchSkills(workspaceId as string, includeArchived),
    enabled: shouldFetch,
  });

  return {
    skills: query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useCreateSkill(options: { workspaceId: string | null; onSuccess?: (skill: Skill) => void }) {
  const { workspaceId, onSuccess } = options;
  const queryClient = useQueryClient();
  const mutation = useMutation<Skill, Error, SkillPayload>({
    mutationFn: async (payload) => {
      if (!workspaceId) {
        throw new Error("Не удалось определить рабочее пространство");
      }
      return await createSkill(workspaceId, payload);
    },
    onSuccess: async (createdSkill) => {
      await queryClient.invalidateQueries({
        predicate: (query) => {
          const [key] = query.queryKey as [unknown, ...unknown[]];
          return key === "skills";
        },
      });
      onSuccess?.(createdSkill);
    },
  });

  return {
    createSkill: mutation.mutateAsync,
    isCreating: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
  };
}

type UpdateSkillVariables = { skillId: string; payload: SkillPayload };

export function useUpdateSkill(options: { workspaceId: string | null; onSuccess?: (skill: Skill) => void }) {
  const { workspaceId, onSuccess } = options;
  const queryClient = useQueryClient();
  const mutation = useMutation<Skill, Error, UpdateSkillVariables>({
    mutationFn: async ({ skillId, payload }) => {
      if (!workspaceId) {
        throw new Error("Не удалось определить рабочее пространство");
      }
      return await updateSkill(workspaceId, skillId, payload);
    },
    onSuccess: async (updatedSkill) => {
      await queryClient.invalidateQueries({
        predicate: (query) => {
          const [key] = query.queryKey as [unknown, ...unknown[]];
          return key === "skills";
        },
      });
      onSuccess?.(updatedSkill);
    },
  });

  return {
    updateSkill: mutation.mutateAsync,
    isUpdating: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
  };
}

export function useGenerateCallbackToken(options: {
  workspaceId: string | null;
  onSuccess?: (response: SkillCallbackTokenResponse) => void;
}) {
  const { workspaceId, onSuccess } = options;
  const queryClient = useQueryClient();
  const mutation = useMutation<SkillCallbackTokenResponse, Error, { skillId: string }>({
    mutationFn: async ({ skillId }) => {
      if (!workspaceId) {
        throw new Error("Не удалось определить рабочее пространство");
      }
      return await generateCallbackToken(workspaceId, skillId);
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({
        predicate: (query) => {
          const [key] = query.queryKey as [unknown, ...unknown[]];
          return key === "skills";
        },
      });
      onSuccess?.(result);
    },
  });

  return {
    generateCallbackToken: mutation.mutateAsync,
    isGenerating: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
  };
}
