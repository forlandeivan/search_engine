import type { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Strategy as GoogleStrategy, type Profile as GoogleProfile, type VerifyCallback } from "passport-google-oauth20";
import { Strategy as YandexStrategy, type YandexProfile } from "passport-yandex";
import bcrypt from "bcryptjs";
import { pool } from "./db";
import { storage } from "./storage";
import type { PublicUser, User, WorkspaceMemberRole } from "@shared/schema";
import type { WorkspaceWithRole } from "./storage";
import { createHash } from "crypto";

declare module "express-session" {
  interface SessionData {
    oauthRedirectTo?: string;
    workspaceId?: string;
  }
}

declare module "express-serve-static-core" {
  interface Request {
    workspaceId?: string;
    workspaceRole?: WorkspaceMemberRole;
    workspaceMemberships?: WorkspaceWithRole[];
  }
}

const PgSession = connectPgSimple(session);

export function toPublicUser(user: User): PublicUser {
  const { passwordHash, personalApiTokenHash, personalApiTokenLastFour, ...safe } = user;
  return {
    ...safe,
    personalApiTokenLastFour: personalApiTokenLastFour ?? null,
    hasPersonalApiToken: Boolean(personalApiTokenHash && personalApiTokenHash.length > 0),
  };
}

type PassportWithUnuse = typeof passport & {
  unuse?: (name: string) => void;
  _strategies?: Record<string, unknown>;
};

type OAuthProviderSettings = {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  isEnabled: boolean;
  source: "database" | "environment";
};

export class WorkspaceContextError extends Error {
  statusCode: number;
  status: number;

  constructor(message = "Рабочее пространство не найдено", statusCode = 404) {
    super(message);
    this.name = "WorkspaceContextError";
    this.statusCode = statusCode;
    this.status = statusCode;
  }
}

const googleStrategyName = "google";
let loggedMissingGoogleConfig = false;
const yandexStrategyName = "yandex";
let loggedMissingYandexConfig = false;

async function resolveGoogleAuthSettings(): Promise<OAuthProviderSettings> {
  const envClientId = (process.env.GOOGLE_CLIENT_ID ?? "").trim();
  const envClientSecret = (process.env.GOOGLE_CLIENT_SECRET ?? "").trim();
  const envCallbackUrl = (process.env.GOOGLE_CALLBACK_URL ?? "/api/auth/google/callback").trim();

  try {
    const provider = await storage.getAuthProvider("google");
    if (provider) {
      const clientId = provider.clientId?.trim() ?? "";
      const clientSecret = provider.clientSecret?.trim() ?? "";
      const callbackUrl = provider.callbackUrl?.trim() || envCallbackUrl;
      const isEnabled = provider.isEnabled && clientId.length > 0 && clientSecret.length > 0;

      return {
        clientId,
        clientSecret,
        callbackUrl,
        isEnabled,
        source: "database",
      };
    }
  } catch (error) {
    console.error("Не удалось загрузить настройки Google OAuth из базы данных:", error);
  }

  const fallbackEnabled = envClientId.length > 0 && envClientSecret.length > 0;

  return {
    clientId: envClientId,
    clientSecret: envClientSecret,
    callbackUrl: envCallbackUrl,
    isEnabled: fallbackEnabled,
    source: "environment",
  };
}

async function resolveYandexAuthSettings(): Promise<OAuthProviderSettings> {
  const envClientId = (process.env.YANDEX_CLIENT_ID ?? "").trim();
  const envClientSecret = (process.env.YANDEX_CLIENT_SECRET ?? "").trim();
  const envCallbackUrl = (process.env.YANDEX_CALLBACK_URL ?? "/api/auth/yandex/callback").trim();

  try {
    const provider = await storage.getAuthProvider("yandex");
    if (provider) {
      const clientId = provider.clientId?.trim() ?? "";
      const clientSecret = provider.clientSecret?.trim() ?? "";
      const callbackUrl = provider.callbackUrl?.trim() || envCallbackUrl;
      const isEnabled = provider.isEnabled && clientId.length > 0 && clientSecret.length > 0;

      return {
        clientId,
        clientSecret,
        callbackUrl,
        isEnabled,
        source: "database",
      };
    }
  } catch (error) {
    console.error("Не удалось загрузить настройки Yandex OAuth из базы данных:", error);
  }

  const fallbackEnabled = envClientId.length > 0 && envClientSecret.length > 0;

  return {
    clientId: envClientId,
    clientSecret: envClientSecret,
    callbackUrl: envCallbackUrl,
    isEnabled: fallbackEnabled,
    source: "environment",
  };
}

