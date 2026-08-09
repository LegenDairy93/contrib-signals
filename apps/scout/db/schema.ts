import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const scoutQuotaWindows = sqliteTable(
  "scout_quota_windows",
  {
    clientHash: text("client_hash").notNull(),
    route: text("route").notNull(),
    windowStart: integer("window_start").notNull(),
    requestCount: integer("request_count").notNull().default(0),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.clientHash, table.route, table.windowStart] }),
    index("idx_scout_quota_updated_at").on(table.updatedAt),
  ],
);
