/**
 * Scheduled events that move futures: official release dates (Federal Reserve, BLS) and expirations computed from
 * exchange rules. Each event lists the CFTC markets it touches and, where we tested it, its effect on daily ranges.
 * The release tables are updated once a year; `CALENDAR_THROUGH` says how far they go.
 */
import { CORE_MARKETS, SPECIALTY_MARKETS } from "./core-markets";

export const CALENDAR_THROUGH = "2027-12-31";

/** NYSE / CME full-day holidays. */
const HOLIDAYS = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);

/** Federal Reserve FOMC calendars: the decision (last) day of each scheduled meeting. */
const FOMC = [
  "2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17", "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09",
  "2027-01-27", "2027-03-17", "2027-04-28", "2027-06-09", "2027-07-28", "2027-09-15", "2027-10-27", "2027-12-08",
];
/** BLS release schedules and archives, 8:30 a.m. ET. */
const CPI = [
  "2026-01-13", "2026-02-13", "2026-03-11", "2026-04-10", "2026-05-12", "2026-06-10", "2026-07-14", "2026-08-12", "2026-09-11", "2026-10-14", "2026-11-10", "2026-12-10",
  "2027-01-13", "2027-02-11", "2027-03-10", "2027-04-13", "2027-05-12", "2027-06-10", "2027-07-14", "2027-08-11", "2027-09-14", "2027-10-14", "2027-11-10", "2027-12-10",
];
const PAYROLLS = [
  "2026-01-09", "2026-02-11", "2026-03-06", "2026-04-03", "2026-05-08", "2026-06-05", "2026-07-02", "2026-08-07", "2026-09-04", "2026-10-02", "2026-11-06", "2026-12-04",
  "2027-01-08", "2027-02-05", "2027-03-05", "2027-04-02", "2027-05-07", "2027-06-04", "2027-07-02", "2027-08-06", "2027-09-03", "2027-10-08", "2027-11-05", "2027-12-03",
];

export type EventKind = "fomc" | "cpi" | "payrolls" | "opex" | "witching" | "roll" | "last-trade" | "first-notice";
export type RangeEffect = { verdict: "wider" | "none"; text: string; es: number | null; nq: number | null };

/**
 * Tested effect on the day's ES / NQ range vs other days in the same volatility regime and weekday, 2002-2026
 * (backtest/regime/daytrader_tests.py). "wider" = passed: |t| >= 2 and the same sign in 2002-2013 and 2014-2026.
 */
export const EVENT_EFFECTS: Partial<Record<EventKind, RangeEffect>> = {
  fomc: { verdict: "wider", es: 19, nq: 12, text: "Ranges on FOMC days have been about 19% wider in ES and 12% wider in NQ" },
  payrolls: { verdict: "wider", es: 20, nq: 19, text: "Ranges on payrolls days have been about 20% wider in ES and 19% wider in NQ" },
  cpi: { verdict: "none", es: null, nq: null, text: "No reliable change in the day's range (ES +6%, not significant)" },
  opex: { verdict: "none", es: null, nq: null, text: "No reliable change in ES / NQ ranges (SPY slightly narrower, −7%)" },
  witching: { verdict: "none", es: null, nq: null, text: "No reliable change in the day's range, despite the reputation" },
  roll: { verdict: "none", es: null, nq: null, text: "No change in ranges during the roll week" },
};

export type MarketEvent = {
  date: string; kind: EventKind; label: string; short: string; time?: string;
  /** CFTC contract codes the event touches. */
  codes: string[];
  effect?: RangeEffect;
};

const codesOf = (groups: string[]) => [...CORE_MARKETS, ...SPECIALTY_MARKETS].filter(m => m.code && groups.includes(m.group)).map(m => m.code!);
/** Macro releases touch the financial futures, plus the rate, crypto and equity lines shown elsewhere on the site. */
const MACRO_CODES = [...codesOf(["volatility", "equities", "metals", "rates", "currencies", "crypto"]),
  "134741", "043607", "020604", "133742", "146022", "045601", "13874A", "209742", "124603"];
const INDEX_CODES = ["13874+", "20974+", "12460+", "239742", "13874A", "209742", "124603"];

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);
export const isBusinessDay = (t: number) => { const wd = new Date(t).getUTCDay(); return wd !== 0 && wd !== 6 && !HOLIDAYS.has(iso(t)); };
const DAY = 86_400_000;

/** Third Friday of the month; the business day before it when the Friday is a holiday. */
export function thirdFriday(y: number, m: number) {
  const first = utc(y, m, 1);
  let t = first + (((5 - new Date(first).getUTCDay()) + 7) % 7 + 14) * DAY;
  while (!isBusinessDay(t)) t -= DAY;
  return t;
}
const lastBusinessDay = (y: number, m: number) => { let t = utc(y, m + 1, 1) - DAY; while (!isBusinessDay(t)) t -= DAY; return t; };
const businessDaysBefore = (t: number, n: number) => { let k = 0; while (k < n) { t -= DAY; if (isBusinessDay(t)) k++; } return t; };

