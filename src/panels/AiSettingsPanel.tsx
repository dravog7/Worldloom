import { useEffect, useState, type JSX, type KeyboardEvent } from "react";
import { PROVIDER_PRESETS, type PresetId } from "../core/ai/client";
import { applyPreset, costPreview, isValidBaseUrl, type AiSettings } from "../core/ai/settings";
import "./panels.css";

/**
 * M2 Wave C1 — AI settings modal (PRD-M2 §1). Thin controlled component in
 * the SearchPalette tradition: committed settings + key-presence status come
 * in as props, side effects (keyring invoke, ai_chat ping) are forwarded to
 * the store. Ephemeral form state (drafts, notices, the pasted key) lives
 * here ONLY — the key field starts empty on every open and is cleared after
 * each save, so key material never reaches the store or any file.
 */
export interface AiSettingsPanelProps {
  open: boolean;
  settings: AiSettings;
  /** null = status not fetched yet / unavailable (non-Tauri dev). */
  keyPresent: boolean | null;
  onClose(): void;
  /** Commit non-secret settings (preset / baseUrl / model / prices). */
  onChange(next: AiSettings): void;
  /** Store the pasted key in the OS keyring; returns ok + error message. */
  onSaveKey(key: string): Promise<{ ok: boolean; error?: string }>;
  /** Ping the provider through the Rust ai_chat proxy. */
  onTestConnection(): Promise<{ ok: boolean; message: string }>;
}

interface Notice {
  ok: boolean;
  text: string;
}

