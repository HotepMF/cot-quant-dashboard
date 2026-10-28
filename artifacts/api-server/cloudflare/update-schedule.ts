export const CFTC_TIME_ZONE = "America/New_York";
const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: CFTC_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
function localParts(time: number) {
  const p = Object.fromEntries(formatter.formatToParts(new Date(time)).map(part => [part.type, part.value]));
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute };
}
function localCalendar(time: number) {
  const p = localParts(time);
  return Date.UTC(p.year, p.month - 1, p.day);
}
function zonedTime(calendar: number, hour: number, minute = 0) {
  const desired = calendar + (hour * 60 + minute) * 60_000;
  let result = desired;
  // These scheduled hours do not fall in the ambiguous/missing DST transition hour.
  for (let i = 0; i < 3; i++) {
    const p = localParts(result);
    result += desired - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  }
  return result;
}

/** Tuesday positions corresponding to the most recent expected Friday 15:30 ET release. */
export function expectedReportDate(now: number) {
  const calendar = localCalendar(now);
  const weekday = new Date(calendar).getUTCDay();
  let friday = calendar - ((weekday - 5 + 7) % 7) * 86_400_000;
  if (now < zonedTime(friday, 15, 30)) friday -= 7 * 86_400_000;
  return new Date(friday - 3 * 86_400_000).toISOString().slice(0, 10);
}

export function nextCftcCheck(now: number, reports: (string | null)[], failed = false) {
  const calendar = localCalendar(now);
  const weekday = new Date(calendar).getUTCDay();
  let daily = zonedTime(calendar, 6);
  if (daily <= now) daily = zonedTime(calendar + 86_400_000, 6);
  let fridayCalendar = calendar + ((5 - weekday + 7) % 7) * 86_400_000;
  let friday = zonedTime(fridayCalendar, 15, 30);
  if (friday <= now) friday = zonedTime(fridayCalendar + 7 * 86_400_000, 15, 30);
  // Twice-weekly schedule: a check after the Wednesday 3:30 p.m. release too (one run; the 6 a.m. check backs it up).
  const wednesdayCalendar = calendar + ((3 - weekday + 7) % 7) * 86_400_000;
  let wednesday = zonedTime(wednesdayCalendar, 15, 30);
  if (wednesday <= now) wednesday = zonedTime(wednesdayCalendar + 7 * 86_400_000, 15, 30);
  const expected = expectedReportDate(now);
  const waiting = failed || reports.length !== 2 || reports.some(date => !date || date < expected);
  if (!waiting) return new Date(Math.min(daily, friday, wednesday));
  const p = localParts(now);
  const releaseWindow = weekday === 5 && p.hour * 60 + p.minute >= 15 * 60 + 30 && p.hour < 20;
  const interval = releaseWindow ? 10 * 60_000 : 60 * 60_000;
  const retry = (Math.floor(now / interval) + 1) * interval;
  return new Date(Math.min(daily, friday, wednesday, retry));
}
