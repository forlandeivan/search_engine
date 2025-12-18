import { ensureWorkspaceCreditAccount } from "./credits-service";
import { centsToCredits } from "@shared/credits";

export class InsufficientCreditsError extends Error {
  code = "INSUFFICIENT_CREDITS";
  status: number;
  details?: Record<string, unknown>;
  constructor(message: string, details?: Record<string, unknown>, status = 402) {
    super(message);
    this.name = "InsufficientCreditsError";
    this.details = details;
    this.status = status;
  }
}

export async function assertSufficientWorkspaceCredits(
  workspaceId: string,
  requiredCreditsCents: number,
  context?: Record<string, unknown>,
): Promise<void> {
  const needed = Math.max(0, Math.trunc(requiredCreditsCents ?? 0));
  if (needed === 0) return;
  const account = await ensureWorkspaceCreditAccount(workspaceId);
  const available = Math.max(0, Number(account.currentBalance ?? 0));
  if (available < needed) {
    throw new InsufficientCreditsError("Недостаточно кредитов", {
      availableCredits: centsToCredits(available),
      requiredCredits: centsToCredits(needed),
      availableCreditsCents: available,
      requiredCreditsCents: needed,
      ...context,
    });
  }
}
