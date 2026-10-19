# Newtonite Software Engineering Challenge

## Included

- Working full-stack React application and server-side API.
- Durable D1 database with generated schema migrations.
- Multi-team manager/member/viewer authorization.
- Search, filters, sorting, a work dashboard, assignments, workflow, and independent approvals.
- Comments, per-item history, and a workspace activity log.
- Atomic ownership claims, stale-edit protection, duplicate prevention, and transactional audit logging.
- Risk-focused automated tests and `ENGINEERING_DECISIONS.md`.
- README with setup instructions and `KNOWN_LIMITATIONS.md`.

## Suggested demonstration

1. Open Overview. Explain the active, attention, approvals, and resolved counts.
2. Create an Engineering work item and open it from the queue. Claim it, add a comment, and progress it.
3. In two tabs, open the same unassigned item. Claim it in each: one wins, and the other is rejected with a conflict. Refresh to see its current owner.
4. In two tabs, edit the same owned item. Save in tab A; save the stale draft in tab B. The stale save is rejected and the draft remains available until the user explicitly loads the latest version.
5. Open the sample vendor payout or customer data export approval, both owned by another teammate. Approve one and inspect its history. Approval of an item owned by the current manager is prohibited.
6. Open Manage teams to explain team-scoped roles and the access grant flow. Sample teammates are illustrative records, not alternate login credentials.
7. Run the automated tests to demonstrate unauthorized direct-service calls, retries, concurrency, workflow gates, and rollback under an injected audit-write failure.

## Final discussion

- Architecture: see `ENGINEERING_DECISIONS.md` and the README's request path.
- Failure behavior: conflict errors preserve drafts; mutations are transactional; uncertain requests retry with the same key; unexpected failures return a generic 500.
- Assumptions: a private single-company workspace, one accountable owner per work item, team-scoped access, explicit state transitions, and independent approval by another manager.
- Next week: benchmark realistic concurrent traffic, add full-text indexing and cursor-based queues, expand team-directory pagination, and implement an outbox only if notification delivery becomes a requirement.
