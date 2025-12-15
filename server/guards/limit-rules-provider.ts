import type { LimitRule, LimitRulesProvider, OperationContext } from "./types";

class DefaultLimitRulesProvider implements LimitRulesProvider {
  async getRules(_workspaceId: string, _context: OperationContext): Promise<LimitRule[]> {
    return [];
  }
}

export const defaultLimitRulesProvider = new DefaultLimitRulesProvider();
