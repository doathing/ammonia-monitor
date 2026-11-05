CREATE TABLE `monitor_chunks` (
	`batch_id` text NOT NULL,
	`version` text NOT NULL,
	`ordinal` integer NOT NULL,
	`payload` text NOT NULL,
	PRIMARY KEY(`batch_id`, `version`, `ordinal`)
);
--> statement-breakpoint
CREATE TABLE `monitor_heads` (
	`id` text PRIMARY KEY NOT NULL,
	`version` text NOT NULL,
	`summary` text NOT NULL,
	`created_at` text NOT NULL
);
