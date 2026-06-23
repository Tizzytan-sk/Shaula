"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { AgentProgress } from "@/lib/progress/types";
import type { SubagentBatch } from "@/lib/subagents/types";
import type { ForkableUserMessage, SessionInfoLite } from "@/lib/types";
import {
  appendRestoredSubagentBatches,
  createInitialState,
  ctxToMessages,
} from "@/lib/chat-reducer";
import {
  emptyRunner,
  type RunnerKey,
  type RunnerPatch,
  type RunnerState,
} from "@/lib/session-runner";
import { userFacingMessage } from "@/lib/user-facing-error";
import { getElectronApi } from "@/lib/electron-bridge";

type SessionContextMessage = Parameters<typeof ctxToMessages>[0][number];

export interface SessionContextPayload {
  error?: string;
  messages?: SessionContextMessage[];
  subagentBatches?: unknown;
  forkableUserMessages?: unknown;
  progress?: unknown;
}

export function findSessionById(
  sessions: SessionInfoLite[],
  id: string | null
): SessionInfoLite | null {
  if (!id) return null;
  return sessions.find((session) => session.id === id) ?? null;
}

export function shouldReuseLoadedRunner(
  runner: RunnerState | undefined
): boolean {
  return !!runner && !runner.sessionLoading;
}

export function buildRestoredSessionPatch(
  ctx: SessionContextPayload
): Partial<RunnerState> {
  const messages = Array.isArray(ctx.messages) ? ctx.messages : [];
  const subagentBatches = Array.isArray(ctx.subagentBatches)
    ? (ctx.subagentBatches as SubagentBatch[])
    : undefined;

  return {
    chatState: createInitialState(
      appendRestoredSubagentBatches(ctxToMessages(messages), subagentBatches)
    ),
    ...(Array.isArray(ctx.forkableUserMessages)
      ? {
          forkableUserMessages:
            ctx.forkableUserMessages as ForkableUserMessage[],
        }
      : {}),
    ...(ctx.progress ? { progress: ctx.progress as AgentProgress } : {}),
    sessionLoading: false,
  };
}

interface UseSessionSwitchingControllerOptions {
  sessions: SessionInfoLite[];
  selectedId: string | null;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  closeWorkbench: () => void;
  runnersRef: MutableRefObject<Map<RunnerKey, RunnerState>>;
  setRunner: (key: RunnerKey, runner: RunnerState) => void;
  updateRunner: (key: RunnerKey, patch: RunnerPatch) => void;
  switchTo: (key: RunnerKey) => void;
  attachSseFor: (key: RunnerKey, agentId: string) => void;
  setError: (message: string | null) => void;
}

export function useSessionSwitchingController({
  sessions,
  selectedId,
  setSelectedId,
  closeWorkbench,
  runnersRef,
  setRunner,
  updateRunner,
  switchTo,
  attachSseFor,
  setError,
}: UseSessionSwitchingControllerOptions) {
  const selectSessionAndCloseWorkbench = useCallback(
    (id: string) => {
      const target = findSessionById(sessions, id);
      if (target) {
        const key: RunnerKey = target.path;
        if (!runnersRef.current.has(key)) {
          setRunner(key, {
            ...emptyRunner(),
            sessionFile: target.path,
            sessionLoading: true,
          });
        }
        switchTo(key);
      }
      setSelectedId(id);
      closeWorkbench();
    },
    [closeWorkbench, runnersRef, sessions, setRunner, setSelectedId, switchTo]
  );

  useEffect(() => {
    if (!selectedId) return;
    queueMicrotask(() => setError(null));
    const selected = findSessionById(sessions, selectedId);
    if (!selected) return;
    const key: RunnerKey = selected.path;

    const existingRunner = runnersRef.current.get(key);
    if (shouldReuseLoadedRunner(existingRunner)) {
      switchTo(key);
      return;
    }

    if (!existingRunner) {
      setRunner(key, {
        ...emptyRunner(),
        sessionFile: selected.path,
        sessionLoading: true,
      });
    }
    switchTo(key);

    void fetch(`/api/sessions/${selectedId}/context`)
      .then((response) => response.json())
      .then((ctx: SessionContextPayload) => {
        if (ctx.error) {
          updateRunner(key, { sessionLoading: false });
          setError(ctx.error);
          return;
        }
        startTransition(() => {
          updateRunner(key, buildRestoredSessionPatch(ctx));
        });
      })
      .catch((error) => {
        updateRunner(key, { sessionLoading: false });
        setError(userFacingMessage(error, { context: "settings" }));
      });
  }, [runnersRef, selectedId, sessions, setRunner, switchTo, updateRunner, setError]);

  useEffect(() => {
    const api = getElectronApi();
    if (!api?.pet?.onSwitchSession) return;
    const unsub = api.pet.onSwitchSession((sessionId) => {
      const target = findSessionById(sessions, sessionId);
      if (target) setSelectedId(sessionId);
    });
    return unsub;
  }, [sessions, setSelectedId]);

  useEffect(() => {
    const api = getElectronApi();
    if (!api?.pet?.onReconnectSession) return;
    const unsub = api.pet.onReconnectSession((sessionId) => {
      const session = findSessionById(sessions, sessionId);
      if (!session) {
        console.warn("[pet] reconnect requested for unknown session", sessionId);
        return;
      }
      const key: RunnerKey = session.path;
      const runner = runnersRef.current.get(key);
      const agentId = runner?.agentId;
      if (!agentId) {
        console.warn(
          "[pet] reconnect requested but no agentId for session",
          sessionId
        );
        return;
      }
      console.log("[pet] reconnecting SSE for", sessionId, "agentId=", agentId);
      attachSseFor(key, agentId);
    });
    return unsub;
  }, [attachSseFor, runnersRef, sessions]);

  return {
    selectSessionAndCloseWorkbench,
  };
}
