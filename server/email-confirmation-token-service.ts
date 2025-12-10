import crypto from "crypto";
import { and, eq, isNull, gt, gte, sql } from "drizzle-orm";

import { db } from "./db";
import { emailConfirmationTokens, users, type EmailConfirmationToken } from "@shared/schema";

export class EmailConfirmationTokenError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "EmailConfirmationTokenError";
  }
}

type Repo = {
  invalidateActive(userId: string): Promise<void>;
  create(record: Omit<EmailConfirmationToken, "createdAt">): Promise<EmailConfirmationToken>;
  findActiveByToken(token: string, now: Date): Promise<EmailConfirmationToken | null>;
  consumeByToken(token: string, consumedAt: Date): Promise<void>;
  userExists(userId: string): Promise<boolean>;
  countTokensSince(userId: string, since: Date): Promise<number>;
  getLastTokenCreatedAt(userId: string): Promise<Date | null>;
  cleanupExpired(now: Date): Promise<void>;
};

class DbEmailConfirmationTokenRepo implements Repo {
  async invalidateActive(userId: string): Promise<void> {
    await db
      .update(emailConfirmationTokens)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(emailConfirmationTokens.userId, userId),
          isNull(emailConfirmationTokens.consumedAt),
          gt(emailConfirmationTokens.expiresAt, new Date()),
        ),
      );
  }

  async create(record: Omit<EmailConfirmationToken, "createdAt">): Promise<EmailConfirmationToken> {
    const [row] = await db
      .insert(emailConfirmationTokens)
      .values({ ...record, createdAt: new Date() })
      .returning();
    return row;
  }

  async findActiveByToken(token: string, now: Date): Promise<EmailConfirmationToken | null> {
    const [row] = await db
      .select()
      .from(emailConfirmationTokens)
      .where(
        and(
          eq(emailConfirmationTokens.token, token),
          isNull(emailConfirmationTokens.consumedAt),
          gt(emailConfirmationTokens.expiresAt, now),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async consumeByToken(token: string, consumedAt: Date): Promise<void> {
    await db
      .update(emailConfirmationTokens)
      .set({ consumedAt })
      .where(eq(emailConfirmationTokens.token, token));
  }

  async userExists(userId: string): Promise<boolean> {
    const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
    return Boolean(row);
  }

  async countTokensSince(userId: string, since: Date): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(emailConfirmationTokens)
      .where(and(eq(emailConfirmationTokens.userId, userId), gte(emailConfirmationTokens.createdAt, since)));
    return Number(result[0]?.count ?? 0);
  }

  async getLastTokenCreatedAt(userId: string): Promise<Date | null> {
    const [row] = await db
      .select({ createdAt: emailConfirmationTokens.createdAt })
      .from(emailConfirmationTokens)
      .where(eq(emailConfirmationTokens.userId, userId))
      .orderBy(emailConfirmationTokens.createdAt.desc())
      .limit(1);
    return row?.createdAt ?? null;
  }

  async cleanupExpired(now: Date): Promise<void> {
    await db
      .delete(emailConfirmationTokens)
      .where(and(isNull(emailConfirmationTokens.consumedAt), gt(now, emailConfirmationTokens.expiresAt)));
  }
}

function generateToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export class EmailConfirmationTokenService {
  constructor(private readonly repo: Repo = new DbEmailConfirmationTokenRepo()) {}

  async createToken(userId: string, ttlHours = 24): Promise<string> {
    if (!userId) {
      throw new EmailConfirmationTokenError("User id is required");
    }
    const exists = await this.repo.userExists(userId);
    if (!exists) {
      throw new EmailConfirmationTokenError("User not found");
    }

    // invalidate previous active tokens
    await this.repo.invalidateActive(userId);

    const token = generateToken();
    const expires = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    await this.repo.create({
      id: crypto.randomUUID(),
      userId,
      token,
      expiresAt: expires,
      consumedAt: null,
    });

    return token;
  }

  async getActiveToken(token: string): Promise<EmailConfirmationToken | null> {
    if (!token?.trim()) {
      return null;
    }
    return this.repo.findActiveByToken(token, new Date());
  }

  async consumeToken(token: string): Promise<void> {
    await this.repo.consumeByToken(token, new Date());
  }

  async countTokensLastHours(userId: string, hours: number): Promise<number> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    return this.repo.countTokensSince(userId, since);
  }

  async getLastCreatedAt(userId: string): Promise<Date | null> {
    return this.repo.getLastTokenCreatedAt(userId);
  }

  async cleanupExpiredTokens(): Promise<void> {
    await this.repo.cleanupExpired(new Date());
  }
}

export const emailConfirmationTokenService = new EmailConfirmationTokenService();
