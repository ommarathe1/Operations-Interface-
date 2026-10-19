# Engineering decisions

## 1. One application, one relational source of truth

The application uses React with Vinext route handlers, deployed as a Cloudflare Worker, with D1 (SQLite) persistence. Drizzle owns the versioned schema; the domain service uses parameterized SQL so the compare-and-set conditions and transaction boundaries remain explicit. No business records live only in browser storage. The framework-independent service accepts a D1-shaped database adapter and is tested against actual SQLite using the same migrations and SQL.

Users, teams, and memberships are separate entities: a user can be a manager in one team and a viewer in another. Work items have one owning team and one accountable assignee. Comments and append-only activity are separate from the current item state. The schema has foreign keys, constrained role/status/priority values, and indexes for team queues, owners, deadlines, and history. Cross-team movement is intentionally outside this version.

Trade-off: a single D1 database is a suitable first implementation, not a demonstration that thousands of simultaneous writers meet a particular latency target. That requires measurement; multi-region write infrastructure would be premature here.

## 2. Platform identity, explicit membership authorization

Sites supplies verified visitor identity. The application preserves the supplied ChatGPT sign-in flow and rejects API requests without identity. The trusted platform must strip/replace identity headers; the raw Worker must never be exposed behind an untrusted proxy that accepts caller-supplied identity headers.

The first authenticated visitor initializes the private workspace and becomes its manager. Later sign-ins create a user record only. Team managers can grant access by email; pending grants bind to the stable authenticated user ID after that email signs in. This is appropriate for an owner-private initial deployment. A shared organizational rollout should explicitly designate the initial owner before opening access. The website's hosting audience and the application's team memberships are independent gates.

Every resource read joins against the current user's membership. Unauthorized item IDs return 404, reducing existence disclosure. Managers can assign and edit team work and review approval requests. Members can create work, claim unassigned work, edit/progress their own work, and comment. Viewers are read-only. Approval requires a manager other than the current assignee. Write statements repeat membership checks in the same database transaction, preventing a role revocation between the initial permission check and the actual write from granting stale access.

Trade-off: administrative role grants are explicit database operations, not outgoing invitations. This implementation sends no emails and does not change the Site's sharing audience.

## 3. Compare-and-set writes with transactional history

Each work item has a monotonically increasing `version`. Changes include the version the client read. An update succeeds only when the stored version still matches; claims also require an empty assignee. Successful updates increment the version once. A losing concurrent operation returns HTTP 409. Item mutation, its activity entry, and its retry receipt are one D1 `batch()` transaction. A failed audit insert rolls back the business update too.

Workflow transitions are server-side rules. A requiring-approval item cannot be directly resolved; it must be submitted and independently reviewed. Editing approval-pending or resolved work is disallowed until it returns to progress or is reopened. Changes clear approval state. The history records before/after fields for edits and both sides of status changes. Comments merge independently and do not increment the business-state version.

The client waits for the server rather than showing speculative ownership or approval. Its queue refreshes every 30 seconds. Detail panels detect newer versions and offer refresh. If an edit is rejected as stale, the draft remains visible; loading the current version is an explicit action.

Trade-off: occasional rejected saves are preferable to silent lost updates. Thirty-second polling is simpler than maintaining live subscription infrastructure in a one-day implementation.

## 4. Request identity prevents accidental duplicates

Creating items, commenting, and changing item state require `Idempotency-Key`. The key is scoped to the authenticated actor and bound to a SHA-256 fingerprint of the action and canonical JSON payload. Successful receipts are stored transactionally. Replaying identical content returns the original item/version. Reusing a key for different content returns 409. A transaction-level receipt guard also prevents concurrent cross-resource reuse from changing two different items.

The browser retries a network failure or server error once with the same key and retains that key for an identical manual retry after an uncertain result. It creates a new key after a successful action. Keys are not an authorization substitute: replay still checks current resource access.

Trade-off: receipts have no expiry in this version, providing clear retry behavior at the cost of storage growth. An eventual retention policy must define a supported retry window. Administrative team-role grants set the same final role on a retry but can record multiple grant audit entries; they do not yet use item-mutation receipts.

## 5. Bounded reads and a deliberate synchronous boundary

Queue filtering, escaped literal search, sorting, counts, and pagination run in SQL. At most 15 items are returned per queue page, 20 events per workspace activity page, and 30 events per item-history page. Item history uses a timestamp-plus-ID cursor to avoid tie-related duplication. Workspace activity and queue pages use bounded offsets with stable tie-breakers. Recent activity is capped at eight rows. Primary actions and their audit trail complete together. There are no external notifications or unreliable fire-and-forget jobs.

Trade-offs: substring search is adequate for the target initial dataset but is not a full-text index. Offset pagination is simple but deeper pages will cost more and can shift under concurrent inserts. Team directory/assignment queries currently return the selected team's members; very large teams need a searchable paginated directory. A next iteration should benchmark representative data, add full-text search, and move large queue/history pages to cursors. If notifications are added, use a transactional outbox, a retrying worker, and deduplication at delivery rather than sending inside the database transaction.
