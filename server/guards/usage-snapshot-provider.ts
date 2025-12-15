import { getWorkspaceUsageSnapshot, type UsageSnapshot } from "../usage/usage-service";
import type { UsageSnapshotProvider } from "./types";

class DefaultUsageSnapshotProvider implements UsageSnapshotProvider<UsageSnapshot> {
  async getSnapshot(workspaceId: string): Promise<UsageSnapshot> {
    return getWorkspaceUsageSnapshot(workspaceId);
  }
}

export const defaultUsageSnapshotProvider = new DefaultUsageSnapshotProvider();
export type { UsageSnapshot };