/** NYMEX WTI: the next month's contract stops trading 3 business days before the 25th of this month (4 when the 25th is not a business day). */
export function crudeLastTrade(y: number, m: number) {
  const t25 = utc(y, m, 25);
  return businessDaysBefore(t25, isBusinessDay(t25) ? 3 : 4);
}
/** NYMEX Henry Hub: trading ends 3 business days before the first day of the delivery month. */
export const gasLastTrade = (y: number, m: number) => businessDaysBefore(utc(y, m + 1, 1), 3);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** First notice day (last business day of the month before delivery) for the delivery months that trade actively. */
const FIRST_NOTICE: { symbol: string; codes: string[]; months: number[] }[] = [
  { symbol: "Gold", codes: ["088691"], months: [2, 4, 6, 8, 10, 12] },
  { symbol: "Silver", codes: ["084691"], months: [3, 5, 7, 9, 12] },
  { symbol: "Copper", codes: ["085692"], months: [3, 5, 7, 9, 12] },
  { symbol: "Corn and wheat", codes: ["002602", "001602"], months: [3, 5, 7, 9, 12] },
  { symbol: "Soybeans", codes: ["005602"], months: [1, 3, 5, 7, 8, 9, 11] },
];

/** Every scheduled event between two ISO dates, inclusive, sorted by date. */
export function marketEvents(from: string, to: string): MarketEvent[] {
  const out: MarketEvent[] = [];
  const inRange = (d: string) => d >= from && d <= to;
  for (const d of FOMC) if (inRange(d)) out.push({ date: d, kind: "fomc", label: "FOMC rate decision", short: "FOMC", time: "2:00 pm ET", codes: MACRO_CODES, effect: EVENT_EFFECTS.fomc });
  for (const d of CPI) if (inRange(d)) out.push({ date: d, kind: "cpi", label: "CPI inflation report", short: "CPI", time: "8:30 am ET", codes: MACRO_CODES, effect: EVENT_EFFECTS.cpi });
  for (const d of PAYROLLS) if (inRange(d)) out.push({ date: d, kind: "payrolls", label: "Payrolls (jobs report)", short: "Payrolls", time: "8:30 am ET", codes: MACRO_CODES, effect: EVENT_EFFECTS.payrolls });
  const [fy, fm] = from.split("-").map(Number), [ty, tm] = to.split("-").map(Number);
  // From the month before `from` (a roll or last trade can fall early) through the month of `to`.
  for (let k = -1; k <= (ty - fy) * 12 + (tm - fm); k++) {
    const y = fy + Math.floor((fm - 1 + k) / 12), m = ((fm - 1 + k) % 12 + 12) % 12 + 1;
    const next = m === 12 ? [y + 1, 1] : [y, m + 1];
    const quarterly = m % 3 === 0;
    const tf = thirdFriday(y, m);
    out.push(quarterly
      ? { date: iso(tf), kind: "witching", label: "Quarterly expiration (\"witching\"): index futures and options", short: "Witching", codes: INDEX_CODES, effect: EVENT_EFFECTS.witching }
      : { date: iso(tf), kind: "opex", label: "Monthly options expiration", short: "Opex", codes: INDEX_CODES, effect: EVENT_EFFECTS.opex });
    if (quarterly) out.push({ date: iso(tf - 8 * DAY), kind: "roll", label: `ES / NQ roll to ${MONTHS[(m + 2) % 12]} contracts`, short: "Roll", codes: INDEX_CODES, effect: EVENT_EFFECTS.roll });
    out.push({ date: iso(crudeLastTrade(y, m)), kind: "last-trade", label: `WTI crude ${MONTHS[next[1] - 1]} contract: last trading day`, short: "CL expiry", codes: ["067651"] });
    out.push({ date: iso(gasLastTrade(y, m)), kind: "last-trade", label: `Natural gas ${MONTHS[next[1] - 1]} contract: last trading day`, short: "NG expiry", codes: ["023651"] });
    for (const f of FIRST_NOTICE) if (f.months.includes(next[1])) {
      out.push({ date: iso(lastBusinessDay(y, m)), kind: "first-notice", label: `${f.symbol} ${MONTHS[next[1] - 1]} contract: first notice day`, short: `${f.symbol.split(" ")[0]} FND`, codes: f.codes });
    }
  }
  return out.filter(e => inRange(e.date)).sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
}

export type EventTags = { upcoming: MarketEvent[]; inData: MarketEvent[] };

/**
 * Events touching one market: scheduled in the next 7 days, and inside the week the latest CFTC report covers
 * (the day after the previous report through the report Tuesday).
 */
export function eventTags(code: string, reportDate: string, today: string, events = marketEvents(iso(Date.parse(`${reportDate}T00:00:00Z`) - 6 * DAY), iso(Date.parse(`${today}T00:00:00Z`) + 7 * DAY))): EventTags {
  const touches = events.filter(e => e.codes.includes(code));
  const windowStart = iso(Date.parse(`${reportDate}T00:00:00Z`) - 6 * DAY);
  const horizon = iso(Date.parse(`${today}T00:00:00Z`) + 7 * DAY);
  return {
    upcoming: touches.filter(e => e.date >= today && e.date <= horizon),
    inData: touches.filter(e => e.date >= windowStart && e.date <= reportDate),
  };
}
