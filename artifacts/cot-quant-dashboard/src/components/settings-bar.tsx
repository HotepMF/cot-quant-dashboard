import { useState } from "react";
import { Link } from "wouter";
import { ChevronDown } from "lucide-react";
import { defaultSignalSettings } from "@workspace/cot-engine";
import { dismissPreviousModel, previousModel, useSharedSettings } from "@/lib/settings-store";
import type { Settings } from "@/lib/settings-store";
import "./scanner/scanner.css";

const MODEL_KEYS = Object.keys(defaultSignalSettings) as (keyof typeof defaultSignalSettings)[];
const describe = (s: Partial<Settings>) => `${s.signalMode} · ${s.zMethod === "Open Interest Normalization" ? "OI-norm" : "std"} Z · ${s.lookback} wk · Z ${s.zThreshold} · cycle ${s.confluenceThreshold}%`;

/**
 * One compact settings bar for every page: a row of chips, the controls on demand. Explanations live in How it works.
 * `display` adds the chart and table display options used on market detail.
 */
export function SettingsBar({ display = false, id }: { display?: boolean; id?: string }) {
  const [settings, setSettings] = useSharedSettings();
  const [open, setOpen] = useState(false);
  const [previous, setPrevious] = useState(previousModel);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings(s => ({ ...s, [k]: v }));
  const isDefault = MODEL_KEYS.every(k => settings[k] === defaultSignalSettings[k]);
  const closePrevious = () => { dismissPreviousModel(); setPrevious(null); };
  const toggles: [string, keyof Settings][] = [
    ["Z-score detection", "zEnabled"], ["Small trader confirmation", "requireSmall"], ["Large position change", "changeEnabled"],
    ...(display ? [["Extreme labels", "showSignals"], ["Chart label", "showPaneLabel"]] as [string, keyof Settings][] : []),
  ];
  return <section id={id} className="card scan-settings print-hidden" data-testid="settings-bar">
    <button className="scan-settings-head" onClick={() => setOpen(o => !o)} aria-expanded={open} data-testid="button-toggle-settings">
      <span className="eyebrow">Settings</span>
      <span className="scan-rule-chips">
        <b>{settings.signalMode}</b><i>{settings.participant}</i><i data-testid="chip-lookback">{settings.lookback}-week {settings.zMethod === "Open Interest Normalization" ? "OI-norm Z" : "Z"}</i>
        <i>Z {settings.zEnabled ? `≥ ${settings.zThreshold}σ` : "off"}</i><i>cycle {settings.confluenceThreshold}%</i>{settings.requireSmall && <i>small confirm</i>}
        <i className={isDefault ? "sb-default" : "sb-custom"}>{isDefault ? "site default" : "custom"}</i>
      </span>
      <ChevronDown size={15} className={open ? "rot" : ""} />
    </button>
    {previous && <div className="sb-line" data-testid="notice-model">
      The default changed on Oct 27, 2026; you were using {describe(previous)}.{" "}
      <button className="btn sb-btn" onClick={() => { setSettings(s => ({ ...s, ...previous })); closePrevious(); }} data-testid="button-restore-model">Restore mine</button>{" "}
      <button className="btn sb-btn" onClick={closePrevious} data-testid="button-keep-default">Keep the new default</button>
    </div>}
    {!isDefault && !previous && <div className="sb-line sb-custom-line" data-testid="notice-custom">
      You are using your own setting ({describe(settings)}), so these readings differ from what other visitors see. The site default is {describe(defaultSignalSettings)}.{" "}
      <button className="btn sb-btn" onClick={() => setSettings(s => ({ ...s, ...defaultSignalSettings }))} data-testid="button-use-default">Use the site default</button>
    </div>}
    {open && <div className="scan-settings-body" data-testid="settings-body">
      <div className="field"><label htmlFor="s-part">Participant</label><select id="s-part" className="select" value={settings.participant} onChange={e => set("participant", e.target.value)} data-testid="select-participant"><option>Large Traders</option><option>Small Traders</option><option>Commercial Hedgers</option></select></div>
      <div className="field"><label htmlFor="s-mode">Reading mode</label><select id="s-mode" className="select" value={settings.signalMode} onChange={e => set("signalMode", e.target.value)} data-testid="select-signal-mode"><option>Z-Score Only</option><option>COT Confluence</option><option>Both (AND gate)</option></select></div>
      <div className="field"><label htmlFor="s-zm">Z calculation</label><select id="s-zm" className="select" value={settings.zMethod} onChange={e => set("zMethod", e.target.value)} data-testid="select-z-method"><option>Standard Z-Score</option><option>Open Interest Normalization</option></select></div>
      <div className="field"><label htmlFor="s-lb">Lookback · weeks</label><input id="s-lb" className="input mono" type="number" min="3" max="500" value={settings.lookback} onChange={e => set("lookback", Math.max(3, Math.min(500, Number(e.target.value) || 3)))} data-testid="input-lookback" /></div>
      <div className="field"><label htmlFor="s-z">Z threshold · σ</label><input id="s-z" className="input mono" type="number" min="0" max="20" step=".05" value={settings.zThreshold} onChange={e => set("zThreshold", Math.max(0, Math.min(20, Number(e.target.value) || 0)))} data-testid="input-z-threshold" /></div>
      <div className="field"><label htmlFor="s-c">Confluence cycle · %</label><input id="s-c" className="input mono" type="number" min="50" max="95" step="5" value={settings.confluenceThreshold} onChange={e => set("confluenceThreshold", Math.max(50, Math.min(95, Number(e.target.value) || 50)))} data-testid="input-confluence-threshold" /></div>
      <div className="field"><label htmlFor="s-oi">OI move alert · %</label><input id="s-oi" className="input mono" type="number" min="1" max="100" value={settings.oiThreshold} onChange={e => set("oiThreshold", Math.max(1, Math.min(100, Number(e.target.value) || 1)))} data-testid="input-oi-threshold" /></div>
      {display && <div className="field"><label htmlFor="s-hl">Chart highlight</label><select id="s-hl" className="select" value={settings.highlight} onChange={e => set("highlight", e.target.value)} data-testid="select-highlight"><option>Shapes + Background</option><option>Shapes Only</option><option>Background Only</option></select></div>}
      {display && <div className="field"><label htmlFor="s-ts">Table text</label><select id="s-ts" className="select" value={settings.tableSize} onChange={e => set("tableSize", e.target.value)} data-testid="select-table-size">{["Tiny", "Small", "Normal", "Large", "Huge"].map(x => <option key={x}>{x}</option>)}</select></div>}
      <div className="scan-switches">
        {toggles.map(([label, key]) => <label className="switch-row" key={key}><span>{label}</span><input className="switch" type="checkbox" checked={Boolean(settings[key])} onChange={e => set(key, e.target.checked as never)} data-testid={`toggle-${String(key)}`} /></label>)}
      </div>
      <div className="sb-foot">
        <span>{isDefault ? <>Site default · <Link href="/how-it-works/eight-week">what the history shows</Link></> : "Custom settings"} · <Link href="/how-it-works/settings">What each setting does</Link></span>
        {!isDefault && <button className="btn sb-btn" onClick={() => setSettings(s => ({ ...s, ...defaultSignalSettings }))} data-testid="button-reset-model">Reset to the site default</button>}
      </div>
    </div>}
  </section>;
}
