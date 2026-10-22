import { eventTags } from "@workspace/cot-engine";
import type { MarketEvent } from "@workspace/cot-engine";

/** Today's date in New York, where the release times are set. */
export function newYorkToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export const eventDay = (d: string, weekday = true) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { ...(weekday ? { weekday: "short" } : {}), month: "short", day: "numeric", timeZone: "UTC" });
const describe = (e: MarketEvent) => `${e.label}, ${eventDay(e.date)}${e.time ? ` ${e.time}` : ""}${e.effect ? `. ${e.effect.text}.` : ""}`;

/**
 * Scheduled events touching a market: coming in the next 7 days (solid), and inside the week the latest CFTC
 * report covers (outlined, "in data"), so a position change can be read next to the release that happened that week.
 */
export function EventTags({ code, reportDate, today = newYorkToday() }: { code: string; reportDate: string; today?: string }) {
  const { upcoming, inData } = eventTags(code, reportDate, today);
  if (!upcoming.length && !inData.length) return null;
  return <span className="ev-tags">
    {upcoming.map(e => <span key={`u-${e.kind}-${e.date}`} className={`ev-tag up${e.effect?.verdict === "wider" ? " wide" : ""}`} title={describe(e)}>{e.short} {eventDay(e.date).split(",")[0]}</span>)}
    {inData.map(e => <span key={`d-${e.kind}-${e.date}`} className="ev-tag data" title={`In this report's week: ${describe(e)}`}>in data: {e.short} {eventDay(e.date, false)}</span>)}
  </span>;
}
