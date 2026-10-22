import { useState } from "react";
import { Link } from "wouter";
import { defaultSignalSettings } from "@workspace/cot-engine";
import { dismissPreviousModel, previousModel, useSharedSettings } from "@/lib/settings-store";

const describe = (s: Partial<typeof defaultSignalSettings>) =>
  `${s.signalMode} · ${s.zMethod === "Open Interest Normalization" ? "OI-normalized" : "standard"} Z · ${s.lookback} wk · Z ${s.zThreshold} · cycle ${s.confluenceThreshold}%`;

/**
 * Explains the default model and its evidence label; offers returning visitors their previous model once, and a reset
 * to the default whenever the current settings differ from it.
 */
export function ModelNotice() {
  const [settings, setSettings] = useSharedSettings();
  const [previous, setPrevious] = useState(previousModel);
  const isDefault = (Object.keys(defaultSignalSettings) as (keyof typeof defaultSignalSettings)[]).every(k => settings[k] === defaultSignalSettings[k]);
  const close = () => { dismissPreviousModel(); setPrevious(null); };
  return <div className="notice model-notice" data-testid="notice-model">
    <div><b>Site default:</b> {describe(defaultSignalSettings)}. Our best-tested setting so far, labeled <b>Speculation</b>: it led every test we ran but is not validated, and it will be forward-tested in a public demo account (coming soon). <Link href="/how-it-works#model">Why these settings</Link></div>
    {previous && <div style={{ marginTop: 8 }}>
      The default changed in Oct 2026. You were using {describe(previous)}.{" "}
      <button className="btn" onClick={() => { setSettings(s => ({ ...s, ...previous })); close(); }} data-testid="button-restore-model">Restore mine</button>{" "}
      <button className="btn" onClick={close} data-testid="button-keep-default">Keep the new default</button>
    </div>}
    {!previous && !isDefault && <div style={{ marginTop: 8 }}>
      You are using custom settings. <button className="btn" onClick={() => setSettings(s => ({ ...s, ...defaultSignalSettings }))} data-testid="button-reset-model">Reset to the site default</button>
    </div>}
  </div>;
}
