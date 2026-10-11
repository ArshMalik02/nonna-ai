CREATE TABLE `darwin_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`mode` text NOT NULL,
	`search_id` text,
	`agent_id` text NOT NULL,
	`capability_id` text NOT NULL,
	`agent_name` text,
	`idempotency_key` text NOT NULL,
	`status` text NOT NULL,
	`act_request_id` text,
	`thread_id` text,
	`pending` text,
	`outcome` text,
	`seen_messages` integer DEFAULT 0 NOT NULL,
	`replies` text,
	`error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `darwin_runs_idempotency_key_unique` ON `darwin_runs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `darwin_runs_task_idx` ON `darwin_runs` (`task_id`);--> statement-breakpoint
CREATE INDEX `darwin_runs_status_idx` ON `darwin_runs` (`status`);--> statement-breakpoint
CREATE TABLE `darwin_searches` (
	`search_id` text PRIMARY KEY NOT NULL,
	`task_id` text,
	`mode` text NOT NULL,
	`agents` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
