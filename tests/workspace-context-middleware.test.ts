import express from "express";
import session from "express-session";
import request from "supertest";
import bcrypt from "bcryptjs";
import { describe, it, expect, beforeAll } from "vitest";
import { storage } from "../server/storage";
import { ensureWorkspaceContextMiddleware, type WorkspaceRequestContext } from "../server/auth";
import type { PublicUser } from "@shared/schema";
import { workspaces } from "@shared/schema";

async function createUser(email: string): Promise<PublicUser> {
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const user = await storage.createUser({
    email,
    fullName: "WorkspaceCtx User",
    firstName: "WorkspaceCtx",
    lastName: "User",
    phone: "",
    passwordHash,
    isEmailConfirmed: true,
  });

  return {
    ...user,
    hasPersonalApiToken: false,
    personalApiTokenLastFour: null,
  };
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

function buildApp(currentUser: PublicUser) {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: "workspace-context-test",
      resave: false,
      saveUninitialized: true,
    }),
  );

  // Stub auth: consider user already authenticated
  app.use((req, _res, next) => {
    req.user = currentUser;
    next();
  });

  app.get(
    "/api/test/workspaces/:workspaceId/probe",
    ensureWorkspaceContextMiddleware({ requireExplicitWorkspaceId: true }),
    (req, res) => {
      const ctx = req.workspaceContext as WorkspaceRequestContext;
      res.json({ workspaceId: ctx.workspaceId, role: ctx.userRole });
    },
  );

  app.post(
    "/api/test/workspace-probe",
    ensureWorkspaceContextMiddleware({ requireExplicitWorkspaceId: true }),
    (req, res) => {
      const ctx = req.workspaceContext as WorkspaceRequestContext;
      res.json({ workspaceId: ctx.workspaceId, role: ctx.userRole });
    },
  );

  app.get(
    "/api/test/legacy/probe",
    ensureWorkspaceContextMiddleware({ allowSessionFallback: true }),
    (req, res) => {
      const ctx = req.workspaceContext as WorkspaceRequestContext;
      res.json({ workspaceId: ctx.workspaceId, role: ctx.userRole });
    },
  );

  app.post("/api/test/session/workspace", (req, res) => {
    req.session.activeWorkspaceId = typeof req.body.workspaceId === "string" ? req.body.workspaceId : undefined;
    res.json({ status: "ok" });
  });

  return app;
}

describe("ensureWorkspaceContextMiddleware", () => {
  let user: PublicUser;
  let workspaceId: string;
  let foreignWorkspaceId: string;

  beforeAll(async () => {
    user = await createUser(`workspace-ctx-${Date.now()}@example.com`);
    workspaceId = `ctx-ws-${Date.now()}`;
    foreignWorkspaceId = `ctx-foreign-${Date.now()}`;
    await createWorkspaceForUser(user.id, workspaceId);

    const otherUser = await createUser(`workspace-ctx-other-${Date.now()}@example.com`);
    await createWorkspaceForUser(otherUser.id, foreignWorkspaceId);
  });

  it("fails with 400 when workspaceId is missing in explicit mode", async () => {
    const app = buildApp(user);
    const agent = request.agent(app);

    const res = await agent.post("/api/test/workspace-probe").send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("workspaceId is required");
  });

  it("fails with 404 when workspace does not exist", async () => {
    const app = buildApp(user);
    const agent = request.agent(app);

    const res = await agent.get(`/api/test/workspaces/missing-ws/probe`);
    expect(res.status).toBe(404);
    expect(res.body.message).toBe("Workspace 'missing-ws' does not exist");
  });

  it("fails with 403 when user is not a member", async () => {
    const app = buildApp(user);
    const agent = request.agent(app);

    const res = await agent.get(`/api/test/workspaces/${foreignWorkspaceId}/probe`);
    expect(res.status).toBe(403);
    expect(res.body.message).toBe("You do not have access to this workspace");
  });

  it("passes and populates workspaceContext when workspaceId is provided and user is a member", async () => {
    const app = buildApp(user);
    const agent = request.agent(app);

    const res = await agent.get(`/api/test/workspaces/${workspaceId}/probe`);
    expect(res.status).toBe(200);
    expect(res.body.workspaceId).toBe(workspaceId);
    expect(res.body.role).toBe("owner");
  });

  it("uses session.activeWorkspaceId in legacy mode", async () => {
    const app = buildApp(user);
    const agent = request.agent(app);

    await agent.post("/api/test/session/workspace").send({ workspaceId });
    const res = await agent.get("/api/test/legacy/probe");

    expect(res.status).toBe(200);
    expect(res.body.workspaceId).toBe(workspaceId);
    expect(res.body.role).toBe("owner");
  });

  it("fails in legacy mode when workspace cannot be resolved", async () => {
    const app = buildApp(user);
    const agent = request.agent(app);

    const res = await agent.get("/api/test/legacy/probe");
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Cannot resolve workspace context");
  });
});
