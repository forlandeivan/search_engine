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
      store: new PgSession({ pool }),
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

          return done(null, toPublicUser(user));
        } catch (error) {
          return done(error as Error);
        }
      }
    )
  );
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }

  res.status(401).json({ message: "Требуется авторизация" });
}

export function getSessionUser(req: Request): PublicUser | null {
  return req.user ?? null;
}
