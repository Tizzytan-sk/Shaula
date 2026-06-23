export interface AgentEventBufferEntry<TEvent> {
  seq: number;
  event: TEvent;
}

export interface AgentEventBufferState<TEvent> {
  events: Array<AgentEventBufferEntry<TEvent> | undefined>;
  nextSeq: number;
  listeners: Set<() => void>;
}

export const DEFAULT_AGENT_EVENT_BUFFER_SIZE = 5000;

export function createAgentEventBuffer<TEvent>(
  capacity = DEFAULT_AGENT_EVENT_BUFFER_SIZE
): AgentEventBufferState<TEvent> {
  return {
    events: new Array(capacity),
    nextSeq: 0,
    listeners: new Set(),
  };
}

export function appendAgentEventBufferEntry<TEvent>(
  state: AgentEventBufferState<TEvent>,
  event: TEvent
): number {
  const seq = state.nextSeq++;
  if (state.events.length === 0) {
    state.events.length = DEFAULT_AGENT_EVENT_BUFFER_SIZE;
  }
  state.events[seq % state.events.length] = { seq, event };
  return seq;
}

export function getAgentEventsSince<TEvent>(
  state: AgentEventBufferState<TEvent>,
  sinceSeq: number
): Array<AgentEventBufferEntry<TEvent>> {
  const out: Array<AgentEventBufferEntry<TEvent>> = [];
  for (const entry of state.events) {
    if (entry && entry.seq > sinceSeq) out.push(entry);
  }
  out.sort((a, b) => a.seq - b.seq);
  return out;
}

export function getLatestAgentEventSeq<TEvent>(
  state: AgentEventBufferState<TEvent>
): number {
  return state.nextSeq - 1;
}

export function notifyAgentEventListeners<TEvent>(
  state: AgentEventBufferState<TEvent>
): void {
  for (const listener of state.listeners) listener();
}

export function subscribeAgentEvent<TEvent>(
  state: AgentEventBufferState<TEvent>,
  cb: () => void
): () => void {
  state.listeners.add(cb);
  return () => {
    state.listeners.delete(cb);
  };
}
