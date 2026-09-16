---
status: open
priority: P2
level: 4
opened: 2026-09-16
---

# Remove the scanner test fixture after the pay→unlock test

`packages/web/public/audit/test-fixture.{html,js}` host a FAKE, non-functional
service_role-shaped token so the scanner has a guaranteed finding to exercise the
full scan → pay → unlock flow before launch.

The token is harmless (invalid signature, points at a project that does not
exist), but the fixture should not stay on the production site once the operator
has confirmed a real purchase unlocks a real report.

## Done looks like

Once the operator has run one successful test purchase:
1. Delete `test-fixture.html` and `test-fixture.js` from `packages/web/public/audit/`.
2. Remove them from the file list in `scripts/build-audit-site.js`.
3. `npm run build:audit-site && firebase deploy --only hosting`.
4. Delete this task.
