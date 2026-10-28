/**
 * Twice-weekly COT (CFTC plan, late 2026): positions as of Monday published Wednesday, and as of Wednesday published
 * Friday. The site's weekly series keeps one row per week, so Monday-dated (mid-week) reports never enter it and
 * lookbacks keep meaning weeks. Historical reports are Tuesday-dated and unaffected.
 */
export const isMidweekReport = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() === 1;
/** The Friday of a report's as-of week, when it is published (Tuesday + 3 days today; Wednesday + 2 after the switch). */
export const releaseFriday = (date: string) => {
  const t = Date.parse(`${date}T00:00:00Z`);
  return new Date(t + ((5 - new Date(t).getUTCDay() + 7) % 7) * 86_400_000).toISOString().slice(0, 10);
};
