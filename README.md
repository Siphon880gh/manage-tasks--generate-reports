# LedgerLane

A local-first kanban for turning progress into proof. Accounts, tasks, attachments, and reports stay in this browser. Nothing is sent to a server.

## Run

```bash
npm start
```

Then open [http://127.0.0.1:4173](http://127.0.0.1:4173). Any static file server that can serve this folder works.

## Use

- **Board** — projects, custom columns (only one Complete column per project), tasks, multi-select delete, import/export, screen recording
- **Reports** — invoice, project-manager, and stakeholder lenses; filter by one or many projects; CSV and print
- **Task modal** — large description, paste images, attach files
- **Roles** — Admin and Editor can change work; View only can see Board and Reports

Import understands ClickUp CSV and LedgerLane JSON. Export as Notion Markdown (copyable), ClickUp CSV, or LedgerLane JSON.

## Test users

Local demo accounts, including **Admin User**, **Morgan Lee**, and **Viewer User**, are documented in [README_TEST_USERS.md](README_TEST_USERS.md).

## Verify

```bash
npm test
npm run check
npm run verify
```

`npm run test:browser` is a shorter smoke path.

## Stack

Vanilla JavaScript, IndexedDB (`ledgerlane-db` v2), no build step.
