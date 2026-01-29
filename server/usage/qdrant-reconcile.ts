import { db } from "../db";
import { workspaces } from "@shared/schema";
import { storage } from "../storage";
import { getQdrantClient, QdrantConfigurationError } from "../qdrant";
import { updateWorkspaceQdrantUsage, type WorkspaceQdrantUsage } from "./usage-service";

type ReconcileResult = {
  workspaceId: string;
  collectionsCount: number;
  pointsCount: number;
  storageBytes: number;
  updated: boolean;
  error?: string;
};

export async function reconcileWorkspaceQdrantUsage(workspaceId: string): Promise<ReconcileResult> {
  let collections: string[] = [];
  try {
    collections = await storage.listWorkspaceCollections(workspaceId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { workspaceId, collectionsCount: 0, pointsCount: 0, storageBytes: 0, updated: false, error: message };
  }

  if (collections.length === 0) {
    const updated = await updateWorkspaceQdrantUsage(workspaceId, {
      collectionsCount: 0,
      pointsCount: 0,
      storageBytes: 0,
    });
    const { workspaceId: _ignored, ...rest } = updated;
    return { workspaceId, ...rest, updated: true };
  }

  try {
    const client = getQdrantClient();
    let pointsTotal = 0;
    let storageBytesTotal = 0;

    for (const name of collections) {
      try {
        const info = await client.getCollection(name);
        const pointsCount = Number(info?.points_count ?? 0);
        const diskSize = Number(("disk_data_size" in info && typeof info.disk_data_size === "number" ? info.disk_data_size : null) ?? 0);
        pointsTotal += Number.isFinite(pointsCount) ? pointsCount : 0;
        storageBytesTotal += Number.isFinite(diskSize) && diskSize > 0 ? diskSize : 0;
      } catch (collectionError) {
        const message = collectionError instanceof Error ? collectionError.message : String(collectionError);
        console.warn(`[qdrant-reconcile] failed to fetch collection ${name} for workspace ${workspaceId}: ${message}`);
      }
    }

    const updated = await updateWorkspaceQdrantUsage(workspaceId, {
      collectionsCount: collections.length,
      pointsCount: pointsTotal,
      storageBytes: storageBytesTotal,
    });

    const { workspaceId: _ignored, ...rest } = updated;
    return { workspaceId, ...rest, updated: true };
  } catch (error) {
    if (error instanceof QdrantConfigurationError) {
      const message = error.message || "Qdrant не настроен";
      return { workspaceId, collectionsCount: 0, pointsCount: 0, storageBytes: 0, updated: false, error: message };
    }

    const message = error instanceof Error ? error.message : String(error);
    return { workspaceId, collectionsCount: 0, pointsCount: 0, storageBytes: 0, updated: false, error: message };
  }
}

export async function reconcileAllWorkspacesQdrantUsage(): Promise<ReconcileResult[]> {
  const rows = await db.select({ id: workspaces.id }).from(workspaces);
  const results: ReconcileResult[] = [];

  for (const row of rows) {
    const result = await reconcileWorkspaceQdrantUsage(row.id);
    results.push(result);
  }

  return results;
}
