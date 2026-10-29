import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { CURVE_CUTOFFS, CURVE_VOL_EFFECT, DEMO_MARKETS, coreMarketByCode, curveGauge, curveKind, curveZone, volGauge, volState } from "@workspace/cot-engine";
import type { CurveRow, CurveSnapshot, CurveZone } from "@workspace/cot-engine";
import "./curve-gauge.css";

/** Dollars per 1.00 price move, for the spread in dollars (contract specs), plus three markets not in that list. */
const POINT_VALUE = new Map<string, number>([...DEMO_MARKETS.map(m => [m.symbol, m.pointValue] as [string, number]), ["VX", 1000], ["NKD", 5], ["DX", 1000]]);
const LABEL = new Map([...coreMarketByCode.values()].map(m => [m.symbol.split(" ")[0], m.label]));
export const curveLabel = (symbol: string) => LABEL.get(symbol) ?? symbol;

export function useCurves() {
  return useQuery({
    queryKey: ["curves"],
    queryFn: async () => {
      const r = await fetch("/api/curves");
      if (r.status === 503) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json() as CurveSnapshot;
    },
    staleTime: 15 * 60_000,
    refetchInterval: 30 * 60_000,
  });
}

const pct = (v: number, digits = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(digits)}%`;
const num = (v: number) => {
  const a = Math.abs(v), d = a === 0 ? 2 : a < 0.01 ? 6 : a < 0.1 ? 4 : a < 1 ? 3 : a < 100 ? 2 : 1;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${a.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
};
const usd = (v: number) => `${v < 0 ? "−" : v > 0 ? "+" : ""}$${Math.round(Math.abs(v)).toLocaleString()}`;
const monthName = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(4, 6)) - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });

export const curveState = (carry: number | null) => carry == null ? "—" : Math.abs(carry) < 0.002 ? "Flat" : carry > 0 ? "Backwardation" : "Contango";
export const zoneText = (z: CurveZone | null) => z === "deep-backwardation" ? "Deep backwardation for this market" : z === "deep-contango" ? "Deep contango for this market" : z === "normal" ? "Within its usual range" : "No history to compare";

/** Half-dial with colored zones (0..1 along the arc) and a needle at `value`. */
function Dial({ value, zones, label, size }: { value: number | null; zones: [number, number, string][]; label: string; size: number }) {
  const w = size, h = size * 0.58, cx = w / 2, cy = h - 6, r = w / 2 - 12;
  const pt = (t: number, rad = r) => [cx - rad * Math.cos(Math.PI * t), cy - rad * Math.sin(Math.PI * t)] as const;
  const arc = (a: number, b: number) => { const [x0, y0] = pt(a), [x1, y1] = pt(b); return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`; };
  // Readings beyond the ends pin just inside them, so the needle never lies on the baseline.
  const [nx, ny] = pt(Math.max(0.04, Math.min(0.96, value ?? 0.5)), r - 10);
  return <svg className="cg-dial" viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={label}>
    {zones.map(([a, b, cls]) => <path key={a} d={arc(a, b)} className={`cg-arc ${cls}`} />)}
    {zones.slice(1).map(([t]) => { const [x0, y0] = pt(t, r - 8), [x1, y1] = pt(t, r + 8); return <line key={t} x1={x0} y1={y0} x2={x1} y2={y1} className="cg-tick" />; })}
    {value != null && <line x1={cx} y1={cy} x2={nx} y2={ny} className="cg-needle" />}
    <circle cx={cx} cy={cy} r={5} className="cg-hub" />
  </svg>;
}

/** Curve dial: left = deep contango, right = deep backwardation, scaled to this market's own 2002-24 history. */
export function CurveDial({ symbol, carry, size = 190 }: { symbol: string; carry: number | null; size?: number }) {
  return <Dial value={curveGauge(symbol, carry)} size={size} label={`Curve gauge: ${curveState(carry)}, ${zoneText(curveZone(symbol, carry)).toLowerCase()}`}
    zones={[[0, 0.2, "cg-contango"], [0.2, 0.8, "cg-normal"], [0.8, 1, "cg-back"]]} />;
}

/** Volatility dial: calm, normal, elevated, extreme, a quarter each (0.25x to 2.25x the 5-year normal). */
export function VolDial({ ratio, size = 190 }: { ratio: number | null | undefined; size?: number }) {
  return <Dial value={volGauge(ratio)} size={size} label={`Volatility gauge: ${volState(ratio)?.label ?? "no reading"}`}
    zones={[[0, 0.25, "cg-v-calm"], [0.25, 0.5, "cg-v-normal"], [0.5, 0.75, "cg-v-elevated"], [0.75, 1, "cg-v-extreme"]]} />;
}

