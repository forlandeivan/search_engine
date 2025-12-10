import { describe, it, expect, beforeEach } from "vitest";
import { EmailConfirmationTokenService, EmailConfirmationTokenError } from "../server/email-confirmation-token-service";

type TokenRecord = {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  consumedAt: Date | null;
};

class InMemoryRepo {
  tokens: TokenRecord[] = [];
  users = new Set<string>(["u1"]);
  lastCountSinceArgs: any;

  async invalidateActive(userId: string): Promise<void> {
    const now = new Date();
    this.tokens = this.tokens.map((t) =>
      t.userId === userId && !t.consumedAt && t.expiresAt > now
        ? { ...t, consumedAt: now }
        : t,
    );
  }

  async create(record: Omit<TokenRecord, "createdAt">): Promise<TokenRecord> {
    this.tokens.push({ ...record });
    return record as TokenRecord;
  }

  async findActiveByToken(token: string, now: Date): Promise<TokenRecord | null> {
    return (
      this.tokens.find((t) => t.token === token && !t.consumedAt && t.expiresAt > now) ?? null
    );
  }

  async consumeByToken(token: string, consumedAt: Date): Promise<void> {
    this.tokens = this.tokens.map((t) => (t.token === token ? { ...t, consumedAt } : t));
  }

  async userExists(userId: string): Promise<boolean> {
    return this.users.has(userId);
  }

  async countTokensSince(userId: string, since: Date): Promise<number> {
    this.lastCountSinceArgs = { userId, since };
    return this.tokens.filter((t) => t.userId === userId && t.createdAt >= since).length;
  }

  async getLastTokenCreatedAt(userId: string): Promise<Date | null> {
    const list = this.tokens.filter((t) => t.userId === userId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return list[0]?.createdAt ?? null;
  }

  async cleanupExpired(now: Date): Promise<void> {
    this.tokens = this.tokens.filter((t) => !(t.expiresAt < now && !t.consumedAt));
  }
}

describe("EmailConfirmationTokenService", () => {
  let repo: InMemoryRepo;
  let service: EmailConfirmationTokenService;

  beforeEach(() => {
    repo = new InMemoryRepo();
    service = new EmailConfirmationTokenService(repo as any);
  });

  it("creates a token and invalidates previous", async () => {
    const first = await service.createToken("u1", 24);
    const second = await service.createToken("u1", 24);

    expect(first).not.toEqual(second);
    const active = await service.getActiveToken(second);
    expect(active?.token).toEqual(second);

    const old = await service.getActiveToken(first);
    expect(old).toBeNull();
  });

  it("returns null for expired tokens", async () => {
    const now = new Date();
    repo.tokens.push({
      id: "t1",
      userId: "u1",
      token: "expired",
      expiresAt: new Date(now.getTime() - 1000),
      consumedAt: null,
    });
    const found = await service.getActiveToken("expired");
    expect(found).toBeNull();
  });

  it("consumes token", async () => {
    const token = await service.createToken("u1", 24);
    await service.consumeToken(token);
    const found = await service.getActiveToken(token);
    expect(found).toBeNull();
  });

  it("throws for unknown user", async () => {
    await expect(service.createToken("unknown", 24)).rejects.toThrowError(EmailConfirmationTokenError);
  });
});
