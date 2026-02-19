CREATE TABLE `files` (
	`project` text NOT NULL,
	`file_path` text NOT NULL,
	`mtime_ms` real NOT NULL,
	`size` integer NOT NULL,
	`content_hash` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`project`, `file_path`)
);
--> statement-breakpoint
CREATE TABLE `relations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project` text NOT NULL,
	`type` text NOT NULL,
	`src_file_path` text NOT NULL,
	`src_symbol_name` text,
	`dst_file_path` text NOT NULL,
	`dst_symbol_name` text,
	`meta_json` text,
	FOREIGN KEY (`project`,`src_file_path`) REFERENCES `files`(`project`,`file_path`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_relations_src` ON `relations` (`project`,`src_file_path`);--> statement-breakpoint
CREATE INDEX `idx_relations_dst` ON `relations` (`project`,`dst_file_path`);--> statement-breakpoint
CREATE INDEX `idx_relations_type` ON `relations` (`project`,`type`);--> statement-breakpoint
CREATE TABLE `symbols` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project` text NOT NULL,
	`file_path` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`start_line` integer NOT NULL,
	`start_column` integer NOT NULL,
	`end_line` integer NOT NULL,
	`end_column` integer NOT NULL,
	`is_exported` integer DEFAULT 0 NOT NULL,
	`signature` text,
	`fingerprint` text,
	`detail_json` text,
	`content_hash` text NOT NULL,
	`indexed_at` text NOT NULL,
	FOREIGN KEY (`project`,`file_path`) REFERENCES `files`(`project`,`file_path`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_symbols_project_file` ON `symbols` (`project`,`file_path`);--> statement-breakpoint
CREATE INDEX `idx_symbols_project_kind` ON `symbols` (`project`,`kind`);--> statement-breakpoint
CREATE INDEX `idx_symbols_project_name` ON `symbols` (`project`,`name`);--> statement-breakpoint
CREATE INDEX `idx_symbols_fingerprint` ON `symbols` (`project`,`fingerprint`);--> statement-breakpoint
CREATE TABLE `watcher_owner` (
	`id` integer PRIMARY KEY NOT NULL,
	`pid` integer NOT NULL,
	`started_at` text NOT NULL,
	`heartbeat_at` text NOT NULL,
	CONSTRAINT "watcher_owner_singleton" CHECK("watcher_owner"."id" = 1)
);
