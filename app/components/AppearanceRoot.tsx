"use client";

import { useLayoutEffect } from "react";
import {
  applyStoredAppearanceSettings,
  subscribeAppearanceSettings,
} from "@/lib/appearance/settings";

export function AppearanceRoot() {
  useLayoutEffect(() => {
    applyStoredAppearanceSettings();
    return subscribeAppearanceSettings(() => {
      applyStoredAppearanceSettings();
    });
  }, []);

  return null;
}
