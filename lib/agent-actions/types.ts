export interface AgentPostActionResult {
  body: Record<string, unknown>;
  status?: number;
}

export function okAction(body: Record<string, unknown>): AgentPostActionResult {
  return { body };
}

export function errorAction(
  error: string,
  status: number
): AgentPostActionResult {
  return { body: { error }, status };
}
