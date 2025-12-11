import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import express from "express";
import type { Server } from "http";
import { configureAuth } from "../server/auth";
import { registerRoutes } from "../server/routes";
import { storage } from "../server/storage";
import { workspaces } from "@shared/schema";

async function createTestServer(): Promise<Server> {
  const app = express();
  app.set("trust proxy", 1);
  const bodyLimit = process.env.BODY_SIZE_LIMIT?.trim() ?? "50mb";
  app.use(express.json({ limit: bodyLimit }));
  app.use(express.urlencoded({ extended: false, limit: bodyLimit }));
  await configureAuth(app);
  return await registerRoutes(app);
}

async function createTestUser(email: string, password: string) {
  const passwordHash = await bcrypt.hash(password, 10);
  return await storage.createUser({
    email,
    fullName: "Switch User",
    firstName: "Switch",
    lastName: "User",
    phone: "",
    passwordHash,
    isEmailConfirmed: true,
  });
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

let server: Server;

beforeEach(async () => {
  server = await createTestServer();
  await storage.db.execute(sql`DELETE FROM users WHERE email LIKE 'switch-test-%'`);
});

afterEach(async () => {
  await storage.db.execute(sql`DELETE FROM users WHERE email LIKE 'switch-test-%'`);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("POST /api/workspaces/switch", () => {
  it("stores activeWorkspaceId in session for member workspace", async () => {
    const email = `switch-test-${Date.now()}@example.com`;
    const password = "Password123!";

    const user = await createTestUser(email, password);
    await storage.ensurePersonalWorkspace(user);

    const targetWorkspaceId = `ws-switch-${Date.now()}`;
    await createWorkspaceForUser(user.id, targetWorkspaceId);

    const agent = request.agent(server);
    const loginRes = await agent.post("/api/auth/login").send({ email, password });
    expect(loginRes.status).toBe(200);

    const switchRes = await agent.post("/api/workspaces/switch").send({ workspaceId: targetWorkspaceId });
    expect(switchRes.status).toBe(200);
    expect(switchRes.body.workspaceId).toBe(targetWorkspaceId);
    expect(switchRes.body.status).toBe("ok");

    const sessionRes = await agent.get("/api/auth/session");
    expect(sessionRes.status).toBe(200);
    expect(sessionRes.body.activeWorkspaceId).toBe(targetWorkspaceId);
  });

  it("returns 404 for unknown workspace", async () => {
    const email = `switch-test-${Date.now()}@example.com`;
    const password = "Password123!";

    const user = await createTestUser(email, password);
    await storage.ensurePersonalWorkspace(user);

    const agent = request.agent(server);
    await agent.post("/api/auth/login").send({ email, password });

    const missingId = "non-existent-workspace";
    const res = await agent.post("/api/workspaces/switch").send({ workspaceId: missingId });

    expect(res.status).toBe(404);
    expect(res.body.message).toBe(`Workspace '${missingId}' does not exist`);
  });

  it("returns 403 when user is not a member", async () => {
    const email = `switch-test-${Date.now()}@example.com`;
    const password = "Password123!";

    const user = await createTestUser(email, password);
    await storage.ensurePersonalWorkspace(user);

    const otherUser = await createTestUser(`switch-test-other-${Date.now()}@example.com`, password);
    const foreignWorkspaceId = `ws-foreign-${Date.now()}`;
    await createWorkspaceForUser(otherUser.id, foreignWorkspaceId);

    const agent = request.agent(server);
    await agent.post("/api/auth/login").send({ email, password });

    const res = await agent.post("/api/workspaces/switch").send({ workspaceId: foreignWorkspaceId });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe("You do not have access to this workspace");
  });

  it("returns 400 when workspaceId is missing", async () => {
    const email = `switch-test-${Date.now()}@example.com`;
    const password = "Password123!";

    const user = await createTestUser(email, password);
    await storage.ensurePersonalWorkspace(user);

    const agent = request.agent(server);
    await agent.post("/api/auth/login").send({ email, password });

    const res = await agent.post("/api/workspaces/switch").send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("workspaceId is required");
  });
});
