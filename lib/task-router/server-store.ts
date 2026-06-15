import type {
  AdvisoryRouteDecision,
  AdvisoryRouteDecisionFilter,
} from "./types";

interface RouteDecisionStore {
  byId: Map<string, AdvisoryRouteDecision>;
}

const g = globalThis as unknown as {
  __shaulaRouteDecisions?: RouteDecisionStore;
};
if (!g.__shaulaRouteDecisions) {
  g.__shaulaRouteDecisions = { byId: new Map() };
}
const store = g.__shaulaRouteDecisions;

export function recordRouteDecision(
  decision: AdvisoryRouteDecision
): AdvisoryRouteDecision {
  store.byId.set(decision.id, decision);
  return decision;
}

export function listRouteDecisions(
  filter: AdvisoryRouteDecisionFilter = {}
): AdvisoryRouteDecision[] {
  const limit = filter.limit ?? 20;
  return [...store.byId.values()]
    .filter((item) => {
      if (filter.agentId !== undefined && item.agentId !== filter.agentId) {
        return false;
      }
      if (filter.route !== undefined && item.route !== filter.route) {
        return false;
      }
      return true;
    })
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

export function latestRouteDecision(
  agentId: string
): AdvisoryRouteDecision | null {
  return listRouteDecisions({ agentId, limit: 1 })[0] ?? null;
}

export function __resetRouteDecisionsForTest(): void {
  store.byId.clear();
}
