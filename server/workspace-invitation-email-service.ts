/**
 * Workspace Invitation Email Service
 *
 * Handles sending invitation emails to users
 */

import type { EmailSender, EmailMessage } from "./email";
import { EmailValidationError, SystemEmailType } from "./email";
import { createLogger } from "./lib/logger";

const logger = createLogger("workspace-invitation-email");

const DEFAULT_PRODUCT_NAME = "Unica";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim());
}

function isValidUrl(link: string): boolean {
  try {
    new URL(link);
    return true;
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ============================================================================
// Types
// ============================================================================

export interface SendInvitationEmailParams {
  recipientEmail: string;
  workspaceName: string;
  inviterName: string | null;
  inviteLink: string;
}

export interface SendMemberAddedEmailParams {
  recipientEmail: string;
  recipientName: string | null;
  workspaceName: string;
  inviterName: string | null;
  workspaceLink: string;
}

export interface WorkspaceInvitationEmailService {
  sendWorkspaceInvitationEmail(params: SendInvitationEmailParams): Promise<void>;
  sendWorkspaceMemberAddedEmail(params: SendMemberAddedEmailParams): Promise<void>;
}

// ============================================================================
// Implementation
// ============================================================================

export class WorkspaceInvitationEmailServiceImpl implements WorkspaceInvitationEmailService {
  constructor(
    private readonly emailSender: EmailSender,
    private readonly productName: string = DEFAULT_PRODUCT_NAME,
  ) {}

  /**
   * Send invitation email to a new user (not registered yet)
   */
  async sendWorkspaceInvitationEmail(params: SendInvitationEmailParams): Promise<void> {
    const { recipientEmail, workspaceName, inviterName, inviteLink } = params;

    const recipient = recipientEmail?.trim();
    if (!recipient || !isValidEmail(recipient)) {
      throw new EmailValidationError("Invalid recipient email");
    }
    if (!inviteLink?.trim() || !isValidUrl(inviteLink)) {
      throw new EmailValidationError("Invalid invite link");
    }
    if (!workspaceName?.trim()) {
      throw new EmailValidationError("Workspace name is required");
    }

    const inviter = inviterName?.trim() || "Администратор";
    const workspace = escapeHtml(workspaceName.trim());
    const subject = `Приглашение в рабочее пространство «${workspaceName}»`;

    const bodyHtml = `
      <div style="font-family: 'Geist', Arial, sans-serif; line-height: 1.5; color: #1f2937; font-size: 16px;">
        <p>Здравствуйте!</p>
        <p><strong>${escapeHtml(inviter)}</strong> приглашает вас в рабочее пространство <strong>«${workspace}»</strong> в ${escapeHtml(this.productName)}.</p>
        <p>Чтобы принять приглашение, нажмите на кнопку ниже:</p>
        <p style="margin: 24px 0;">
          <a href="${escapeHtml(inviteLink)}" style="
            display: inline-block;
            padding: 12px 20px;
            background: #2563eb;
            color: #ffffff;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 600;
          ">Принять приглашение</a>
        </p>
        <p>При переходе по ссылке вам будет предложено создать аккаунт.</p>
        <p>Ссылка действует 7 дней. Если вы не ожидали этого письма, просто проигнорируйте его.</p>
        <p style="color: #6b7280; font-size: 14px;">
          Если кнопка не работает, скопируйте и вставьте ссылку в браузер:<br/>
          <a href="${escapeHtml(inviteLink)}">${escapeHtml(inviteLink)}</a>
        </p>
      </div>
    `;

    const bodyText =
      `Здравствуйте!\n\n` +
      `${inviter} приглашает вас в рабочее пространство «${workspaceName}» в ${this.productName}.\n\n` +
      `Чтобы принять приглашение, перейдите по ссылке:\n` +
      `${inviteLink}\n\n` +
      `При переходе по ссылке вам будет предложено создать аккаунт.\n\n` +
      `Ссылка действует 7 дней. Если вы не ожидали этого письма, просто проигнорируйте его.`;

    const message: EmailMessage = {
      to: [recipient],
      subject,
      bodyHtml,
      bodyText,
      isSystemMessage: true,
      type: SystemEmailType.WorkspaceInvitation,
    };

    try {
      await this.emailSender.sendEmail(message);
      logger.info(
        { to: recipient, workspace: workspaceName, type: message.type },
        "Workspace invitation email sent",
      );
    } catch (err) {
      logger.error(
        {
          to: recipient,
          workspace: workspaceName,
          type: message.type,
          error: err instanceof Error ? err.message : String(err),
        },
        "Failed to send workspace invitation email",
      );
      throw err;
    }
  }

  /**
   * Send notification email to an existing user who was added to a workspace
   */
  async sendWorkspaceMemberAddedEmail(params: SendMemberAddedEmailParams): Promise<void> {
    const { recipientEmail, recipientName, workspaceName, inviterName, workspaceLink } = params;

    const recipient = recipientEmail?.trim();
    if (!recipient || !isValidEmail(recipient)) {
      throw new EmailValidationError("Invalid recipient email");
    }
    if (!workspaceLink?.trim() || !isValidUrl(workspaceLink)) {
      throw new EmailValidationError("Invalid workspace link");
    }
    if (!workspaceName?.trim()) {
      throw new EmailValidationError("Workspace name is required");
    }

    const displayName = recipientName?.trim() || recipient;
    const inviter = inviterName?.trim() || "Администратор";
    const workspace = escapeHtml(workspaceName.trim());
    const subject = `Вы добавлены в рабочее пространство «${workspaceName}»`;

    const bodyHtml = `
      <div style="font-family: 'Geist', Arial, sans-serif; line-height: 1.5; color: #1f2937; font-size: 16px;">
        <p>Здравствуйте, ${escapeHtml(displayName)}!</p>
        <p><strong>${escapeHtml(inviter)}</strong> добавил вас в рабочее пространство <strong>«${workspace}»</strong> в ${escapeHtml(this.productName)}.</p>
        <p>Теперь вы можете переключиться на это пространство в меню слева.</p>
        <p style="margin: 24px 0;">
          <a href="${escapeHtml(workspaceLink)}" style="
            display: inline-block;
            padding: 12px 20px;
            background: #2563eb;
            color: #ffffff;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 600;
          ">Открыть рабочее пространство</a>
        </p>
        <p style="color: #6b7280; font-size: 14px;">
          Если кнопка не работает, скопируйте и вставьте ссылку в браузер:<br/>
          <a href="${escapeHtml(workspaceLink)}">${escapeHtml(workspaceLink)}</a>
        </p>
      </div>
    `;

    const bodyText =
      `Здравствуйте, ${displayName}!\n\n` +
      `${inviter} добавил вас в рабочее пространство «${workspaceName}» в ${this.productName}.\n\n` +
      `Теперь вы можете переключиться на это пространство в меню слева.\n\n` +
      `Открыть рабочее пространство: ${workspaceLink}`;

    const message: EmailMessage = {
      to: [recipient],
      subject,
      bodyHtml,
      bodyText,
      isSystemMessage: true,
      type: SystemEmailType.WorkspaceMemberAdded,
    };

    try {
      await this.emailSender.sendEmail(message);
      logger.info(
        { to: recipient, workspace: workspaceName, type: message.type },
        "Workspace member added email sent",
      );
    } catch (err) {
      logger.error(
        {
          to: recipient,
          workspace: workspaceName,
          type: message.type,
          error: err instanceof Error ? err.message : String(err),
        },
        "Failed to send workspace member added email",
      );
      throw err;
    }
  }
}
