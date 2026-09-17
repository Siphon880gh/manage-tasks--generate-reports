# LedgerLane feature TODOs

Implementation plan for the workspace upgrades. Each item lists the intended UX, the data/model change, and how verification proves it.

## Board and task operations

### 1. Multi-select tasks and delete with confirmation

- Always-visible checkboxes on task cards plus **Select visible**.
- A selection count and **Delete selected** appear once one or more tasks are checked.
- Clicking a checkbox does not open the task modal.
- Deletion opens an in-app confirm dialog; nothing is removed until the user confirms.
- Cancel leaves tasks untouched.

**Verify:** checkboxes exist, selecting two tasks enables delete, cancel keeps both, confirm removes them.

### 2. Delete all tasks with confirmation

- **Delete all tasks** is available on the board (scoped to the current search/owner/project filters).
- Confirm copy includes the count and scope.
- Cancel is a no-op; confirm permanently deletes the matching tasks only.

**Verify:** button exists, cancel preserves seeded work, confirm on an isolated project empties only that project.

### 3. Create a new project

- **New project** on the board header.
- Task editor can create a project without closing the task.
- New projects start with default columns: To do, In progress, Complete.
- Creating a project from the board switches the board filter to it.

**Verify:** header control creates a named project and it appears in filters and reports.

## Reports

### 4. Focus reports on one or many projects

- Reports sidebar lists every project as a checkbox, all on by default.
- **All** / **None** helpers.
- Invoice, project-manager, and stakeholder lenses, CSV, and stats honor the checked set.
- Unchecking every project shows an empty state.

**Verify:** isolating one project changes item counts; two projects combine; none shows empty.

## Task details

### 5. ClickUp-style task modal with progressive disclosure

- Wide task dialog: large title, compact status/project/priority/owner row, then a large rich-text description.
- Description supports bold/italic/underline/lists, paste of HTML, and paste/drop of images.
- Files can be attached (picker or drop). Images and recordings preview in-place.
- Advanced fields (timestamps, settlement amount) live in a **collapsed** `<details>` block.
- Existing seed descriptions remain readable.

**Verify:** modal opens from a card; advanced starts closed; RTF toolbar and file input exist; saving persists HTML.

## Board motion and capture

### 6. Drag-and-drop placement cues

- Dragging a card highlights the destination column.
- A **Drop here** slot tracks the pointer between cards so the landing index is obvious.
- Drop writes the task into that column and order.
- Complete-type columns still stamp `completedAt`; leaving them clears it.

**Verify:** columns expose `data-drop`; drag-over injects `.drop-slot` and `.is-drop-target`.

### 7. Screen recording (Chrome display-media API)

- **Record screen** on the board and inside a task.
- Uses `navigator.mediaDevices.getDisplayMedia` + `MediaRecorder`.
- A HUD offers **Stop & save** and **Cancel**.
- A finished clip attaches to the open task, the single selected task, or a chosen task.

**Verify:** both record controls exist; HUD markup is present. (The browser permission prompt cannot be completed in headless CI.)

## Columns

### 8. Rename and add custom columns per project

- Filtering to one project shows that project’s columns and an **Add column** panel.
- Any column title is editable.
- New columns choose a type: To do, In progress, or Complete.
- **Complete is unique** — a project may have only one Complete column. Extra columns are To do or In progress.
- All-projects view aggregates by type and does not allow structural edits.

**Verify:** add a To do column on a project; Complete is omitted from the type list when one already exists; rename persists after reload of state.

## Implementation notes

- IndexedDB bumps to v2: `projects`, `columns`, `attachments` stores. Existing v1 tasks migrate from `project` name + `status`.
- Tasks gain `projectId`, `columnId`, `sortOrder`. Description may be HTML. Attachments are Blobs, loaded on demand.
- Domain helpers live in `app-core.mjs` so unit tests can lock behavior without the DOM.

## Access

### 10. View-only users

- Signup offers **View only**.
- Viewers see Board and Reports (filters, lenses, print, report CSV).
- Viewers cannot create, edit, move, import, record, attach, or delete. Task details open read-only.
- Existing accounts without a role stay editors.

**Verify:** create a viewer after an editor; board is visible; New task / Import / delete are absent; task title is disabled; Reports still switch lenses.

## Import and export

### 9. Import tasks — Append or Replace (ClickUp-compatible)

ClickUp has a first-class **Imports / Exports** path: workspace **Export Items** writes a CSV, and the **Spreadsheets importer** accepts CSV/TSV/JSON with headers such as `Task Name`, `Task Content`, `Status`, `Priority` (1–4), `List Name`, and `Assignees`.

- Board **Import** accepts ClickUp export CSV, ClickUp-ready import spreadsheets, ClickUp-style JSON, and LedgerLane JSON backups.
- **Append** keeps current tasks and adds the file.
- **Replace** asks for confirmation, deletes all current tasks, then imports. Projects remain.
- Lists / folders / spaces become projects. Custom ClickUp statuses become columns when they are not a default type name.
- Board **Export** writes a ClickUp CSV (official column names), a LedgerLane JSON backup, or **Copy for Notion** (Markdown you paste into a Notion page).
- Viewers can copy for Notion; they cannot download ClickUp/JSON backups.

**Verify:** import dialog exposes append/replace; a 2-row ClickUp CSV appends two cards; replace confirms and leaves only the imported set; export dialog offers ClickUp, JSON, and Notion; Notion text starts with `# LedgerLane` and checkbox tasks.

## Auto-verification

Run:

```bash
npm test
npm run check
npm run verify
```

`tests/verify-features.mjs` walks each item above in Chromium.

### Checklist (verified 2026-09-16)

- [x] Multi-select checkboxes, selection count, delete-selected confirm + cancel
- [x] Delete all tasks confirm (count + scope) + cancel
- [x] New project control creates a project and switches the board filter
- [x] Report project checkboxes, All/None, empty state when none selected
- [x] Task modal: large title, RTF toolbar/editor, attachments, record, advanced collapsed
- [x] Drag-over injects `.drop-slot` and `.is-drop-target`
- [x] Board + task **Record screen** controls and recording HUD markup
- [x] Per-project rename + add column; Complete type omitted once one exists
- [x] Domain tests (`npm test`) and browser smoke (`npm run test:browser`)
- [x] Import append/replace + ClickUp CSV detect/preview; export ClickUp CSV and LedgerLane JSON
- [x] View-only accounts see Board and Reports and cannot edit
- [x] Copy for Notion (Markdown to-dos; viewers included)

Playwright feature checks and `artifacts/ledgerlane-features.png` are refreshed by `npm run verify`.
