import type {
  ApprovalRequest,
  ApprovalRequestEvent,
  ApprovalResolvedEvent,
  ApprovalResponse,
} from "./types";

export type ApprovalBrokerEvent =
  | ApprovalRequestEvent
  | ApprovalResolvedEvent;

export interface ApprovalResolutionContext {
  request: ApprovalRequest;
  response: ApprovalResponse;
  resolvedBy: ApprovalResolvedEvent["resolvedBy"];
}

export interface RunApprovalRequestInput {
  request: ApprovalRequest;
  registerPendingApproval: (
    request: ApprovalRequest
  ) => Promise<ApprovalResponse>;
  pushEvent: (event: ApprovalBrokerEvent) => void;
  mapResponse?: (context: ApprovalResolutionContext) => ApprovalResponse;
}

export function inferApprovalResolvedBy(
  request: ApprovalRequest,
  response: ApprovalResponse
): ApprovalResolvedEvent["resolvedBy"] {
  return response.denyReason === undefined &&
    response.decision === request.defaultDecision
    ? "timeout"
    : "user";
}

export function createApprovalResolvedEvent(
  request: ApprovalRequest,
  response: ApprovalResponse,
  resolvedBy = inferApprovalResolvedBy(request, response)
): ApprovalResolvedEvent {
  return {
    type: "approval_resolved",
    id: request.id,
    toolCallId: request.toolCallId,
    decision: response.decision,
    resolvedBy,
    denyReason: response.denyReason,
  };
}

export async function runApprovalRequest({
  request,
  registerPendingApproval,
  pushEvent,
  mapResponse,
}: RunApprovalRequestInput): Promise<ApprovalResponse> {
  pushEvent({ type: "approval_request", request });
  const rawResponse = await registerPendingApproval(request);
  const resolvedBy = inferApprovalResolvedBy(request, rawResponse);
  const response =
    mapResponse?.({ request, response: rawResponse, resolvedBy }) ??
    rawResponse;
  pushEvent(createApprovalResolvedEvent(request, response, resolvedBy));
  return response;
}
