import express from "express";
import session from "express-session";
import request from "supertest";
import bcrypt from "bcryptjs";
import { describe, it, expect, beforeAll, vi, afterEach } from "vitest";
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

function buildApp(currentUser: PublicUser | null, { setUser = true }: { setUser?: boolean } = {}) {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: "workspace-context-test",
      resave: false,
      saveUninitialized: true,
    }),
  );

  if (setUser) {
    app.use((req, _res, next) => {
      req.user = currentUser as PublicUser | null;
      next();
    });
  }

  app.get(
    "/api/test/workspaces/:workspaceId/probe",
    ensureWorkspaceContextMiddleware({ requireExplicitWorkspaceId: true }),
    (req, res) => {
      const ctx = req.workspaceContext as WorkspaceRequestContext;
      res.json({ workspaceId: ctx.workspaceId, role: ctx.role, status: ctx.status });
    },
  );

  app.post(
    "/api/test/workspace-probe",
    ensureWorkspaceContextMiddleware({ requireExplicitWorkspaceId: true }),
    (req, res) => {
      const ctx = req.workspaceContext as WorkspaceRequestContext;
      res.json({ workspaceId: ctx.workspaceId, role: ctx.role, status: ctx.status });
    },
  );

  app.get(
    "/api/test/legacy/probe",
    ensureWorkspaceContextMiddleware({ allowSessionFallback: true }),
    (req, res) => {
      const ctx = req.workspaceContext as WorkspaceRequestContext;
      res.json({ workspaceId: ctx.workspaceId, role: ctx.role, status: ctx.status });
    },
  );

  app.post("/api/test/session/workspace", (req, res) => {
    req.session.activeWorkspaceId = typeof req.body.workspaceId === "string" ? req.body.workspaceId : undefined;
    res.json({ status: "ok" });
  });

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ message: "Internal server error" });
  });

  return app;
}

describe("ensureWorkspaceContextMiddleware", () => {
  let user: PublicUser;
  let workspaceId: string;
  let foreignWorkspaceId: string;
  const spies: Array<() => void> = [];

  beforeAll(async () => {
    user = await createUser(`workspace-ctx-${Date.now()}@example.com`);
    workspaceId = `ctx-ws-${Date.now()}`;
    foreignWorkspaceId = `ctx-foreign-${Date.now()}`;
    await createWorkspaceForUser(user.id, workspaceId);

    const otherUser = await createUser(`workspace-ctx-other-${Date.now()}@example.com`);
    await createWorkspaceForUser(otherUser.id, foreignWorkspaceId);
  });

  afterEach(() => {
    spies.forEach((restore) => restore());
    spies.length = 0;
  });

  it("fails with 400 when workspaceId is missing in explicit mode", async () => {
    const app = buildApp(user);
    const agent = request.agent(app);

    const res = await agent.post("/api/test/workspace-probe").send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Invalid workspaceId");
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

  it("fails with 403 when membership status is blocked", async () => {
    const app = buildApp(user);
    const agent = request.agent(app);
    const spy = vi
      .spyOn(storage, "getWorkspaceMember")
      .mockResolvedValueOnce({
        workspaceId,
        userId: user.id,
        role: "owner",
        createdAt: new Date(),
        updatedAt: new Date(),
        status: "blocked",
      } as any);
    spies.push(() => spy.mockRestore());

    const res = await agent.get(`/api/test/workspaces/${workspaceId}/probe`);
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
    expect(res.body.message).toBe("Invalid workspaceId");
  });

  it("returns 401 when user is not authenticated", async () => {
    const app = buildApp(null, { setUser: false });
    const agent = request.agent(app);
    const res = await agent.get(`/api/test/workspaces/${workspaceId}/probe`);
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Authentication required");
  });

  it("returns 400 for invalid workspaceId", async () => {
    const app = buildApp(user);
    const agent = request.agent(app);
    const res = await agent.get("/api/test/workspaces/%20/probe");
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Invalid workspaceId");
  });

  it("returns 500 when storage throws", async () => {
    const app = buildApp(user);
    const agent = request.agent(app);
    const spy = vi.spyOn(storage, "getWorkspace").mockRejectedValueOnce(new Error("boom"));
    spies.push(() => spy.mockRestore());
    const res = await agent.get(`/api/test/workspaces/${workspaceId}/probe`);
    expect(res.status).toBe(500);
    expect(res.body.message).toBe("Internal server error");
  });
});
