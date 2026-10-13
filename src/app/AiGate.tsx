import { useEffect, type JSX, type ReactNode } from "react";
import {
  aiCapability,
  type AiCapability,
} from "../core/ai/capability";
import { useStore } from "./store";
import "../panels/panels.css";

/**
 * M2 Wave C2 — AI capability gate (PLAN-M2 §C2, PRD-M2 §5).
 *
 * Wraps every AI surface (ask, extraction, findings…): children render ONLY
 * when the capability gate passes, so an unconfigured app degrades to this
 * inline setup CTA and `ai_chat` is never invoked without configuration.
 * The CTA opens the same surface as the header's "AI settings" button — the
 * store's `openAiSettings()` (zustand flag), overridable via `onOpenSettings`
 * for panels that wire their own opener.
 *
 * Key presence is fetched once on mount (cached in the store's `aiKeyPresent`
 *); the settings panel refreshes it on every open via the same store action.
 */
export interface AiGateProps {
  /** Rendered only when AI is configured; otherwise replaced by the CTA. */
  children?: ReactNode;
  /** Defaults to the store's openAiSettings() — the App.tsx contract. */
  onOpenSettings?: () => void;
}

/** Store selectors + keyring presence, reduced to the pure gate result. */
export function useAiCapability(): AiCapability {
  const aiSettings = useStore((s) => s.aiSettings);
  const aiKeyPresent = useStore((s) => s.aiKeyPresent);
  useEffect(() => {
    // Fetch once on mount; refreshAiKeyStatus no-ops safely if already known.
    if (useStore.getState().aiKeyPresent === null) {
      void useStore.getState().refreshAiKeyStatus();
    }
  }, []);
  return aiCapability({ aiSettings, keyPresent: aiKeyPresent });
}

export function AiGate(props: AiGateProps): JSX.Element {
  const { configured, reasons } = useAiCapability();
  if (configured) return <>{props.children}</>;
  const openSettings = props.onOpenSettings ?? (() => useStore.getState().openAiSettings());
  return (
    <div className="wl-ai-gate">
      <p className="wl-hint">AI isn&apos;t set up yet — {reasons.join("; ")}.</p>
      <button type="button" className="wl-btn" onClick={openSettings}>
        Set up AI
      </button>
    </div>
  );
}
