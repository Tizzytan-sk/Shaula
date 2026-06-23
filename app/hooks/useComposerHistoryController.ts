"use client";

import {
  useCallback,
  useRef,
  useState,
  type RefObject,
} from "react";

export const INPUT_HISTORY_KEY = "shaula:composer:history:v1";
export const INPUT_HISTORY_LIMIT = 100;

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem">;
type ComposerSetter = (value: string | ((cur: string) => string)) => void;

export function readComposerHistory(
  storage: StorageReader | null | undefined,
  key = INPUT_HISTORY_KEY
): string[] {
  try {
    const raw = storage?.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function addComposerHistoryEntry(
  history: string[],
  text: string,
  limit = INPUT_HISTORY_LIMIT
): string[] {
  const value = text.trim();
  if (!value) return history;
  const withoutDuplicate = history.filter((item) => item !== value);
  return [...withoutDuplicate, value].slice(-limit);
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export interface UseComposerHistoryControllerInput {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  setInput: ComposerSetter;
  getCurrentInput: () => string;
  agentId: string | null | undefined;
  goal: { objective: string } | null | undefined;
  setError: (message: string | null) => void;
  agentAction: (
    agentId: string,
    input: Record<string, unknown>
  ) => Promise<unknown>;
  startGoal: (objective: string) => Promise<void>;
  startWorkflow: (objective: string) => Promise<void>;
  send: () => Promise<void>;
  onSteer: () => Promise<void>;
  onFollowUp: () => Promise<void>;
  storage?: (StorageReader & StorageWriter) | null;
}

export function useComposerHistoryController({
  inputRef,
  setInput,
  getCurrentInput,
  agentId,
  goal,
  setError,
  agentAction,
  startGoal,
  startWorkflow,
  send,
  onSteer,
  onFollowUp,
  storage = getStorage(),
}: UseComposerHistoryControllerInput) {
  const [inputHistory, setInputHistory] = useState<string[]>(() =>
    readComposerHistory(storage)
  );
  const historyCursorRef = useRef<number | null>(null);
  const historyDraftRef = useRef("");

  const rememberComposerInput = useCallback(
    (text: string) => {
      const value = text.trim();
      if (!value) return;
      historyCursorRef.current = null;
      historyDraftRef.current = "";
      setInputHistory((cur) => {
        const next = addComposerHistoryEntry(cur, value);
        try {
          storage?.setItem(INPUT_HISTORY_KEY, JSON.stringify(next));
        } catch {
          /* noop */
        }
        return next;
      });
    },
    [storage]
  );

  const navigateInputHistory = useCallback(
    (direction: "prev" | "next") => {
      if (inputHistory.length === 0) return false;
      const current = inputRef.current;
      if (!current) return false;

      const atStart =
        current.selectionStart === 0 && current.selectionEnd === 0;
      const atEnd =
        current.selectionStart === current.value.length &&
        current.selectionEnd === current.value.length;
      const browsingHistory = historyCursorRef.current != null;
      const currentValue = current.value;
      if (!browsingHistory) {
        if (direction === "prev" && !atStart && currentValue.trim()) return false;
        if (direction === "next" && !atEnd) return false;
      }

      if (historyCursorRef.current == null) {
        historyDraftRef.current = currentValue;
        historyCursorRef.current = inputHistory.length;
      }

      const nextCursor =
        direction === "prev"
          ? Math.max(0, historyCursorRef.current - 1)
          : Math.min(inputHistory.length, historyCursorRef.current + 1);
      historyCursorRef.current = nextCursor;

      const nextValue =
        nextCursor === inputHistory.length
          ? historyDraftRef.current
          : inputHistory[nextCursor];
      setInput(nextValue);
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (!el) return;
        const pos = direction === "prev" ? 0 : el.value.length;
        el.setSelectionRange(pos, pos);
      });
      return true;
    },
    [inputHistory, inputRef, setInput]
  );

  const runGoalCommand = useCallback(
    async (raw: string): Promise<boolean> => {
      const trimmed = raw.trim();
      if (!trimmed.startsWith("/goal")) return false;
      const rest = trimmed.slice("/goal".length).trim();
      if (!rest) {
        setError(goal ? `当前 goal: ${goal.objective}` : "当前没有 active goal");
        setInput("");
        return true;
      }
      if (rest === "pause") {
        if (agentId) {
          await agentAction(agentId, { type: "goal_pause" }).catch(() => {});
        }
        setInput("");
        return true;
      }
      if (rest === "resume") {
        if (agentId) {
          await agentAction(agentId, { type: "goal_resume" }).catch(() => {});
        }
        setInput("");
        return true;
      }
      if (rest === "clear") {
        if (agentId) {
          await agentAction(agentId, { type: "goal_clear" }).catch(() => {});
        }
        setInput("");
        return true;
      }
      rememberComposerInput(raw);
      setInput("");
      await startGoal(rest);
      return true;
    },
    [
      agentAction,
      agentId,
      goal,
      rememberComposerInput,
      setError,
      setInput,
      startGoal,
    ]
  );

  const runWorkflowCommand = useCallback(
    async (raw: string): Promise<boolean> => {
      const trimmed = raw.trim();
      if (!trimmed.startsWith("/workflow")) return false;
      const rest = trimmed.slice("/workflow".length).trim();
      if (!rest) {
        setError("用法：/workflow <目标描述>，将用 dynamic workflow 执行该目标");
        return true;
      }
      rememberComposerInput(raw);
      setInput("");
      await startWorkflow(rest);
      return true;
    },
    [rememberComposerInput, setError, setInput, startWorkflow]
  );

  const sendWithHistory = useCallback(async () => {
    const current = getCurrentInput();
    if (await runGoalCommand(current)) return;
    if (await runWorkflowCommand(current)) return;
    rememberComposerInput(current);
    await send();
  }, [
    getCurrentInput,
    rememberComposerInput,
    runGoalCommand,
    runWorkflowCommand,
    send,
  ]);

  const steerWithHistory = useCallback(async () => {
    rememberComposerInput(getCurrentInput());
    await onSteer();
  }, [getCurrentInput, onSteer, rememberComposerInput]);

  const followUpWithHistory = useCallback(async () => {
    rememberComposerInput(getCurrentInput());
    await onFollowUp();
  }, [getCurrentInput, onFollowUp, rememberComposerInput]);

  const setComposerInput = useCallback(
    (value: string | ((cur: string) => string)) => {
      historyCursorRef.current = null;
      historyDraftRef.current = "";
      setInput(value);
    },
    [setInput]
  );

  return {
    rememberComposerInput,
    navigateInputHistory,
    sendWithHistory,
    steerWithHistory,
    followUpWithHistory,
    setComposerInput,
  };
}
