# Loop 11 — Board structure

Column add/rename/type/delete live behind **Edit board**. Daily work stays **New task**.

## Prompt

```
LedgerLane board structure is a separate mode.

- Topbar: Edit board (✏). Not next to New task.
- Structure bar: New project + Done. Hint to pick a project when the filter is All.
- Add column is a modal (name first; type collapsed). Shown only in structure mode on one project.
- ✏ on each real column opens the same modal in edit: name, type, Delete column.
- Last column cannot be deleted. Tasks in a deleted column move to a sibling (same type if possible).
- Complete remains unique per project.
- Viewers never see Edit board.

Verify with npm test, npm run check, npm run verify.
```

## Verify

- Daily board: no New project, no Add column, no pencils.
- Edit board → structure bar → New project → Add column modal → pencil rename → delete with confirm.
