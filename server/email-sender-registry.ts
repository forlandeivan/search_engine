import type { RegistrationEmailService } from "./registration-email-service";
import { RegistrationEmailServiceImpl } from "./registration-email-service";
import type { WorkspaceInvitationEmailService } from "./workspace-invitation-email-service";
import { WorkspaceInvitationEmailServiceImpl } from "./workspace-invitation-email-service";
import { emailSender } from "./email-sender-instance";

const PRODUCT_NAME = "Unica";

export const registrationEmailService: RegistrationEmailService = new RegistrationEmailServiceImpl(
  emailSender,
  PRODUCT_NAME,
);

export const workspaceInvitationEmailService: WorkspaceInvitationEmailService = new WorkspaceInvitationEmailServiceImpl(
  emailSender,
  PRODUCT_NAME,
);
