import type { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import bcrypt from "bcryptjs";
import { pool } from "./db";
import { storage } from "./storage";
import type { PublicUser, User } from "@shared/schema";

const PgSession = connectPgSimple(session);

export function toPublicUser(user: User): PublicUser {
  const { passwordHash, ...safe } = user;
  return safe;
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

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    res.status(401).json({ message: "Требуется авторизация" });
    return;
  }

  try {
    const user = req.user;
    if (user?.id) {
      const updatedUser = await storage.recordUserActivity(user.id);
      if (updatedUser) {
        req.user = toPublicUser(updatedUser);
      }
    }

    next();
  } catch (error) {
    next(error);
  }
}

export function getSessionUser(req: Request): PublicUser | null {
  return req.user ?? null;
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    res.status(401).json({ message: "Требуется авторизация" });
    return;
  }

  const user = req.user;
  if (!user || user.role !== "admin") {
    res.status(403).json({ message: "Недостаточно прав" });
    return;
  }

  next();
}