async function applyGoogleAuthStrategy(app: Express): Promise<void> {
  const settings = await resolveGoogleAuthSettings();
  const authenticator = passport as PassportWithUnuse;

  if (typeof authenticator.unuse === "function") {
    try {
      authenticator.unuse(googleStrategyName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/Unknown authentication strategy/i.test(message)) {
        console.warn("Не удалось отключить Google OAuth перед перенастройкой:", message);
      }
    }
  } else if (authenticator._strategies) {
    delete authenticator._strategies[googleStrategyName];
  }

  app.set("googleAuthConfigured", settings.isEnabled);
  app.set("googleAuthSource", settings.source);

  if (!settings.isEnabled) {
    if (app.get("env") !== "test" && !loggedMissingGoogleConfig) {
      console.warn("Google OAuth не настроен: заполните настройки в админ-панели или установите переменные окружения");
      loggedMissingGoogleConfig = true;
    }
    return;
  }

  loggedMissingGoogleConfig = false;

  authenticator.use(
    new GoogleStrategy(
      {
        clientID: settings.clientId,
        clientSecret: settings.clientSecret,
        callbackURL: settings.callbackUrl,
      },
      async (
        _accessToken: string,
        _refreshToken: string,
        profile: GoogleProfile,
        done: VerifyCallback,
      ) => {
        try {
          const primaryEmail = (profile.emails ?? []).find(
            (entry): entry is NonNullable<GoogleProfile["emails"]>[number] & { value: string } =>
              typeof entry.value === "string",
          );
          if (!primaryEmail?.value) {
            return done(null, false, { message: "Не удалось получить email Google-профиля" });
          }

          const user = await storage.upsertUserFromGoogle({
            googleId: profile.id,
            email: primaryEmail.value,
            fullName: profile.displayName,
            firstName: profile.name?.givenName,
            lastName: profile.name?.familyName,
            avatar: profile.photos?.[0]?.value,
            emailVerified: primaryEmail.verified,
          });

          const updatedUser = await storage.recordUserActivity(user.id);
          done(null, toPublicUser(updatedUser ?? user));
        } catch (error) {
          done(error as Error);
        }
      },
    ),
  );
}

export async function reloadGoogleAuth(app: Express): Promise<void> {
  await applyGoogleAuthStrategy(app);
}

async function applyYandexAuthStrategy(app: Express): Promise<void> {
  const settings = await resolveYandexAuthSettings();
  const authenticator = passport as PassportWithUnuse;

  if (typeof authenticator.unuse === "function") {
    try {
      authenticator.unuse(yandexStrategyName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/Unknown authentication strategy/i.test(message)) {
        console.warn("Не удалось отключить Yandex OAuth перед перенастройкой:", message);
      }
    }
  } else if (authenticator._strategies) {
    delete authenticator._strategies[yandexStrategyName];
  }

  app.set("yandexAuthConfigured", settings.isEnabled);
  app.set("yandexAuthSource", settings.source);

  if (!settings.isEnabled) {
    if (app.get("env") !== "test" && !loggedMissingYandexConfig) {
      console.warn(
        "Yandex OAuth не настроен: заполните настройки в админ-панели или установите переменные окружения",
      );
      loggedMissingYandexConfig = true;
    }
    return;
  }

  loggedMissingYandexConfig = false;

  authenticator.use(
    new YandexStrategy(
      {
        clientID: settings.clientId,
        clientSecret: settings.clientSecret,
        callbackURL: settings.callbackUrl,
      },
      async (_accessToken: string, _refreshToken: string, profile: YandexProfile, done: VerifyCallback) => {
        try {
          const primaryEmail = (profile.emails ?? []).find(
            (entry): entry is NonNullable<YandexProfile["emails"]>[number] & { value: string } =>
              typeof entry?.value === "string" && entry.value.length > 0,
          );
          const defaultEmail =
            typeof profile._json?.default_email === "string" && profile._json.default_email.length > 0
              ? profile._json.default_email
              : undefined;
          const email = primaryEmail?.value ?? defaultEmail;

          if (!email) {
            return done(null, false, { message: "Не удалось получить email Yandex-профиля" });
          }

          const avatarFromPhotos = profile.photos?.[0]?.value;
          let avatar = typeof avatarFromPhotos === "string" ? avatarFromPhotos : undefined;
          if (!avatar) {
            const avatarId = profile._json && typeof profile._json.default_avatar_id === "string"
              ? profile._json.default_avatar_id.trim()
              : "";
            if (avatarId) {
              avatar = `https://avatars.yandex.net/get-yapic/${avatarId}/islands-200`;
            }
          }

          const emailVerifiedRaw =
            (profile._json as { is_email_verified?: boolean; email_verified?: boolean } | undefined)
              ?.is_email_verified ??
            (profile._json as { email_verified?: boolean } | undefined)?.email_verified;

          const user = await storage.upsertUserFromYandex({
            yandexId: profile.id,
            email,
            fullName:
              profile.displayName ||
              (typeof profile._json?.real_name === "string" ? profile._json.real_name : undefined) ||
              (typeof profile._json?.display_name === "string" ? profile._json.display_name : undefined),
            firstName:
              profile.name?.givenName ||
              (typeof profile._json?.first_name === "string" ? profile._json.first_name : undefined),
            lastName:
              profile.name?.familyName ||
              (typeof profile._json?.last_name === "string" ? profile._json.last_name : undefined),
            avatar,
            emailVerified: emailVerifiedRaw,
          });

          const updatedUser = await storage.recordUserActivity(user.id);
          done(null, toPublicUser(updatedUser ?? user));
        } catch (error) {
          done(error as Error);
        }
      },
    ),
  );
}

