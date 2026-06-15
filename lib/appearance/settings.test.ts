import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE_SETTINGS,
  applyAppearanceSettings,
  loadAppearanceSettings,
  normalizeAppearanceSettings,
  saveAppearanceSettings,
} from "./settings";

interface MockStorage {
  store: Map<string, string>;
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

function makeStorage(): MockStorage {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
}

function makeStyleRecorder() {
  const values = new Map<string, string>();
  return {
    values,
    setProperty: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("appearance/settings", () => {
  let storage: MockStorage;
  let style: ReturnType<typeof makeStyleRecorder>;

  beforeEach(() => {
    storage = makeStorage();
    style = makeStyleRecorder();
    vi.stubGlobal("window", {
      localStorage: storage,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
    vi.stubGlobal("document", {
      documentElement: { style },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns defaults when storage is empty", () => {
    expect(loadAppearanceSettings()).toEqual(DEFAULT_APPEARANCE_SETTINGS);
  });

  it("normalizes invalid values independently", () => {
    expect(
      normalizeAppearanceSettings({
        sidebarFontSize: "large",
        assistantAnswerFontSize: "giant",
      })
    ).toEqual({
      sidebarFontSize: "large",
      assistantAnswerFontSize: "standard",
    });
  });

  it("loads a valid stored value", () => {
    storage.store.set(
      APPEARANCE_STORAGE_KEY,
      JSON.stringify({
        sidebarFontSize: "extra-large",
        assistantAnswerFontSize: "comfortable",
      })
    );

    expect(loadAppearanceSettings()).toEqual({
      sidebarFontSize: "extra-large",
      assistantAnswerFontSize: "comfortable",
    });
  });

  it("falls back to defaults for invalid JSON", () => {
    storage.store.set(APPEARANCE_STORAGE_KEY, "not-json{");
    expect(loadAppearanceSettings()).toEqual(DEFAULT_APPEARANCE_SETTINGS);
  });

  it("saves normalized settings and applies independent CSS variables", () => {
    saveAppearanceSettings({
      sidebarFontSize: "large",
      assistantAnswerFontSize: "extra-large",
    });

    expect(JSON.parse(storage.store.get(APPEARANCE_STORAGE_KEY) ?? "{}")).toEqual({
      sidebarFontSize: "large",
      assistantAnswerFontSize: "extra-large",
    });
    expect(style.values.get("--sidebar-font-size")).toBe("15px");
    expect(style.values.get("--assistant-answer-font-size")).toBe("20px");
    expect(style.values.get("--assistant-answer-line-height")).toBe("1.76");
  });

  it("can apply settings without writing storage", () => {
    applyAppearanceSettings({
      sidebarFontSize: "small",
      assistantAnswerFontSize: "large",
    });

    expect(storage.store.has(APPEARANCE_STORAGE_KEY)).toBe(false);
    expect(style.values.get("--sidebar-font-size")).toBe("12px");
    expect(style.values.get("--assistant-answer-font-size")).toBe("18px");
  });
});
