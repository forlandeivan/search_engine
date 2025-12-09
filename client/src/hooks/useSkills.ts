import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Skill, SkillPayload } from "@/types/skill";

const SKILLS_QUERY_KEY = ["skills"] as const;

type SkillResponse = { skill: Skill };
type SkillListResponse = { skills: Skill[] };

async function fetchSkills(includeArchived?: boolean): Promise<Skill[]> {
  const params = includeArchived ? "?status=all" : "";
  const response = await apiRequest("GET", `/api/skills${params}`);
  const payload = (await response.json()) as SkillListResponse;
  return payload.skills ?? [];
}

async function createSkill(payload: SkillPayload): Promise<Skill> {
  const response = await apiRequest("POST", "/api/skills", payload);
  const data = (await response.json()) as SkillResponse;
  return data.skill;
}

async function updateSkill(skillId: string, payload: SkillPayload): Promise<Skill> {
  const response = await apiRequest("PUT", `/api/skills/${skillId}`, payload);
  const data = (await response.json()) as SkillResponse;
  return data.skill;
}

export function useSkills(options: { enabled?: boolean; includeArchived?: boolean } = {}) {
  const { enabled = true, includeArchived = false } = options;
  const query = useQuery<Skill[], Error>({
    queryKey: SKILLS_QUERY_KEY,
    queryFn: () => fetchSkills(includeArchived),
    enabled,
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

export function useCreateSkill(options: { onSuccess?: (skill: Skill) => void } = {}) {
  const queryClient = useQueryClient();
  const mutation = useMutation<Skill, Error, SkillPayload>({
    mutationFn: async (payload) => await createSkill(payload),
    onSuccess: async (createdSkill) => {
      await queryClient.invalidateQueries({ queryKey: SKILLS_QUERY_KEY });
      options.onSuccess?.(createdSkill);
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

export function useUpdateSkill(options: { onSuccess?: (skill: Skill) => void } = {}) {
  const queryClient = useQueryClient();
  const mutation = useMutation<Skill, Error, UpdateSkillVariables>({
    mutationFn: async ({ skillId, payload }) => await updateSkill(skillId, payload),
    onSuccess: async (updatedSkill) => {
      await queryClient.invalidateQueries({ queryKey: SKILLS_QUERY_KEY });
      options.onSuccess?.(updatedSkill);
    },
  });

  return {
    updateSkill: mutation.mutateAsync,
    isUpdating: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
  };
}
