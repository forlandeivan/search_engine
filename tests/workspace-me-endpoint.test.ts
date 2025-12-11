import express from "express";
import session from "express-session";
import request from "supertest";
import bcrypt from "bcryptjs";
import { beforeAll, describe, expect, it } from "vitest";
import { storage } from "../server/storage";
import { ensureWorkspaceContextMiddleware } from "../server/auth";
import type { PublicUser } from "@shared/schema";
import { workspaces } from "@shared/schema";

async function createUser(email: string): Promise<PublicUser> {
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const user = await storage.createUser({
    email,
    fullName: "WorkspaceMe User",
    firstName: "WorkspaceMe",
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

async function createWorkspaceForUser(userId: string, id: string, role: "owner" | "manager" | "user") {
  const [workspace] = await (storage as any).db
    .insert(workspaces)
    .values({
      id,
      name: `Workspace ${id}`,
      ownerId: userId,
    })
    .returning();

  await storage.addWorkspaceMember(id, userId, role);
  return workspace;
}

function buildApp(currentUser: PublicUser) {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: "workspace-me-test",
      resave: false,
      saveUninitialized: true,
    }),
  );

  app.use((req, _res, next) => {
    req.user = currentUser;
    next();
  });

  app.get(
    "/api/workspaces/:workspaceId/me",
    ensureWorkspaceContextMiddleware({ requireExplicitWorkspaceId: true }),
    (req, res) => {
      if (!req.workspaceContext) {
        return res.status(500).json({ message: "Internal server error" });
      }
      const ctx = req.workspaceContext;
      res.json({
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        role: ctx.role,
        status: ctx.status,
      });
    },
  );

  return app;
}

describe("GET /api/workspaces/:workspaceId/me", () => {
  let owner: PublicUser;
  let manager: PublicUser;
  let workspaceId: string;

  beforeAll(async () => {
    owner = await createUser(`workspace-me-owner-${Date.now()}@example.com`);
    manager = await createUser(`workspace-me-manager-${Date.now()}@example.com`);
    workspaceId = `workspace-me-${Date.now()}`;
    await createWorkspaceForUser(owner.id, workspaceId, "owner");
    await storage.addWorkspaceMember(workspaceId, manager.id, "manager");
  });

  it("returns role/status for active member", async () => {
    const app = buildApp(manager);
    const res = await request(app).get(`/api/workspaces/${workspaceId}/me`);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("manager");
    expect(res.body.status).toBe("active");
    expect(res.body.workspaceId).toBe(workspaceId);
    expect(res.body.userId).toBe(manager.id);
  });

  it("returns 403 for non-member", async () => {
    const stranger = await createUser(`workspace-me-stranger-${Date.now()}@example.com`);
    const app = buildApp(stranger);
    const res = await request(app).get(`/api/workspaces/${workspaceId}/me`);
    expect(res.status).toBe(403);
    expect(res.body.message).toBe("You do not have access to this workspace");
  });
});
