/**
 * Workspace Invitation Service
 *
 * Manages workspace invitations:
 * - Creating invitations with secure tokens
 * - Validating and accepting invitations
 * - Listing, cancelling, and resending invitations
 */

import { randomBytes } from "crypto";
import { eq, and, isNull, gt, desc } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import {
  workspaceInvitations,
  workspaces,
  users,
  type WorkspaceInvitation,
  type WorkspaceMemberRole,
} from "@shared/schema";
import { createLogger } from "./lib/logger";

const logger = createLogger("workspace-invitation");

// Configuration
const INVITATION_EXPIRY_DAYS = Number(process.env.WORKSPACE_INVITATION_EXPIRY_DAYS ?? "7");

// ============================================================================
// Types
// ============================================================================

export interface InvitationWithWorkspace {
  invitation: WorkspaceInvitation;
  workspace: {
    id: string;
    name: string;
    iconUrl: string | null;
  };
  invitedBy: {
    fullName: string | null;
    email: string;
  } | null;
  userExists: boolean;
}

export interface PendingInvitation {
  id: string;
  email: string;
  role: WorkspaceMemberRole;
  createdAt: Date;
  expiresAt: Date;
  invitedBy: {
    fullName: string | null;
    email: string;
  } | null;
}

export interface CreateInvitationParams {
  workspaceId: string;
  email: string;
  role: WorkspaceMemberRole;
  invitedByUserId: string;
}

export interface CreateInvitationResult {
  invitation: WorkspaceInvitation;
  isNewInvitation: boolean;
}

export type InvitationErrorCode =
  | "ALREADY_MEMBER"
  | "INVITATION_EXISTS"
  | "INVALID_TOKEN"
  | "EXPIRED"
  | "CANCELLED"
  | "ALREADY_ACCEPTED"
  | "NOT_FOUND"
  | "EMAIL_MISMATCH";

