const WINDOW_MS = 600_000;
const WINDOW_MAX = 3;

type Statement = {
  bind(...values: unknown[]): Statement;
  run(): Promise<unknown>;
  first<T>(): Promise<T | null>;
};

export type QuotaDatabase = {
  prepare(query: string): Statement;
  batch(statements: Statement[]): Promise<unknown>;
};

const initialized = new WeakMap<object, Promise<void>>();

async function initialize(db: QuotaDatabase) {
  let pending = initialized.get(db as object);
  if (!pending) {
    pending = db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS scout_quota_windows (
        client_hash TEXT NOT NULL,
        route TEXT NOT NULL,
        window_start INTEGER NOT NULL,
        request_count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (client_hash, route, window_start)
      )`),
      db.prepare(
        "CREATE INDEX IF NOT EXISTS idx_scout_quota_updated_at ON scout_quota_windows (updated_at)",
      ),
      db.prepare("PRAGMA optimize"),
    ]).then(() => undefined);
    initialized.set(db as object, pending);
  }
  await pending;
}

async function hashClient(client: string, secret: string) {
  const bytes = new TextEncoder().encode(`${secret}:${client}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function consumeQuota(
  db: QuotaDatabase,
  client: string,
  secret: string,
  now = Date.now(),
) {
  await initialize(db);
  const clientHash = await hashClient(client, secret);
  const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;

  await db
    .prepare("DELETE FROM scout_quota_windows WHERE updated_at < ?")
    .bind(now - WINDOW_MS * 2)
    .run();

  const row = await db
    .prepare(`INSERT INTO scout_quota_windows
      (client_hash, route, window_start, request_count, updated_at)
      VALUES (?, 'github', ?, 1, ?)
      ON CONFLICT (client_hash, route, window_start)
      DO UPDATE SET
        request_count = scout_quota_windows.request_count + 1,
        updated_at = excluded.updated_at
      RETURNING request_count`)
    .bind(clientHash, windowStart, now)
    .first<{ request_count: number }>();

  if (!row || !Number.isInteger(row.request_count)) {
    throw new Error("The durable quota ledger did not return a count.");
  }

  return row.request_count > WINDOW_MAX
    ? Math.max(1, Math.ceil((windowStart + WINDOW_MS - now) / 1000))
    : 0;
}
