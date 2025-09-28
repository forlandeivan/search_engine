import type { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import bcrypt from "bcryptjs";
import { pool } from "./db";
import { storage } from "./storage";
import type { PublicUser, User } from "@shared/schema";
import { createHash } from "crypto";

const PgSession = connectPgSimple(session);

export function toPublicUser(user: User): PublicUser {
  const { passwordHash, personalApiTokenHash, personalApiTokenLastFour, ...safe } = user;
  return {
    ...safe,
    personalApiTokenLastFour: personalApiTokenLastFour ?? null,
    hasPersonalApiToken: Boolean(personalApiTokenHash && personalApiTokenHash.length > 0),
  };
}

export function configureAuth(app: Express) {
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