export class InvitationError extends Error {
  constructor(
    message: string,
    public readonly code: InvitationErrorCode,
  ) {
    super(message);
    this.name = "InvitationError";
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function generateInvitationToken(): string {
  return randomBytes(32).toString("base64url");
}

function getExpiryDate(days: number = INVITATION_EXPIRY_DAYS): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Create a new invitation or update expired one
 */
export async function createInvitation(
  params: CreateInvitationParams,
): Promise<CreateInvitationResult> {
  const { workspaceId, email, role, invitedByUserId } = params;
  const normalizedEmail = email.trim().toLowerCase();

  logger.info({ workspaceId, email: normalizedEmail, role, invitedByUserId }, "Creating invitation");

  // Check if user is already a member
  const existingUser = await storage.getUserByEmail(normalizedEmail);
  if (existingUser) {
    const isMember = await storage.isWorkspaceMember(workspaceId, existingUser.id);
    if (isMember) {
      throw new InvitationError(
        "Пользователь уже состоит в рабочем пространстве",
        "ALREADY_MEMBER",
      );
    }
  }

  // Check for existing active invitation
  const now = new Date();
  const existingInvitation = await db
    .select()
    .from(workspaceInvitations)
    .where(
      and(
        eq(workspaceInvitations.workspaceId, workspaceId),
        eq(workspaceInvitations.email, normalizedEmail),
        isNull(workspaceInvitations.acceptedAt),
        isNull(workspaceInvitations.cancelledAt),
      ),
    )
    .limit(1);

  if (existingInvitation.length > 0) {
    const invitation = existingInvitation[0];
    // If not expired, throw error
    if (invitation.expiresAt > now) {
      throw new InvitationError(
        "Приглашение для этого email уже отправлено",
        "INVITATION_EXISTS",
      );
    }

    // If expired, update with new token and expiry
    const newToken = generateInvitationToken();
    const newExpiry = getExpiryDate();

    const [updated] = await db
      .update(workspaceInvitations)
      .set({
        token: newToken,
        expiresAt: newExpiry,
        role,
        invitedByUserId,
      })
      .where(eq(workspaceInvitations.id, invitation.id))
      .returning();

    logger.info({ invitationId: updated.id, email: normalizedEmail }, "Updated expired invitation");

    return { invitation: updated, isNewInvitation: false };
  }

  // Create new invitation
  const token = generateInvitationToken();
  const expiresAt = getExpiryDate();

  const [created] = await db
    .insert(workspaceInvitations)
    .values({
      workspaceId,
      email: normalizedEmail,
      role,
      token,
      invitedByUserId,
      expiresAt,
    })
    .returning();

  logger.info({ invitationId: created.id, email: normalizedEmail }, "Created new invitation");

  return { invitation: created, isNewInvitation: true };
}

/**
 * Get invitation by token with workspace info
 */
export async function getInvitationByToken(
  token: string,
): Promise<InvitationWithWorkspace | null> {
  if (!token || token.length > 512) {
    return null;
  }

  const results = await db
    .select({
      invitation: workspaceInvitations,
      workspace: {
        id: workspaces.id,
        name: workspaces.name,
        iconUrl: workspaces.iconUrl,
      },
      inviter: {
        fullName: users.fullName,
        email: users.email,
      },
    })
    .from(workspaceInvitations)
    .innerJoin(workspaces, eq(workspaceInvitations.workspaceId, workspaces.id))
    .leftJoin(users, eq(workspaceInvitations.invitedByUserId, users.id))
    .where(eq(workspaceInvitations.token, token))
    .limit(1);

  if (results.length === 0) {
    return null;
  }

  const result = results[0];
  const invitation = result.invitation;

  // Check if user with this email exists
  const existingUser = await storage.getUserByEmail(invitation.email);

  return {
    invitation,
    workspace: result.workspace,
    invitedBy: result.inviter
      ? { fullName: result.inviter.fullName, email: result.inviter.email }
      : null,
    userExists: !!existingUser,
  };
}

/**
 * Validate invitation token and return error code if invalid
 */
export function validateInvitation(
  invitation: WorkspaceInvitation,
): InvitationErrorCode | null {
  const now = new Date();

  if (invitation.acceptedAt) {
    return "ALREADY_ACCEPTED";
  }

  if (invitation.cancelledAt) {
    return "CANCELLED";
  }

  if (invitation.expiresAt < now) {
    return "EXPIRED";
  }

  return null;
}

/**
 * Accept invitation for an existing user
 */
export async function acceptInvitation(
  token: string,
  userId: string,
): Promise<{ workspaceId: string; role: WorkspaceMemberRole }> {
  const invitationData = await getInvitationByToken(token);

  if (!invitationData) {
    throw new InvitationError("Недействительный токен приглашения", "INVALID_TOKEN");
  }

  const { invitation } = invitationData;
  const validationError = validateInvitation(invitation);

  if (validationError) {
    const messages: Record<InvitationErrorCode, string> = {
      ALREADY_ACCEPTED: "Приглашение уже использовано",
      CANCELLED: "Приглашение было отменено",
      EXPIRED: "Срок действия приглашения истёк",
      INVALID_TOKEN: "Недействительный токен",
      ALREADY_MEMBER: "Вы уже участник этого пространства",
      INVITATION_EXISTS: "Приглашение уже существует",
      NOT_FOUND: "Приглашение не найдено",
      EMAIL_MISMATCH: "Email не совпадает",
    };
    throw new InvitationError(messages[validationError], validationError);
  }

  // Check if user email matches invitation email
  const user = await storage.getUserById(userId);
  if (!user) {
    throw new InvitationError("Пользователь не найден", "NOT_FOUND");
  }

  if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
    throw new InvitationError(
      "Email вашего аккаунта не совпадает с email приглашения",
      "EMAIL_MISMATCH",
    );
  }

  // Check if already a member
  const isMember = await storage.isWorkspaceMember(invitation.workspaceId, userId);
  if (isMember) {
    throw new InvitationError(
      "Вы уже являетесь участником этого рабочего пространства",
      "ALREADY_MEMBER",
    );
  }

  // Add user to workspace
  await storage.addWorkspaceMember(invitation.workspaceId, userId, invitation.role);

  // Mark invitation as accepted
  await db
    .update(workspaceInvitations)
    .set({ acceptedAt: new Date() })
    .where(eq(workspaceInvitations.id, invitation.id));

  logger.info(
    { invitationId: invitation.id, userId, workspaceId: invitation.workspaceId },
    "Invitation accepted",
  );

  return { workspaceId: invitation.workspaceId, role: invitation.role };
}

/**
 * Accept invitation for a new user (during registration)
 */
export async function acceptInvitationForNewUser(
  token: string,
  userId: string,
): Promise<{ workspaceId: string; role: WorkspaceMemberRole }> {
  const invitationData = await getInvitationByToken(token);

  if (!invitationData) {
    throw new InvitationError("Недействительный токен приглашения", "INVALID_TOKEN");
  }

  const { invitation } = invitationData;
  const validationError = validateInvitation(invitation);

  if (validationError) {
    const messages: Record<InvitationErrorCode, string> = {
      ALREADY_ACCEPTED: "Приглашение уже использовано",
      CANCELLED: "Приглашение было отменено",
      EXPIRED: "Срок действия приглашения истёк",
      INVALID_TOKEN: "Недействительный токен",
      ALREADY_MEMBER: "Вы уже участник этого пространства",
      INVITATION_EXISTS: "Приглашение уже существует",
      NOT_FOUND: "Приглашение не найдено",
      EMAIL_MISMATCH: "Email не совпадает",
    };
    throw new InvitationError(messages[validationError], validationError);
  }

  // Add user to workspace
  await storage.addWorkspaceMember(invitation.workspaceId, userId, invitation.role);

  // Mark invitation as accepted
  await db
    .update(workspaceInvitations)
    .set({ acceptedAt: new Date() })
    .where(eq(workspaceInvitations.id, invitation.id));

  logger.info(
    { invitationId: invitation.id, userId, workspaceId: invitation.workspaceId },
    "Invitation accepted for new user",
  );

  return { workspaceId: invitation.workspaceId, role: invitation.role };
}

/**
 * List pending invitations for a workspace
 */
export async function listPendingInvitations(
  workspaceId: string,
): Promise<PendingInvitation[]> {
  const now = new Date();

  const results = await db
    .select({
      id: workspaceInvitations.id,
      email: workspaceInvitations.email,
      role: workspaceInvitations.role,
      createdAt: workspaceInvitations.createdAt,
      expiresAt: workspaceInvitations.expiresAt,
      inviterFullName: users.fullName,
      inviterEmail: users.email,
    })
    .from(workspaceInvitations)
    .leftJoin(users, eq(workspaceInvitations.invitedByUserId, users.id))
    .where(
      and(
        eq(workspaceInvitations.workspaceId, workspaceId),
        isNull(workspaceInvitations.acceptedAt),
        isNull(workspaceInvitations.cancelledAt),
        gt(workspaceInvitations.expiresAt, now),
      ),
    )
    .orderBy(desc(workspaceInvitations.createdAt));

  return results.map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role as WorkspaceMemberRole,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    invitedBy: row.inviterEmail
      ? { fullName: row.inviterFullName, email: row.inviterEmail }
      : null,
  }));
}

