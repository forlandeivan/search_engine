import express from "express";
import session from "express-session";
import request from "supertest";
import bcrypt from "bcryptjs";
import { describe, it, expect } from "vitest";
import { configureAuth, ensureWorkspaceContextMiddleware, type WorkspaceRequestContext } from "../server/auth";
import { registerRoutes } from "../server/routes";
import { storage } from "../server/storage";
import { workspaces } from "@shared/schema";

async function createUser(email: string) {
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const user = await storage.createUser({
    email,
    fullName: "Chat Legacy User",
    firstName: "Chat",
    lastName: "Legacy",
    phone: "",
    passwordHash,
    isEmailConfirmed: true,
  });
  return user;
}

async function createWorkspaceForUser(userId: string, id: string) {
  const [workspace] = await storage.db
    .insert(workspaces)
    .values({
      id,
      name: `Workspace ${id}`,
      ownerId: userId,
    })
    .returning();

  await storage.addWorkspaceMember(id, userId, "owner");
  return workspace;
}

async function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(session({ secret: "chat-legacy", resave: false, saveUninitialized: true }));
  await configureAuth(app);
  // Route from main app already has middleware; register all routes
  await registerRoutes(app);
  return app;
}

describe("legacy chat endpoints workspace fallback", () => {
  it("uses session.activeWorkspaceId when workspaceId is not provided", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    const user = await createUser(`chat-legacy-${Date.now()}@example.com`);
    const workspaceId = `chat-legacy-ws-${Date.now()}`;
    await createWorkspaceForUser(user.id, workspaceId);

    await agent.post("/api/auth/login").send({ email: user.email, password: "Password123!" });
    await agent.post("/api/workspaces/switch").send({ workspaceId });

    const res = await agent.post("/api/chat/sessions").send({ title: "hello" });

    expect(res.status).toBe(201);
    expect(res.body.chat.workspaceId).toBe(workspaceId);
  });

  it("fails when workspaceId is missing everywhere", async () => {
    const app = express();
    app.use(express.json());
    app.use(session({ secret: "chat-legacy", resave: false, saveUninitialized: true }));
    app.use((req, _res, next) => {
      req.user = { id: "user-1" } as any;
      next();
    });
    app.post("/api/chat/sessions/:chatId/messages", ensureWorkspaceContextMiddleware({ allowSessionFallback: true }), (req, res) => {
      const ctx = req.workspaceContext as WorkspaceRequestContext | undefined;
      res.json({ workspaceId: ctx?.workspaceId ?? null });
    });

    const res = await request(app).post("/api/chat/sessions/1/messages").send({ content: "hi" });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Cannot resolve workspace context");
  });
});
