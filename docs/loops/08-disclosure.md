# Loop 08 — Disclosure

Four things, then a door. Defaults do the common job.

## Prompt

```
Drain always-visible complexity in the task sheet and reports.

Task dialog: title and description first. Status / project / priority / owner live in a closed <details id="task-details"> labeled “Task details”. Timestamps stay in #advanced-options, also closed.
Reports: three lenses stay visible. Wrap projects + display in <details id="report-refine"> labeled “Refine”, closed by default. On viewports ≥801px, CSS keeps the refine body visible so the project list stays the job. The sheet must remain the large surface.
Do not open details to “be helpful”. Do not add a second modal for metadata.
Keyboard: “n” opens New task, “/” focuses search, when not typing and no dialog is open.
Mobile (≤800px): a single New task plate above the tab bar (#fab-new-task). Desktop hides it.
```

## Verify

- `#task-details` and `#advanced-options` start without `open`.
- `#report-refine` is open on wide viewports and closed on small ones. Lenses stay visible either way.
- Viewer can still open a task and read the title; metadata is one expand away.
- `#fab-new-task` is in the board markup for editors.
