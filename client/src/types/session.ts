import type { PublicUser, WorkspaceMemberRole } from "@shared/schema";

export type WorkspaceMembership = {
  id: string;
  name: string;
  plan: string;
  role: WorkspaceMemberRole;
};

export type WorkspaceState = {
  active: WorkspaceMembership;
  memberships: WorkspaceMembership[];
};

export type SessionResponse = {
  user: PublicUser;
  workspace: WorkspaceState;
};
