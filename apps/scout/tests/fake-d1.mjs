export function createQuotaDatabase(rows = new Map(), options = {}) {
  return {
    rows,
    prepare(query) {
      let values = [];
      const statement = {
        bind(...next) {
          values = next;
          return statement;
        },
        async run() {
          if (options.fail) throw new Error("quota database unavailable");
          if (query.startsWith("DELETE FROM scout_quota_windows")) {
            const cutoff = Number(values[0]);
            for (const [key, value] of rows) {
              if (value.updatedAt < cutoff) rows.delete(key);
            }
          }
          return { success: true };
        },
        async first() {
          if (options.fail) throw new Error("quota database unavailable");
          if (!query.startsWith("INSERT INTO scout_quota_windows")) return null;
          const [clientHash, windowStart, updatedAt] = values;
          const key = `${clientHash}:github:${windowStart}`;
          const previous = rows.get(key);
          const requestCount = (previous?.requestCount ?? 0) + 1;
          rows.set(key, { requestCount, updatedAt: Number(updatedAt) });
          return { request_count: requestCount };
        },
      };
      return statement;
    },
    async batch(statements) {
      if (options.fail) throw new Error("quota database unavailable");
      for (const statement of statements) await statement.run();
      return [];
    },
  };
}
