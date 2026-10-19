# Known limitations

- This is a focused assessment implementation, not a completed enterprise platform. No load-test claim is made for the brief's full concurrency target.
- Browser interaction and visual QA were unavailable in the authoring environment. The production build, TypeScript checks, and SQLite-backed service tests were run; responsive and accessible UI behavior still needs hands-on browser verification.
- The initial deployment is private to the Site owner. Additional employees need both platform Site access and an application team membership. Granting a role inside the app does not send an invitation or change hosting access.
- The first authenticated visitor becomes the initial manager. Keep first-time setup private; a shared rollout should provision a designated owner first.
- Initial work and teammates are clearly described as sample data in the workspace guide. Sample teammates have `example.test` addresses and cannot sign in. They exist to show team ownership, history, and independent review. New work and edits persist normally.
- There is no user impersonation, password login, SSO configuration, outbound email, push notification, file upload, or background job queue.
- Administrative team-role grants are state-idempotent but can create repeated audit records on retry. Item creation, comments, and item-state mutations have full stored retry receipts.
- Team creation, deletion, membership revocation, work deletion, and cross-team work movement are outside the selected scope. Managers can add or change roles; changing your own role is blocked.
- Team-member and assignee dropdowns return one selected team's directory. Very large teams need paginated member search. Item and activity datasets are paginated.
- Literal substring search is not ranked full-text search. Queue and workspace-activity pagination uses bounded offsets; under concurrent changes, pages can shift. Item-history pagination uses a stable cursor.
- Pending comments from other users are fetched when detail is refreshed; version polling flags state changes rather than replacing an in-progress draft. There are no WebSocket subscriptions.
- Retry receipts and audit history are retained indefinitely. A production rollout needs retention/backup policies and operational monitoring.
- Dates used for overdue queries are UTC calendar dates. Timestamps display in the visitor's local timezone.
- Tests exercise real SQLite through a D1-compatible adapter and cover the actual domain queries. They do not replace deployed D1 integration tests or platform-authentication tests.
