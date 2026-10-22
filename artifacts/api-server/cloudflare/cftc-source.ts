import type { RawRow } from "@workspace/cot-engine";
import type { History, Market, ReportKey } from "./types";

const datasets = { futures: "6dca-aqww", combined: "jun7-fc8e" };
const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
const numeric = (value: unknown) => value == null || value === "" ? Number.NaN : Number(value);
async function query<T>(report: ReportKey, statement: string, token?: string): Promise<T[]> {
  const url = new URL(`https://publicreporting.cftc.gov/api/v3/views/${datasets[report]}/query.json`);
  url.searchParams.set("pageNumber", "1");
  url.searchParams.set("pageSize", "5000");
  url.searchParams.set("query", statement);
  const response = await fetch(url, {
    headers: { Accept: "application/json", ...(token ? { "X-App-Token": token } : {}) },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`CFTC returned HTTP ${response.status}.`);
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new Error("Unexpected official CFTC response.");
  return rows as T[];
}
export async function officialMarkets(report: ReportKey, token?: string) {
  const newest = await query<{ report_date_as_yyyy_mm_dd: string }>(report, "SELECT report_date_as_yyyy_mm_dd ORDER BY report_date_as_yyyy_mm_dd DESC LIMIT 1", token);
  const rawDate = newest[0]?.report_date_as_yyyy_mm_dd;
  if (!rawDate || !Number.isFinite(Date.parse(rawDate))) throw new Error("Official report date is unavailable.");
  const reportAsOf = new Date(rawDate).toISOString().slice(0, 10);
  const rows = await query<{ market_and_exchange_names: string; cftc_contract_market_code: string }>(report,
    `SELECT market_and_exchange_names, cftc_contract_market_code WHERE report_date_as_yyyy_mm_dd = ${quote(`${reportAsOf}T00:00:00.000`)} ORDER BY market_and_exchange_names ASC LIMIT 2000`, token);
  const markets = rows.map(row => ({ name: row.market_and_exchange_names, code: row.cftc_contract_market_code }));
  if (!markets.length || markets.some(m => !m.name || !m.code) || new Set(markets.map(m => m.name)).size !== markets.length
    || new Set(markets.map(m => m.code)).size !== markets.length) {
    throw new Error("The official market list is empty, invalid, or ambiguous.");
  }
  return { reportAsOf, markets };
}
export async function officialHistories(report: ReportKey, reportAsOf: string, markets: Market[], token?: string): Promise<Map<string, History>> {
  // Select by contract code, not name: the CFTC renames contracts (e.g. Feb 2022), and a name filter
  // silently drops every observation published under an earlier name. Results stay keyed by today's name.
  const histories = new Map(markets.map(m => [m.code, new Map<string, RawRow>()]));
  const codes = markets.map(m => quote(m.code)).join(", ");
  const projection = "cftc_contract_market_code, report_date_as_yyyy_mm_dd, noncomm_positions_long_all - noncomm_positions_short_all AS large_traders, comm_positions_long_all - comm_positions_short_all AS commercial_hedgers, nonrept_positions_long_all - nonrept_positions_short_all AS small_traders, open_interest_all AS open_interest";
  for (let page = 0; page < 100; page++) {
    const rows = await query<Record<string, string>>(report,
      `SELECT ${projection} WHERE cftc_contract_market_code IN (${codes}) AND report_date_as_yyyy_mm_dd <= ${quote(`${reportAsOf}T00:00:00.000`)} ORDER BY cftc_contract_market_code ASC, report_date_as_yyyy_mm_dd ASC LIMIT 5000 OFFSET ${page * 5000}`, token);
    for (const row of rows) {
      const history = histories.get(row.cftc_contract_market_code);
      if (!history) throw new Error("CFTC returned a market outside the requested batch.");
      const n = [row.large_traders, row.small_traders, row.commercial_hedgers].map(numeric);
      if (!row.report_date_as_yyyy_mm_dd || !Number.isFinite(Date.parse(row.report_date_as_yyyy_mm_dd)) || !n.every(Number.isFinite)) throw new Error("Invalid official positioning observation.");
      const date = new Date(row.report_date_as_yyyy_mm_dd).toISOString().slice(0, 10);
      const oi = numeric(row.open_interest);
      const parsed: RawRow = { date, large_traders: n[0], small_traders: n[1], commercial_hedgers: n[2], ...(Number.isFinite(oi) ? { open_interest: oi } : {}) };
      const previous = history.get(date);
      if (previous && JSON.stringify(previous) !== JSON.stringify(parsed)) throw new Error("Conflicting official observations for one report date.");
      history.set(date, parsed);
    }
    if (rows.length < 5000) break;
    if (page === 99) throw new Error("CFTC pagination limit reached; refusing an incomplete history.");
  }
  return new Map(markets.map(m => {
    const rows = [...histories.get(m.code)!.values()].sort((a, b) => a.date.localeCompare(b.date));
    if (!rows.length || rows.at(-1)!.date !== reportAsOf) throw new Error("Official batch is missing a current-report observation.");
    return [m.name, { rows, error: null }];
  }));
}
