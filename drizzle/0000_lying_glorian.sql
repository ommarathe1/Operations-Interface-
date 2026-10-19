CREATE TABLE `activity` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text,
	`team_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`message` text NOT NULL,
	`detail` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `activity_item_created` ON `activity` (`item_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activity_team_created` ON `activity` (`team_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `comments_item_created` ON `comments` (`item_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `invitations` (
	`team_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`team_id`, `email`),
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invite_role" CHECK("invitations"."role" in ('manager','member','viewer'))
);
--> statement-breakpoint
CREATE TABLE `items` (
	`number` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`team_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`category` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`assignee_id` text,
	`created_by` text NOT NULL,
	`due_date` text,
	`requires_approval` integer DEFAULT 0 NOT NULL,
	`approved_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	`last_operation` text NOT NULL,
	`creation_key` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "item_status" CHECK("items"."status" in ('open','in_progress','blocked','awaiting_approval','resolved')),
	CONSTRAINT "item_priority" CHECK("items"."priority" in ('critical','high','medium','low'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `items_id_unique` ON `items` (`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `items_creation_key_unique` ON `items` (`creation_key`);--> statement-breakpoint
CREATE INDEX `items_team_status_updated` ON `items` (`team_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `items_assignee_status` ON `items` (`assignee_id`,`status`);--> statement-breakpoint
CREATE INDEX `items_team_due` ON `items` (`team_id`,`due_date`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`team_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`team_id`, `user_id`),
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "membership_role" CHECK("memberships"."role" in ('manager','member','viewer'))
);
--> statement-breakpoint
CREATE INDEX `memberships_user_team` ON `memberships` (`user_id`,`team_id`);--> statement-breakpoint
CREATE TABLE `requests` (
	`actor_id` text NOT NULL,
	`key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`item_id` text NOT NULL,
	`result_version` integer NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`actor_id`, `key`),
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`color` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`color` text DEFAULT 'violet' NOT NULL,
	`demo` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `workspace` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`seeded` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