export function AiSettingsPanel(props: AiSettingsPanelProps): JSX.Element | null {
  const { settings } = props;
  const [baseUrlDraft, setBaseUrlDraft] = useState(settings.baseUrl);
  const [modelDraft, setModelDraft] = useState(settings.model);
  const [priceInDraft, setPriceInDraft] = useState(String(settings.priceInputPerM));
  const [priceOutDraft, setPriceOutDraft] = useState(String(settings.priceOutputPerM));
  const [keyDraft, setKeyDraft] = useState("");
  const [keyNotice, setKeyNotice] = useState<Notice | null>(null);
  const [testNotice, setTestNotice] = useState<Notice | null>(null);
  const [busyKey, setBusyKey] = useState(false);
  const [busyTest, setBusyTest] = useState(false);

  // Resync drafts from committed settings each time the panel opens; the key
  // field always starts empty.
  useEffect(() => {
    if (!props.open) return;
    setBaseUrlDraft(settings.baseUrl);
    setModelDraft(settings.model);
    setPriceInDraft(String(settings.priceInputPerM));
    setPriceOutDraft(String(settings.priceOutputPerM));
    setKeyDraft("");
    setKeyNotice(null);
    setTestNotice(null);
  }, [props.open]);

  const requiresKey = PROVIDER_PRESETS[settings.preset]?.requiresKey ?? true;
  const baseUrlValid = isValidBaseUrl(baseUrlDraft);
  const canSaveKey = keyDraft.trim() !== "" && !busyKey;
  const // Test needs a usable endpoint, and a key unless the preset is local.
  canTest = baseUrlValid && (!requiresKey || props.keyPresent === true) && !busyTest;
  const preview = costPreview(settings);

  const onDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      props.onClose();
    }
  };

  const onPresetChange = (id: PresetId): void => {
    const filled = applyPreset(id);
    props.onChange({ ...settings, preset: id, ...filled });
    setBaseUrlDraft(filled.baseUrl);
    setModelDraft(filled.model);
    setTestNotice(null);
  };

  const onBaseUrlChange = (value: string): void => {
    setBaseUrlDraft(value);
    // Only a valid endpoint ever commits (mirrors the Rust-side gate).
    if (isValidBaseUrl(value)) props.onChange({ ...settings, baseUrl: value });
  };

  const commitPrice = (field: "priceInputPerM" | "priceOutputPerM", raw: string): void => {
    if (field === "priceInputPerM") setPriceInDraft(raw);
    else setPriceOutDraft(raw);
    const amount = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(amount) || amount < 0) return;
    props.onChange(
      field === "priceInputPerM"
        ? { ...settings, priceInputPerM: amount }
        : { ...settings, priceOutputPerM: amount },
    );
  };

  const saveKey = async (): Promise<void> => {
    setBusyKey(true);
    const result = await props.onSaveKey(keyDraft.trim());
    setBusyKey(false);
    setKeyDraft(""); // never retained in the field after a save attempt
    setKeyNotice(
      result.ok
        ? { ok: true, text: "key stored in OS keyring" }
        : { ok: false, text: result.error ?? "could not store key" },
    );
  };

  const testConnection = async (): Promise<void> => {
    setBusyTest(true);
    const result = await props.onTestConnection();
    setBusyTest(false);
    setTestNotice({ ok: result.ok, text: result.message });
  };

  if (!props.open) return null;

  return (
    <div className="wl-palette-overlay" onClick={props.onClose}>
      <div
        className="wl-panel wl-settings"
        role="dialog"
        aria-label="AI settings"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onDialogKeyDown}
      >
        <div className="wl-panel-header">ai settings</div>
        <div className="wl-settings-body">
          <label className="wl-field">
            <span className="wl-label">Provider</span>
            <select
              className="wl-select"
              value={settings.preset}
              onChange={(event) => onPresetChange(event.target.value as PresetId)}
            >
              {Object.values(PROVIDER_PRESETS).map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>

          <label className="wl-field">
            <span className="wl-label">Base URL</span>
            <input
              className="wl-filter"
              type="text"
              value={baseUrlDraft}
              placeholder="https://api.example.com/v1"
              onChange={(event) => onBaseUrlChange(event.target.value)}
            />
            {baseUrlDraft !== "" && !baseUrlValid && (
              <span className="wl-error">Must be https (http only for localhost).</span>
            )}
          </label>

          <label className="wl-field">
            <span className="wl-label">Model</span>
            <input
              className="wl-filter"
              type="text"
              list="wl-ai-models"
              value={modelDraft}
              placeholder="model id, e.g. gpt-4o-mini"
              onChange={(event) => {
                setModelDraft(event.target.value);
                props.onChange({ ...settings, model: event.target.value });
              }}
            />
            <datalist id="wl-ai-models">
              {(PROVIDER_PRESETS[settings.preset]?.models ?? []).map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
          </label>

          <div className="wl-settings-row">
            <label className="wl-field">
              <span className="wl-label">
                API key{requiresKey ? "" : " (local provider — not needed)"}
              </span>
              <input
                className="wl-filter"
                type="password"
                autoComplete="off"
                value={keyDraft}
                placeholder={props.keyPresent ? "paste to replace stored key" : "paste your API key"}
                onChange={(event) => setKeyDraft(event.target.value)}
              />
              <span
                className={
                  props.keyPresent === true ? "wl-key-status wl-key-present" : "wl-key-status wl-key-absent"
                }
              >
                {props.keyPresent === true
                  ? "● key present"
                  : props.keyPresent === false
                    ? "○ no key"
                    : "key status unavailable"}
              </span>
            </label>
            <button type="button" className="wl-btn" disabled={!canSaveKey} onClick={() => void saveKey()}>
              Save key
            </button>
          </div>
          {keyNotice && <p className={keyNotice.ok ? "wl-ok" : "wl-error"}>{keyNotice.text}</p>}

          <div className="wl-settings-row">
            <span className="wl-hint">
              {requiresKey && props.keyPresent !== true
                ? "Store a key to enable the connection test."
                : "Sends a one-word ping through the local Rust proxy."}
            </span>
            <button
              type="button"
              className="wl-btn wl-btn-ghost"
              disabled={!canTest}
              onClick={() => void testConnection()}
            >
              {busyTest ? "Testing…" : "Test connection"}
            </button>
          </div>
          {testNotice && <p className={testNotice.ok ? "wl-ok" : "wl-error"}>{testNotice.text}</p>}

          <div className="wl-field">
            <span className="wl-label">cost table — USD per 1M tokens</span>
            <div className="wl-settings-row">
              <label className="wl-field">
                <span className="wl-label">Input $ / 1M</span>
                <input
                  className="wl-filter"
                  type="number"
                  min="0"
                  step="0.01"
                  value={priceInDraft}
                  onChange={(event) => commitPrice("priceInputPerM", event.target.value)}
                />
              </label>
              <label className="wl-field">
                <span className="wl-label">Output $ / 1M</span>
                <input
                  className="wl-filter"
                  type="number"
                  min="0"
                  step="0.01"
                  value={priceOutDraft}
                  onChange={(event) => commitPrice("priceOutputPerM", event.target.value)}
                />
              </label>
            </div>
            <span className="wl-hint">
              Example: a hypothetical 10,000-token input costs ≈ {preview.usd.toFixed(4)} USD at{" "}
              {settings.priceInputPerM} / 1M.
            </span>
          </div>

          <p className="wl-settings-note">
            Your API key is stored in the OS keyring and never touches app files.
          </p>
        </div>
      </div>
    </div>
  );
}
