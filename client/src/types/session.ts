import type { PublicUser, WorkspaceMemberRole } from "@shared/schema";

export type WorkspaceMembership = {
  id: string;
  name: string;
  plan: string;
  role: WorkspaceMemberRole;
  iconUrl: string | null;
  ownerFullName: string | null;
  ownerEmail: string | null;
};

export type WorkspaceState = {
  active: WorkspaceMembership;
  memberships: WorkspaceMembership[];
};

export type SessionResponse = {
  user: PublicUser;
  workspace: WorkspaceState;
  activeWorkspaceId?: string | null;
};