export async function reloadYandexAuth(app: Express): Promise<void> {
  await applyYandexAuthStrategy(app);
}

export async function configureAuth(app: Express): Promise<void> {
  const sessionSecret = process.env.SESSION_SECRET || "dev-session-secret";
  const cookieSecure = app.get("env") === "production";

  app.use(
    session({
      store: new PgSession({
        pool,
        createTableIfMissing: true,
      }),
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: cookieSecure,
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
      },
    })
  );

  app.use(passport.initialize());
  app.use(passport.session());

  passport.serializeUser((user: PublicUser, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await storage.getUser(id);
      if (!user) {
        return done(null, false);
      }
      done(null, toPublicUser(user));
    } catch (error) {
      done(error as Error);
    }
  });

  passport.use(
    new LocalStrategy(
      {
        usernameField: "email",
        passwordField: "password",
      },
      async (email, password, done) => {
        try {
          const normalizedEmail = email.trim().toLowerCase();
          const user = await storage.getUserByEmail(normalizedEmail);
          if (!user) {
            return done(null, false, { message: "Неверный email или пароль" });
          }

          if (!user.passwordHash) {
            return done(null, false, {
              message: "Для этого аккаунта включён вход через OAuth-провайдер",
            });
          }

          const isValid = await bcrypt.compare(password, user.passwordHash);
          if (!isValid) {
            return done(null, false, { message: "Неверный email или пароль" });
          }
          const updatedUser = await storage.recordUserActivity(user.id);

          return done(null, toPublicUser(updatedUser ?? user));
        } catch (error) {
          return done(error as Error);
        }
      }
    )
  );

  await applyGoogleAuthStrategy(app);
  await applyYandexAuthStrategy(app);
  app.set("reloadGoogleAuth", () => applyGoogleAuthStrategy(app));
  app.set("reloadYandexAuth", () => applyYandexAuthStrategy(app));
}

export function getSessionUser(req: Request): PublicUser | null {
  return req.user ?? null;
}

async function authenticateWithSession(req: Request): Promise<PublicUser | null> {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return null;
  }

  const user = req.user as PublicUser | undefined;
  if (!user?.id) {
    return null;
  }

  const updatedUser = await storage.recordUserActivity(user.id);
  const safeUser = updatedUser ? toPublicUser(updatedUser) : user;
  req.user = safeUser;

  return safeUser;
}

