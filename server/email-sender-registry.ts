import type { RegistrationEmailService } from "./registration-email-service";
import { RegistrationEmailServiceImpl } from "./registration-email-service";
import { emailSender } from "./email-sender-instance";

const PRODUCT_NAME = "Unica";

export const registrationEmailService: RegistrationEmailService = new RegistrationEmailServiceImpl(
  emailSender,
  PRODUCT_NAME,
);
