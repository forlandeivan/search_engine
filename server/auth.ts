import type { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Strategy as GoogleStrategy, type Profile as GoogleProfile, type VerifyCallback } from "passport-google-oauth20";
import bcrypt from "bcryptjs";
import { pool } from "./db";
import { storage } from "./storage";
import type { PublicUser, User } from "@shared/schema";
import { createHash } from "crypto";

declare module "express-session" {
  interface SessionData {
    oauthRedirectTo?: string;
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

type GoogleAuthSettings = {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  isEnabled: boolean;
  source: "database" | "environment";
};

const googleStrategyName = "google";
let loggedMissingGoogleConfig = false;

async function resolveGoogleAuthSettings(): Promise<GoogleAuthSettings> {
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
              message: "Для этого аккаунта включён вход через Google",
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
  app.set("reloadGoogleAuth", () => applyGoogleAuthStrategy(app));
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

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await resolveAuthenticatedUser(req);
    if (!user) {
      res.status(401).json({ message: "Требуется авторизация" });
      return;
    }

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

    next();
  } catch (error) {
    next(error);
  }
}
