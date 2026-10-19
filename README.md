# Newtonite Operations

A focused full-stack implementation of the **Newtonite Software Engineering Challenge: Operations Under Pressure**. Teams can create, find, own, discuss, progress, and review operational work without losing decisions or overwriting each other's changes.

## Stack

- React 19 with Vinext and TypeScript.
- Server-side route handlers running on Cloudflare Workers.
- Cloudflare D1 (SQLite), Drizzle schema definitions, and committed generated migrations.
- ChatGPT sign-in supplied by Sites; explicit team membership is enforced in the application.
- Node's built-in test runner and real SQLite for domain integration tests.

## Run locally

Prerequisites: **Node.js 22.13+**, Git, and **pnpm 11.25.0** (the exact version is also in `package.json`). Install pnpm using your normal Node package-manager setup if necessary.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm db:migrate:local
pnpm dev
```

Open **http://localhost:5173**. On a clean clone, the starter defaults to its portable execution profile and provides a development-only local sign-in. Open `/login` for the branded sign-in page and choose **Sign in with ChatGPT**. Anonymous workspace requests are routed to `/login`. Signed-in visitors see their current account and can continue to the workspace or switch accounts. Local sign-in uses `Seedy <seedy@sites.test>`. It is restricted to loopback development and is not part of the hosted production authentication flow.

`pnpm build` is required before the first local migration because it emits the Wrangler binding configuration. `db:migrate:local` applies pending committed migrations and records them in Wrangler's local migration ledger; rerunning it is safe. Local and production databases are separate. Subsequent edits usually need only `pnpm dev`; after adding a schema migration, rebuild the binding configuration and run the local migration command again.

The first authenticated visitor initializes the workspace, becomes manager of its three starting teams, and receives illustrative work items and clearly marked sample teammates. All later changes are saved in D1. Later visitors have no access to team records until a manager grants it. Keep initial setup private; do not expose the raw Worker in an environment that accepts untrusted caller-supplied identity headers.

## Checks

```sh
pnpm test
pnpm typecheck
pnpm build
```

The tests execute the actual domain service and migration SQL against fresh SQLite databases. They cover racing ownership claims, lost-update prevention, same-key concurrent retries, cross-resource key reuse, independent approval, authorization, audit rollback, wildcard escaping, bounded queries, history cursors, and membership provisioning. No external services or credentials are needed for tests.

## How to use it

1. Overview shows current work, urgent/blocked/overdue items, pending approvals, resolved work, team workload, and recent activity.
2. Create an item with a title, context, team, category, priority, and optional due date/approval requirement.
3. Open an item to take ownership, assign it, edit it, change status, or post an update.
4. Work progresses from Open to In progress; it can be Blocked. In-progress work can resolve directly when approval is not required, or be submitted for review when it is.
5. Another team manager can approve and resolve submitted work or request changes. An assignee cannot approve their own work. Resolved items can be reopened by a manager.
6. Manage teams lists members and allows managers to add or change roles by email. A colleague needs both Site access and a team role. This action sends no email.

Search supports titles, descriptions, and item references such as `OPS-1001`. Status, priority, team filters, and stable sorting execute on the server. Work queues and history are paginated. `Ctrl/Cmd+K` focuses queue search; `N` opens the create form when you are not typing or inside a dialog. The workspace guide explains the workflow and sample data.

## Permissions

| Action | Manager | Member | Viewer |
| --- | --- | --- | --- |
| Read own team's work and history | Yes | Yes | Yes |
| Create work, claim unassigned work, comment | Yes | Yes | No |
| Edit/progress work | Any item in team | Own assigned items | No |
| Assign/reassign work | Yes | No | No |
| Review approvals | Yes, except own assigned work | No | No |
| Reopen resolved work | Yes | No | No |
| Grant/change team roles | Yes, except own role | No | No |

Membership is checked in backend reads and writes. Hiding a button is only a UI convenience. A person's role can differ between teams.

## API

All routes are under `/api/ops`, require authenticated platform identity, and return `Cache-Control: no-store`. POST requests require JSON and same-origin browser requests.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/bootstrap` | Current actor, authorized teams, counts, recent activity |
| GET | `/items` | Filtered/sorted queue: `view`, `q`, `team`, `status`, `priority`, `sort`, `page` |
| GET | `/items/:id` | Authorized item, assignees, and cursor-paged history (`before`) |
| POST | `/items` | Create an item |
| POST | `/items/:id` | `claim`, `assign`, `edit`, `status`, `approve`, or `reject` action |
| POST | `/items/:id/comments` | Add a comment |
| GET | `/activity` | Paginated authorized activity, optionally filtered by team |
| GET | `/teams/:id` | Authorized team directory and pending access grants |
| POST | `/teams/:id/members` | Manager-only role grant/change |

Item creates, state changes, and comments require a unique `Idempotency-Key` header (12-120 letters, numbers, `_`, or `-`; UUIDs work). Reuse the exact key and payload when retrying an uncertain operation. Item state changes also require `version`, obtained from the latest item read.

```json
{
  "action": "claim",
  "version": 1
}
```

Error responses have `error` and `code`. Relevant statuses: 400 invalid input/key, 401 missing identity, 403 denied action, 404 unavailable resource, 409 stale version/key conflict, and 422 invalid workflow transition. Unexpected errors return a generic 500; internal details stay in server logs.

## Source map

| Path | Responsibility |
| --- | --- |
| `app/page.tsx` | Authenticated server render and initial workspace load |
| `app/login/` | Branded sign-in page, current-account continuation, and account switching |
| `app/workspace.tsx` | Dashboard, filters, forms, detail/history panels, membership UI |
| `app/api/ops/[[...path]]/route.ts` | API authentication, request validation, error boundary |
| `lib/core.mjs` | SQL-backed authorization, workflows, concurrency, idempotency, queries |
| `lib/bootstrap.mjs` | First-user initialization and illustrative seed data |
| `db/schema.ts`, `drizzle/` | Relational model and immutable schema migrations |
| `tests/` | Domain integration and server-render smoke tests |

Requests pass through platform authentication, then the API/domain service, then a D1 transaction. Mutation, activity record, and retry receipt commit together. Primary work does not depend on a notification job or external service.

For trade-offs and next steps, read `ENGINEERING_DECISIONS.md`, `KNOWN_LIMITATIONS.md`, and `SUBMISSION.md`.

## Hosting

The included `.openai/hosting.json` declares the Site identity and logical `DB` binding. Production deployment through Sites provisions D1 and applies the committed migrations before publishing the built Worker. No passwords, API keys, or Git credentials belong in source. The initial deployment is owner-private; opening it to a wider audience is a separate access decision.

The private hosting gateway may require authentication before rendering any application page, including `/login`. The branded page is directly available to allowed signed-in visitors, and its anonymous state also works in portable local development. Authentication is still handled by the platform; no separate password database is introduced.