/**
 * Cancel an invitation
 */
export async function cancelInvitation(
  invitationId: string,
  workspaceId: string,
): Promise<boolean> {
  const [updated] = await db
    .update(workspaceInvitations)
    .set({ cancelledAt: new Date() })
    .where(
      and(
        eq(workspaceInvitations.id, invitationId),
        eq(workspaceInvitations.workspaceId, workspaceId),
        isNull(workspaceInvitations.acceptedAt),
        isNull(workspaceInvitations.cancelledAt),
      ),
    )
    .returning({ id: workspaceInvitations.id });

  if (updated) {
    logger.info({ invitationId, workspaceId }, "Invitation cancelled");
    return true;
  }

  return false;
}

/**
 * Resend invitation - generate new token and extend expiry
 */
export async function resendInvitation(
  invitationId: string,
  workspaceId: string,
): Promise<WorkspaceInvitation | null> {
  const newToken = generateInvitationToken();
  const newExpiry = getExpiryDate();

  const [updated] = await db
    .update(workspaceInvitations)
    .set({
      token: newToken,
      expiresAt: newExpiry,
    })
    .where(
      and(
        eq(workspaceInvitations.id, invitationId),
        eq(workspaceInvitations.workspaceId, workspaceId),
        isNull(workspaceInvitations.acceptedAt),
        isNull(workspaceInvitations.cancelledAt),
      ),
    )
    .returning();

  if (updated) {
    logger.info({ invitationId, workspaceId }, "Invitation resent with new token");
    return updated;
  }

  return null;
}

/**
 * Get invitation by ID
 */
export async function getInvitationById(
  invitationId: string,
): Promise<WorkspaceInvitation | null> {
  const [invitation] = await db
    .select()
    .from(workspaceInvitations)
    .where(eq(workspaceInvitations.id, invitationId))
    .limit(1);

  return invitation ?? null;
}

/**
 * Get invitation with workspace info by ID
 */
export async function getInvitationWithWorkspaceById(
  invitationId: string,
): Promise<InvitationWithWorkspace | null> {
  const results = await db
    .select({
      invitation: workspaceInvitations,
      workspace: {
        id: workspaces.id,
        name: workspaces.name,
        iconUrl: workspaces.iconUrl,
      },
      inviter: {
        fullName: users.fullName,
        email: users.email,
      },
    })
    .from(workspaceInvitations)
    .innerJoin(workspaces, eq(workspaceInvitations.workspaceId, workspaces.id))
    .leftJoin(users, eq(workspaceInvitations.invitedByUserId, users.id))
    .where(eq(workspaceInvitations.id, invitationId))
    .limit(1);

  if (results.length === 0) {
    return null;
  }

  const result = results[0];
  const existingUser = await storage.getUserByEmail(result.invitation.email);

  return {
    invitation: result.invitation,
    workspace: result.workspace,
    invitedBy: result.inviter
      ? { fullName: result.inviter.fullName, email: result.inviter.email }
      : null,
    userExists: !!existingUser,
  };
}
