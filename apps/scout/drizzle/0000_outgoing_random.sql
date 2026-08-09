CREATE TABLE `scout_quota_windows` (
	`client_hash` text NOT NULL,
	`route` text NOT NULL,
	`window_start` integer NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`client_hash`, `route`, `window_start`)
);
--> statement-breakpoint
CREATE INDEX `idx_scout_quota_updated_at` ON `scout_quota_windows` (`updated_at`);
--> statement-breakpoint
PRAGMA optimize;