import { sqliteTable, text, integer, index, uniqueIndex, primaryKey, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(), name: text("name").notNull(), email: text("email").notNull(),
  color: text("color").notNull().default("violet"), demo: integer("demo").notNull().default(0), createdAt: text("created_at").notNull(),
}, t => [uniqueIndex("users_email_unique").on(t.email)]);
export const workspace = sqliteTable("workspace", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull().references(() => users.id), seeded: integer("seeded").notNull().default(0),
});
export const teams = sqliteTable("teams", {
  id: text("id").primaryKey(), name: text("name").notNull(), description: text("description").notNull(), color: text("color").notNull(),
});
export const memberships = sqliteTable("memberships", {
  teamId: text("team_id").notNull().references(() => teams.id), userId: text("user_id").notNull().references(() => users.id), role: text("role").notNull(),
}, t => [primaryKey({columns:[t.teamId,t.userId]}), index("memberships_user_team").on(t.userId,t.teamId), check("membership_role",sql`${t.role} in ('manager','member','viewer')`)]);
export const invitations = sqliteTable("invitations", {
  teamId: text("team_id").notNull().references(() => teams.id), email: text("email").notNull(), role: text("role").notNull(), createdBy: text("created_by").notNull().references(() => users.id), createdAt: text("created_at").notNull(),
}, t => [primaryKey({columns:[t.teamId,t.email]}), check("invite_role",sql`${t.role} in ('manager','member','viewer')`)]);
export const items = sqliteTable("items", {
  number: integer("number").primaryKey({autoIncrement:true}), id: text("id").notNull().unique(), teamId: text("team_id").notNull().references(() => teams.id),
  title: text("title").notNull(), description: text("description").notNull(), category: text("category").notNull(),
  status: text("status").notNull().default("open"), priority: text("priority").notNull().default("medium"),
  assigneeId: text("assignee_id").references(() => users.id), createdBy: text("created_by").notNull().references(() => users.id),
  dueDate: text("due_date"), requiresApproval: integer("requires_approval").notNull().default(0), approvedBy: text("approved_by").references(() => users.id),
  version: integer("version").notNull().default(1), lastOperation: text("last_operation").notNull(), creationKey: text("creation_key").notNull().unique(),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, t => [index("items_team_status_updated").on(t.teamId,t.status,t.updatedAt),index("items_assignee_status").on(t.assigneeId,t.status),index("items_team_due").on(t.teamId,t.dueDate),
  check("item_status",sql`${t.status} in ('open','in_progress','blocked','awaiting_approval','resolved')`), check("item_priority",sql`${t.priority} in ('critical','high','medium','low')`)]);
export const activity = sqliteTable("activity", {
  id: text("id").primaryKey(), itemId: text("item_id").references(() => items.id), teamId: text("team_id").notNull().references(() => teams.id),
  actorId: text("actor_id").notNull().references(() => users.id), action: text("action").notNull(), message: text("message").notNull(),
  detail: text("detail").notNull().default("{}"), createdAt: text("created_at").notNull(),
}, t => [index("activity_item_created").on(t.itemId,t.createdAt),index("activity_team_created").on(t.teamId,t.createdAt)]);
export const comments = sqliteTable("comments", {
  id: text("id").primaryKey(), itemId: text("item_id").notNull().references(() => items.id), actorId: text("actor_id").notNull().references(() => users.id), body: text("body").notNull(), createdAt: text("created_at").notNull(),
}, t => [index("comments_item_created").on(t.itemId,t.createdAt)]);
export const requests = sqliteTable("requests", {
  actorId: text("actor_id").notNull().references(() => users.id), key: text("key").notNull(), fingerprint: text("fingerprint").notNull(),
  itemId: text("item_id").notNull().references(() => items.id), resultVersion: integer("result_version").notNull(), createdAt: text("created_at").notNull(),
}, t => [primaryKey({columns:[t.actorId,t.key]})]);
