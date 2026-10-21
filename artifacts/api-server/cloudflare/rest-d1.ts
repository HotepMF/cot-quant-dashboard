import type { Sql } from "./database";

/** Node/GitHub adapter. Each batch is ONE atomic D1 REST batch, never sequential writes. */
export class RestD1 implements Sql {
  private endpoint: string;
  constructor(account: string, database: string, private token: string, private transport: typeof fetch = fetch) {
    if (!/^[a-f0-9]{32}$/i.test(account) || !/^[a-f0-9-]{36}$/i.test(database) || !token) throw new Error("D1 account, database, or credential configuration is missing/invalid.");
    this.endpoint = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`;
  }
  prepare(sql: string): D1PreparedStatement { return new RestStatement(this, sql); }
  async batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    if (!statements.length || statements.length > 40 || statements.some(s => !(s instanceof RestStatement) || s.client !== this)) throw new Error("Invalid D1 batch.");
    const response = await this.transport(this.endpoint, {
      method: "POST", headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ batch: statements.map(s => ({ sql: (s as RestStatement).sql, params: (s as RestStatement).params })) }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`D1 REST request failed (HTTP ${response.status}). Check database access and free-tier quotas.`);
    const body = await response.json() as { success?: boolean; result?: D1Result<T>[] };
    if (!body.success || !Array.isArray(body.result) || body.result.length !== statements.length || body.result.some(r => !r.success || !Array.isArray(r.results))) throw new Error("D1 rejected the atomic batch; no staged update can be committed.");
    return body.result;
  }
}

class RestStatement implements D1PreparedStatement {
  constructor(readonly client: RestD1, readonly sql: string, readonly params: unknown[] = []) {}
  bind(...values: unknown[]): D1PreparedStatement { return new RestStatement(this.client, this.sql, values); }
  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> { return (await this.client.batch<T>([this]))[0]; }
  run<T = Record<string, unknown>>() { return this.all<T>(); }
  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = (await this.all<Record<string, unknown>>()).results[0];
    return row ? (column === undefined ? row : row[column]) as T : null;
  }
  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
    const rows = (await this.all()).results;
    const values = rows.map(r => Object.values(r) as T);
    return options?.columnNames ? [Object.keys(rows[0] ?? {}), ...values] : values;
  }
}