/** Tiny line of the front pair's daily EOD spread (front minus second), with the zero line. */
function SpreadLine({ spread }: { spread: number[] }) {
  // Scaled to the spread's own range so its moves show; the zero line (the backwardation / contango boundary)
  // is drawn only when the spread crossed or touched it.
  const w = 220, h = 46, lo = Math.min(...spread), hi = Math.max(...spread), span = hi - lo || Math.abs(hi) || 1;
  const x = (i: number) => (i / Math.max(1, spread.length - 1)) * w, y = (v: number) => h - 3 - ((v - lo) / span) * (h - 6);
  return <svg className="cg-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
    {lo <= 0 && hi >= 0 && <line x1={0} x2={w} y1={y(0)} y2={y(0)} className="cg-zero" />}
    <polyline points={spread.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")} className={`cg-line ${spread.at(-1)! >= 0 ? "cg-up" : "cg-down"}`} />
  </svg>;
}

function note(row: CurveRow, zone: CurveZone | null) {
  const kind = curveKind(row.symbol);
  if (kind === "volatility") return row.carry != null && row.carry > 0
    ? "VIX futures in backwardation: near-term fear priced above later months. Historically a stress flag for stocks."
    : "VIX futures in contango, the normal calm-market shape.";
  if (kind === "financial") return "For index, rate, currency and crypto futures the curve mostly reflects interest rates and dividends, not supply and demand. We found no volatility effect.";
  if (zone === "deep-backwardation") return `Deep backwardation means tight supply now. In 2002-24 data, commodity volatility over the next 4 weeks ran about ${Math.round(CURVE_VOL_EFFECT.deepBackwardation * 100)}% above a flat curve. Consider wider stops or smaller size.`;
  if (zone === "deep-contango") return `Deep contango means ample supply and full storage. In 2002-24 data, commodity volatility over the next 4 weeks ran about ${Math.round(CURVE_VOL_EFFECT.deepContango * 100)}% above a flat curve.`;
  return "Curve within its usual range for this market: no volatility effect expected from the curve.";
}

/** Market detail: the curve dial, EOD spread with its 3-month line, carry and current volatility. */
export function CurvePanel({ code }: { code?: string }) {
  const query = useCurves();
  const core = code ? coreMarketByCode.get(code) : undefined;
  const symbol = core?.symbol.split(" ")[0];
  if (!symbol || (!CURVE_CUTOFFS[symbol] && symbol !== "LBR")) return null;
  const row = query.data?.markets.find(m => m.symbol === symbol);
  // This market's own settlement date: markets close on different days (holidays, Sunday sessions), so the snapshot's date can be later.
  const asOf = row?.contracts[0]?.date ?? query.data?.asOf;
  const head = <div className="card-head"><div><h2 className="panel-title">Curve &amp; volatility</h2><div className="subtle" style={{ fontSize: 11, marginTop: 4 }}>Backwardation vs contango, and how big moves are now · end of day{asOf ? ` · ${asOf}` : ""}</div></div><span className="cg-label">Measured · not a signal</span></div>;
  if (!row) return <div className="card section cg-card" data-testid="curve-panel">{head}<div className="card-body subtle" style={{ fontSize: 12 }}>{query.isLoading ? "Loading the curve…" : "No curve saved for this market yet. The archive updates each weekday before the open, from the previous day's settlements."}</div></div>;
  const zone = curveZone(symbol, row.carry), [near, far] = row.contracts, pv = POINT_VALUE.get(symbol);
  const vs = volState(row.vol?.ratio);
  // A typical day now: one daily standard deviation, in percent and in dollars per contract at the front price.
  const day = row.vol ? row.vol.now / Math.sqrt(252) : null;
  return <div className="card section cg-card" data-testid="curve-panel">
    {head}
    <div className="card-body cg-body">
      <div className="cg-dials">
        <div className="cg-left">
          <div className="eyebrow cg-dial-title">Curve</div>
          <CurveDial symbol={symbol} carry={row.carry} />
          <div className="cg-ends"><span>Contango</span><span>Backwardation</span></div>
          <div className={`cg-state cg-${zone ?? "none"}`} data-testid="curve-state">{curveState(row.carry)}</div>
          <div className="subtle cg-zone">{zoneText(zone)}</div>
        </div>
        <div className="cg-left">
          <div className="eyebrow cg-dial-title">Volatility</div>
          <VolDial ratio={row.vol?.ratio} />
          <div className="cg-ends"><span>Calm</span><span>Extreme</span></div>
          <div className={`cg-state cg-v-${vs?.state ?? "none"}-text`} data-testid="vol-state">{vs?.label ?? (row.vol ? `${(row.vol.now * 100).toFixed(0)}% a year` : "—")}</div>
          <div className="subtle cg-zone">{vs ? `${row.vol!.ratio!.toFixed(2)}× its usual` : "No 5-year normal to compare"}{day != null ? <> · typical day ±{(day * 100).toFixed(1)}%{pv ? ` (≈ $${Math.round(day * near.close * pv).toLocaleString()})` : ""}</> : null}</div>
          {vs && <div className="cg-meaning">{vs.meaning}</div>}
        </div>
      </div>
      <div className="cg-stats">
        <div className="statline"><span className="subtle">Front · second</span><b className="mono">{monthName(near.month)} {near.close.toLocaleString()} · {monthName(far.month)} {far.close.toLocaleString()}</b></div>
        <div className="statline"><span className="subtle">EOD spread (front − second)</span><b className="mono" data-testid="curve-spread">{row.spread == null ? "—" : num(row.spread)}{row.spread != null && pv ? <span className="subtle"> · {usd(row.spread * pv)} / contract</span> : null}</b></div>
        <div className="statline"><span className="subtle">Carry, per year</span><b className="mono">{row.carry == null ? "—" : pct(row.carry)}</b></div>
        <div className="statline"><span className="subtle">Volatility now (20 days)</span><b className="mono" data-testid="curve-vol">{row.vol ? `${(row.vol.now * 100).toFixed(1)}%` : "—"}{row.vol?.ratio != null ? <span className="subtle"> · {row.vol.ratio.toFixed(2)}× its 5-year normal ({(row.vol.normal! * 100).toFixed(1)}%)</span> : null}</b></div>
        {row.history && <div className="cg-hist">
          <div className="subtle cg-hist-head"><span>Spread, {monthName(row.history.near)} − {monthName(row.history.far)}, last {row.history.dates.length} days</span><span>{num(Math.min(...row.history.spread))} to {num(Math.max(...row.history.spread))}</span></div>
          <SpreadLine spread={row.history.spread} />
        </div>}
        <div className="notice cg-note">{note(row, zone)} <Link href="/how-it-works/market-overview#curve">How we measure it</Link></div>
      </div>
    </div>
  </div>;
}

/** Invisible Hand: markets whose curve is stretched for their own history, plus VIX. */
export function StretchedCurves() {
  const query = useCurves();
  // Commodities only (plus VIX): that is where a stretched curve has come with higher volatility. Financial curves
  // track interest rates, so they sit on the market pages but would only crowd this list.
  const rows = (query.data?.markets ?? []).filter(m => m.symbol === "VX" || (curveKind(m.symbol) === "commodity" && (curveZone(m.symbol, m.carry) ?? "normal") !== "normal"));
  if (!query.data) return null;
  return <section className="card section cg-card" data-testid="stretched-curves">
    <div className="card-head"><div><h2 className="panel-title">Stretched curves</h2><div className="subtle" style={{ fontSize: 11, marginTop: 4 }}>Commodities in deep backwardation or deep contango for their own 2002-24 history, plus VIX · {query.data.asOf}</div></div><span className="cg-label">Measured · not a signal</span></div>
    <div className="card-body"><div className="sx-scroll"><table className="sx-table">
      <thead><tr><th>Market</th><th>Curve</th><th className="num">Spread</th><th className="num">Carry / yr</th><th className="num">Vol now</th><th>Volatility</th><th>Gauge</th></tr></thead>
      <tbody>{rows.map(m => {
        const z = curveZone(m.symbol, m.carry);
        return <tr key={m.symbol} data-testid={`row-curve-${m.symbol}`}>
          <td><span className="sx-tk">{m.symbol}</span> <span className="subtle">{curveLabel(m.symbol)}</span></td>
          <td className={`cg-${z ?? "none"}`}>{z === "normal" || !z ? curveState(m.carry) : z === "deep-backwardation" ? "Deep backwardation" : "Deep contango"}</td>
          <td className="num">{m.spread == null ? "—" : num(m.spread)}</td>
          <td className="num">{m.carry == null ? "—" : pct(m.carry)}</td>
          <td className="num">{m.vol ? `${(m.vol.now * 100).toFixed(0)}%` : "—"}</td>
          <td className={`cg-v-${volState(m.vol?.ratio)?.state ?? "none"}-text`}>{volState(m.vol?.ratio) ? `${volState(m.vol?.ratio)!.label} · ${m.vol!.ratio!.toFixed(2)}×` : "—"}</td>
          <td><CurveDial symbol={m.symbol} carry={m.carry} size={64} /></td>
        </tr>;
      })}</tbody>
    </table></div>
    <div className="chart-foot">Deep = beyond the 20th / 80th percentile of the market's own carry. In commodities, both ends have come with higher volatility (backwardation most). Not a trade filter: it did not improve the COT readings. <Link href="/how-it-works/market-overview#curve">Method</Link></div></div>
  </section>;
}
