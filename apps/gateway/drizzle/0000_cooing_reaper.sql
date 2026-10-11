CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`asked_member_id` text NOT NULL,
	`question` text NOT NULL,
	`decision` text,
	`decided_at` integer,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`asked_member_id`) REFERENCES `circle_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`task_id` text,
	`detail` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `circle_members` (
	`id` text PRIMARY KEY NOT NULL,
	`elder_id` text NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`imessage_handle` text,
	`relation` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`can_approve` integer DEFAULT false NOT NULL,
	`can_pay` integer DEFAULT false NOT NULL,
	`is_nearby` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`elder_id`) REFERENCES `elders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `circle_elder_idx` ON `circle_members` (`elder_id`);--> statement-breakpoint
CREATE INDEX `circle_phone_idx` ON `circle_members` (`phone`);--> statement-breakpoint
CREATE INDEX `circle_handle_idx` ON `circle_members` (`imessage_handle`);--> statement-breakpoint
CREATE TABLE `elders` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`address` text,
	`timezone` text DEFAULT 'America/Los_Angeles' NOT NULL,
	`language` text DEFAULT 'en' NOT NULL,
	`preferences` text,
	`care_notes` text,
	`consent_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `elders_phone_unique` ON `elders` (`phone`);--> statement-breakpoint
CREATE TABLE `family_groups` (
	`dial_group_id` text PRIMARY KEY NOT NULL,
	`elder_id` text NOT NULL,
	`omb_channel_id` text,
	`confirmed_at` integer,
	FOREIGN KEY (`elder_id`) REFERENCES `elders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `inbound_events` (
	`dial_event_id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`fire_at` integer NOT NULL,
	`channel` text NOT NULL,
	`text` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `task_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`executor` text NOT NULL,
	`darwin_search_id` text,
	`darwin_thread_id` text,
	`dial_call_id` text,
	`status` text NOT NULL,
	`result` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`elder_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`summary` text NOT NULL,
	`owner_bot` text,
	`priority` integer DEFAULT 0 NOT NULL,
	`due_at` integer,
	`omb_thread_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`elder_id`) REFERENCES `elders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tasks_elder_status_idx` ON `tasks` (`elder_id`,`status`);