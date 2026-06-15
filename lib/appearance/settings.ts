const STORAGE_KEY = "shaula-appearance-v1";
const CHANGE_EVENT = "shaula-appearance-change";

export type SidebarFontSize = "small" | "standard" | "large" | "extra-large";
export type AssistantAnswerFontSize =
  | "standard"
  | "comfortable"
  | "large"
  | "extra-large";

export interface AppearanceSettings {
  sidebarFontSize: SidebarFontSize;
  assistantAnswerFontSize: AssistantAnswerFontSize;
}

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  sidebarFontSize: "standard",
  assistantAnswerFontSize: "standard",
};

export const SIDEBAR_FONT_SIZE_OPTIONS: Array<{
  value: SidebarFontSize;
  label: string;
  description: string;
}> = [
  { value: "small", label: "小", description: "更紧凑" },
  { value: "standard", label: "标准", description: "默认密度" },
  { value: "large", label: "大", description: "更易读" },
  { value: "extra-large", label: "很大", description: "更远距离" },
];

export const ASSISTANT_ANSWER_FONT_SIZE_OPTIONS: Array<{
  value: AssistantAnswerFontSize;
  label: string;
  description: string;
}> = [
  { value: "standard", label: "标准", description: "默认阅读" },
  { value: "comfortable", label: "舒适", description: "正文更松" },
  { value: "large", label: "大", description: "长回答更清楚" },
  { value: "extra-large", label: "很大", description: "更远距离" },
];

const SIDEBAR_FONT_SIZE_PX: Record<SidebarFontSize, string> = {
  small: "12px",
  standard: "13px",
  large: "15px",
  "extra-large": "17px",
};

const ASSISTANT_ANSWER_FONT_SIZE_PX: Record<AssistantAnswerFontSize, string> = {
  standard: "14px",
  comfortable: "16px",
  large: "18px",
  "extra-large": "20px",
};

const ASSISTANT_ANSWER_LINE_HEIGHT: Record<AssistantAnswerFontSize, string> = {
  standard: "1.7",
  comfortable: "1.72",
  large: "1.74",
  "extra-large": "1.76",
};

function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isSidebarFontSize(value: unknown): value is SidebarFontSize {
  return (
    value === "small" ||
    value === "standard" ||
    value === "large" ||
    value === "extra-large"
  );
}

function isAssistantAnswerFontSize(
  value: unknown
): value is AssistantAnswerFontSize {
  return (
    value === "standard" ||
    value === "comfortable" ||
    value === "large" ||
    value === "extra-large"
  );
}

export function normalizeAppearanceSettings(
  raw: unknown
): AppearanceSettings {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_APPEARANCE_SETTINGS };
  }
  const value = raw as Record<string, unknown>;
  return {
    sidebarFontSize: isSidebarFontSize(value.sidebarFontSize)
      ? value.sidebarFontSize
      : DEFAULT_APPEARANCE_SETTINGS.sidebarFontSize,
    assistantAnswerFontSize: isAssistantAnswerFontSize(
      value.assistantAnswerFontSize
    )
      ? value.assistantAnswerFontSize
      : DEFAULT_APPEARANCE_SETTINGS.assistantAnswerFontSize,
  };
}

export function loadAppearanceSettings(): AppearanceSettings {
  const storage = safeStorage();
  if (!storage) return { ...DEFAULT_APPEARANCE_SETTINGS };
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return { ...DEFAULT_APPEARANCE_SETTINGS };
  try {
    return normalizeAppearanceSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_APPEARANCE_SETTINGS };
  }
}

export function saveAppearanceSettings(settings: AppearanceSettings): void {
  const normalized = normalizeAppearanceSettings(settings);
  const storage = safeStorage();
  if (storage) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      /* quota / privacy mode */
    }
  }
  applyAppearanceSettings(normalized);
  dispatchAppearanceChange();
}

export function applyAppearanceSettings(settings: AppearanceSettings): void {
  if (typeof document === "undefined") return;
  const normalized = normalizeAppearanceSettings(settings);
  const root = document.documentElement;
  root.style.setProperty(
    "--sidebar-font-size",
    SIDEBAR_FONT_SIZE_PX[normalized.sidebarFontSize]
  );
  root.style.setProperty(
    "--assistant-answer-font-size",
    ASSISTANT_ANSWER_FONT_SIZE_PX[normalized.assistantAnswerFontSize]
  );
  root.style.setProperty(
    "--assistant-answer-line-height",
    ASSISTANT_ANSWER_LINE_HEIGHT[normalized.assistantAnswerFontSize]
  );
}

export function applyStoredAppearanceSettings(): AppearanceSettings {
  const settings = loadAppearanceSettings();
  applyAppearanceSettings(settings);
  return settings;
}

export function subscribeAppearanceSettings(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  const onLocalChange = () => listener();
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, onLocalChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onLocalChange);
  };
}

function dispatchAppearanceChange(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    /* noop */
  }
}

export const APPEARANCE_STORAGE_KEY = STORAGE_KEY;