async function authenticateWithPersonalToken(req: Request): Promise<PublicUser | null> {
  const authorizationHeader = req.headers.authorization;
  if (typeof authorizationHeader !== "string" || authorizationHeader.trim().length === 0) {
    return null;
  }

  const [scheme, ...rest] = authorizationHeader.trim().split(/\s+/);
  if (!scheme || scheme.toLowerCase() !== "bearer") {
    return null;
  }

  const token = rest.join(" ").trim();
  if (token.length === 0) {
    return null;
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const fullUser = await storage.getUserByPersonalApiTokenHash(tokenHash);
  if (!fullUser) {
    return null;
  }

  const updatedUser = await storage.recordUserActivity(fullUser.id);
  const safeUser = toPublicUser(updatedUser ?? fullUser);
  req.user = safeUser;

  return safeUser;
}

async function resolveAuthenticatedUser(req: Request): Promise<PublicUser | null> {
  const existingUser = req.user as PublicUser | undefined;
  if (existingUser?.id) {
    return existingUser;
  }

  const sessionUser = await authenticateWithSession(req);
  if (sessionUser) {
    return sessionUser;
  }

  return await authenticateWithPersonalToken(req);
}

export interface WorkspaceContext {
  active: WorkspaceWithRole;
  memberships: WorkspaceWithRole[];
}

export interface PublicWorkspaceMembership {
  id: string;
  name: string;
  plan: WorkspaceWithRole["plan"];
  role: WorkspaceMemberRole;
}

export function toPublicWorkspaceMembership(workspace: WorkspaceWithRole): PublicWorkspaceMembership {
  return {
    id: workspace.id,
    name: workspace.name,
    plan: workspace.plan,
    role: workspace.role,
  };
}

export async function ensureWorkspaceContext(req: Request, user: PublicUser): Promise<WorkspaceContext> {
  const memberships = await storage.getOrCreateUserWorkspaces(user.id);

  if (memberships.length === 0) {
    console.error(
      `[auth] Не удалось получить рабочие пространства пользователя ${user.id} (${user.email ?? "без email"})`,
    );
    throw new WorkspaceContextError();
  }

  const headerWorkspaceRaw = req.headers["x-workspace-id"];
  const headerWorkspaceId = Array.isArray(headerWorkspaceRaw)
    ? headerWorkspaceRaw[0]
    : typeof headerWorkspaceRaw === "string"
      ? headerWorkspaceRaw.trim()
      : undefined;

  const requestedWorkspaceId = headerWorkspaceId && headerWorkspaceId.length > 0
    ? headerWorkspaceId
    : req.session?.workspaceId;

  let active = requestedWorkspaceId
    ? memberships.find((workspace) => workspace.id === requestedWorkspaceId)
    : undefined;

  if (!active && memberships.length > 0) {
    active = memberships[0];
  }

  if (!active) {
    console.error(
      `[auth] Рабочее пространство не найдено. Пользователь: ${user.id}, доступные рабочие пространства: ${memberships.map((workspace) => workspace.id).join(", ")}`,
    );
    throw new WorkspaceContextError();
  }

  if (req.session) {
    req.session.workspaceId = active.id;
  }

  req.workspaceId = active.id;
  req.workspaceRole = active.role;
  req.workspaceMemberships = memberships;

  return { active, memberships };
}

export function buildSessionResponse(user: PublicUser, context: WorkspaceContext) {
  const active = toPublicWorkspaceMembership(context.active);
  const memberships = context.memberships.map(toPublicWorkspaceMembership);
  return {
    user,
    workspace: {
      active,
      memberships,
    },
  };
}

export function getRequestWorkspace(req: Request): { id: string; role: WorkspaceMemberRole } {
  if (!req.workspaceId || !req.workspaceRole) {
    throw new Error("Рабочее пространство не выбрано");
  }
  return { id: req.workspaceId, role: req.workspaceRole };
}

export function getRequestWorkspaceMemberships(req: Request): WorkspaceWithRole[] {
  return req.workspaceMemberships ?? [];
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await resolveAuthenticatedUser(req);
    if (!user) {
      res.status(401).json({ message: "Требуется авторизация" });
      return;
    }

    await ensureWorkspaceContext(req, user);

    next();
  } catch (error) {
    next(error);
  }
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await resolveAuthenticatedUser(req);
    if (!user) {
      res.status(401).json({ message: "Требуется авторизация" });
      return;
    }

    if (user.role !== "admin") {
      res.status(403).json({ message: "Недостаточно прав" });
      return;
    }

    await ensureWorkspaceContext(req, user);

    next();
  } catch (error) {
    next(error);
  }
}
