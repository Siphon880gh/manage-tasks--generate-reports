# LedgerLane styling guide

This is the design system for the local-first board. It exists so new UI stays readable when the human mind is already full.

It was written after an Impeccable `/critique` of the live app (auth, waiting, board, reports, People, add-column, task sheet), focused on **progressive disclosure**, **readability**, and **usability**. Treat the critique snapshot as the reason these rules exist. Treat the rules as law for new work.

Persistent AI context: [`.impeccable.md`](../.impeccable.md).

---

## Critique snapshot — 16 Sep 2026

### Anti-patterns verdict

**Pass — this does not look like generic 2024–2025 AI UI.** Paper `#f3f1e8`, ink rules, acid lime, offset shadows, and a real point of view. It looks like a ledger, not a template.

Tells that are *not* present: Inter/Roboto, cyan-on-dark, gradient headlines, glass cards, hero metrics, icon-above-title grids.

Tells to watch: Manrope is a common “nice sans”; Arial is in the stack; a third face color (`#6a4cff`) leaked into the People pile without a token.

### Design health score

| # | Heuristic | Score | Key issue |
| --- | --- | --- | --- |
| 1 | Visibility of system status | 3 | Toasts and the record bar are clear. No loading. Filters change the board with little explanation. |
| 2 | Match system / real world | 2 | “Passphrase”, “settlement”, “ledger”, “proof” sound like the brand and confuse a first-timer. |
| 3 | User control and freedom | 3 | Cancel, clear selection, confirm delete. No undo after a confirmed delete. |
| 4 | Consistency and standards | 2 | Signup role ≠ board role. Avatar means sign out. Some flows are menus, some are dialogs. |
| 5 | Error prevention | 3 | Confirms on delete / replace / last admin. Smart defaults on add-column. |
| 6 | Recognition rather than recall | 3 | More-actions hints help. Waiting page does not name who can invite. |
| 7 | Flexibility and efficiency | 2 | Multi-select and drag exist. Almost no keyboard shortcuts. |
| 8 | Aesthetic and minimalist design | 2 | Distinctive, but the page H1 steals the board. Uppercase stamps add noise. |
| 9 | Error recovery | 2 | Auth errors are plain. Most other failures are a toast with no next step. |
| 10 | Help and documentation | 2 | Hints exist. No contextual help. Waiting is a dead end. |
| **Total** | | **24/40** | **Acceptable** |

### Cognitive load checklist

Failed items: **single focus**, **visual hierarchy** (board/report H1 vs the work), **one thing at a time** (task chips before the title; reports dump lens + projects + toggles), **progressive disclosure** (signup roles; sign-in copy about first-admin; always-visible Select).

**4 failures → high cognitive load.** Address before adding features.

### What’s working

- **More actions / Share / Add files** — one control, labeled items, dividers. This is the pattern to copy.
- **Add column modal** — name first, type collapsed. One decision.
- **People facepile** — who has access without another header button. Invite stays closed until an admin needs it.
- **Selection bar** — appears only after a check. Delete is not a permanent extra button.

### Priority issues

**[P1] The work sits under a poster.** `.page-head h1` is `clamp(36px, 5vw, 70px)`. On a short or narrow viewport the board and the report sheet start below the fold. People came to move cards or read an invoice, not to re-read the manifesto.

**[P1] Stamped type is used as body.** `.mono`, `.eyebrow`, `label`, `.hint` at 10–12px, uppercase, tracked. Combined with `--muted` (`#77766f` on `#f3f1e8`, about 4:1) it fails a glance test. OCR of screenshots turning “Board” into “BOARDD” is a smell: the letters are working too hard.

**[P1] Signup asks for a life story.** Display name, username, passphrase, *and* three account-type cards. Board access is invite-only anyway. That is two systems (account type vs board role) on the first screen.

**[P1] Waiting has no move.** “Not on this board yet” is clear. The hint is faint and there is no list of admins, no copyable next step, no sign-out in the body — only the unlabeled avatar.

**[P2] The avatar is a trap.** It signs you out. No menu, no “Account”. Jordan will not guess this. Alex will click it looking for settings.

**[P2] Task sheet leads with four chips.** Status, project, priority, owner sit above the title. The title is the task. Metadata is secondary.

**[P2] Reports show every control at once.** Three lenses, All/None, every project, three display switches, then the sheet — which may still be off-screen.

### Persona red flags

**Alex (power user):** No shortcuts for new task, search focus, or lens switch. The poster H1 is dead space. Drag and multi-select are the only accelerators.

**Jordan (first-timer):** “Enter workspace”, “passphrase”, and a coral square that logs you out. Waiting copy points at “People”, a control they cannot see.

**Sam (keyboard / low vision):** 9px tags, 16px checkboxes, focus rings only on some fields. Color alone marks high priority and drop targets. `#aria-live` on `#app` will re-announce the whole shell on every render.

**Casey (phone):** Primary create actions sit at the top; thumb zone is the tab bar. Account name is hidden. Touch targets on chips and checks are under 44px.

---

## Principles

1. **Four things, then a door.** Visible choices at a decision point: ≤4. Group, then hide.
2. **The work is the page.** If the board or the report is not in the first screen, the chrome is too tall.
3. **Sentence case for humans, stamps for machines.** Help, hints, body, and buttons that are full sentences stay sentence case.
4. **One primary.** One acid or ink button per view. Everything else is default, ghost, or inside a menu.
5. **Closed means closed.** `<details>`, menus, and advanced blocks start shut. Do not open them to “be helpful”.

---

## Progressive disclosure

The working-memory rule: people hold about **four** items. Count options, not pixels.

### Allowed surfaces (in this order)

| When the user needs | Use | Example |
| --- | --- | --- |
| The next common action | One acid/primary button | New task |
| 2–3 sibling creates | An **action cluster** with a divider | New project · New task |
| Occasional or dangerous work | **More actions** menu, grouped, with a one-line hint | Import / Export · Record · Delete all |
| A short dedicated job | A **small modal** (one field first) | Add column, New project, People |
| Rare fields | **`<details>`** labeled in plain language | Column type, Advanced options, Invite someone |
| Consequence of a choice | Chrome that **appears after** the choice | Selection bar after a checkbox |

### Do not

- Put more than one primary and two secondary buttons in the same cluster.
- Open two dialogs for one job.
- Repeat the same action in the topbar, the page head, *and* a menu.
- Show role pickers, type pickers, or export formats until the user has named the thing.
- Use a tooltip as the only label.

### Screen budgets

- **Auth, sign in:** username, passphrase, submit. Hint about invites belongs on **Create account**, not Welcome back.
- **Create account:** name, username, passphrase, submit. Account type (if it stays at all) is a closed “Account type” details, default Editor.
- **Board head:** New task (primary), More actions. **Edit board** lives in the topbar — it is a board-wide structure mode, not a create action. New project and Add column appear only after Edit board is on.
- **Add column:** name + Add. Type stays closed. Default To do.
- **People:** list first. Invite is a closed details, and only for admins who have someone to invite. Role selects appear only for admins.
- **Task sheet:** title and description first. Status / project / priority / owner in a closed “Task details” or a single compact row *below* the title. Timestamps stay in Advanced.
- **Reports:** lens first (3). Project list can stay if it is the job; **Display controls** start closed. The sheet must be visible without scrolling past a poster H1.
- **Waiting:** one sentence, who to ask (admin names), Sign out as a real button.

---

## Readability

### Type roles

Use **five** sizes. Do not invent a sixth because a section “needs presence”.

| Role | Size | Weight | Face | Case | Use |
| --- | --- | --- | --- | --- | --- |
| Display | `clamp(1.75rem, 4vw, 2.5rem)` | 800 | Manrope | Sentence | Page title when it is the *only* hero (auth, waiting). Not above a kanban. |
| Title | `1.5rem` / 24px | 800 | Manrope | Sentence | Modal titles, report sheet title |
| Body | `1rem` / 16px | 500–600 | Manrope | Sentence | Hints, empty states, dialog copy, description |
| UI | `0.875rem` / 14px | 700 | Manrope | Sentence | Buttons, menu items, card titles |
| Stamp | `0.6875rem` / 11px | 600 | DM Mono | Uppercase, tracking `0.06em` | Eyebrows, column type, table headers, “3 selected” |

**Hard stops**

- Nothing smaller than 11px, including tags and counts.
- Hints and help are **body**, not stamps. Color is ink or a muted that still hits **4.5:1** on paper.
- Line length for help and report prose: `max-width: 65ch`.
- Body line-height ≥ 1.45. Card titles can be 1.25.
- Do not uppercase a whole sentence. “View only — editing is off” is already a stamp; do not also shrink it.

### Contrast

| Pair | Minimum |
| --- | --- |
| Body on paper | 4.5:1 |
| Stamps on paper | 4.5:1 |
| White on ink / ink on acid | 4.5:1 for text |
| Placeholder | 3:1 against the field |

`--muted: #77766f` on `--paper: #f3f1e8` is **not good enough** for 12px hints. Darken muted toward ink (target about `#5c5b55` or stronger) or keep hint text at 16px ink at 80% opacity — measure it, do not guess.

Do not encode meaning with color alone. High priority needs the word “High”, not only a pink chip.

### Motion and type

No bounce. No animated headlines. `prefers-reduced-motion: reduce` turns toast and record-dot animation off.

---

## Usability

### Affordance

- Buttons look like plates: 2px ink border, offset shadow. Ghost buttons are *text* with an underline, used for Cancel / Close / Remove.
- A coral circle that signs you out must say **Sign out** in a menu, or not be the only path.
- Checkboxes that select cards need a 44×44px hit area even if the box is 18px.
- Every icon control has a visible text label or an `aria-label` that is the *action* (“Sign out”, not “CT”).

### Feedback

- Every write (save, invite, delete, rename) gets a toast **or** in-place confirmation, not both.
- Destructive confirms use the real verb: “Delete 3 tasks”, “Remove from board”, “Replace all tasks”.
- After success, leave the user on the thing they just changed (board with the new column, People list with the new name).

### Keyboard

Minimum for new work:

- `Esc` closes menus and dialogs (native `<dialog>` already helps).
- Focus ring is 2px blue, offset 2px, on every control — not only column titles.
- Tab order follows reading order. Do not put the page H1’s sibling actions before the board if the board is the job.
- `#app` must not be `aria-live="polite"` for the whole shell. Live regions are for toasts and the record timer only.

### Mobile (≤800px)

- Adapt, do not amputate. New task stays reachable — put the primary action near the bottom tab bar or a single floating plate, not only in a tall page head.
- Keep People as faces; keep a text name for the signed-in person *somewhere* (menu is fine).
- Thumb zone: Board / Reports stay at the bottom. Do not add a third tab.
- Do not rely on hover.

---

## Tokens

Keep the brutalist set. Add a token rather than a one-off hex.

```css
:root {
  --ink: #171714;
  --paper: #f3f1e8;
  --white: #fffefa;
  --acid: #d8ff43;
  --blue: #2d5bff;
  --coral: #ff6b4a;
  --muted: #5c5b55; /* readable on paper — do not drift back to #77766f */
  --line: var(--ink);
  --danger: #b3261e;
  --shadow: 5px 5px 0 var(--ink);
  --shadow-sm: 3px 3px 0 var(--ink);
  --space-1: 8px;
  --space-2: 12px;
  --space-3: 16px;
  --space-4: 24px;
  --space-5: 32px;
  --radius: 0; /* no rounding unless a circle (avatar, rec-dot) */
}
```

People faces use **blue, coral, ink** — not a stray purple. A fourth person repeats the cycle.

Space is an 8px rhythm. Do not use 7px, 9px, or 11px padding “to make it fit”.

---

## Color with purpose

| Color | Job |
| --- | --- |
| Paper | Page |
| Ink | Text, rules, primary fill |
| Acid | The one next action; active nav |
| Blue | Focus, drop target, emphasis word in a title |
| Coral | The signed-in person |
| Danger | Delete / remove only |

Acid and blue must not compete on the same row. If New task is acid, nothing else in that cluster is acid.

---

## Layout

- **Board / Reports page head:** eyebrow + a *small* title (Title role, not Display), actions on one line. If the kanban is not visible at 900×700, the head is too tall. Prefer no manifesto line on signed-in pages; keep that copy on auth.
- **Kanban:** horizontal scroll is allowed. Columns 280–420px. Add-column is a quiet dashed rail, not a second form.
- **Reports:** controls in a side column on wide screens; on narrow, lenses first, then the sheet, then “Refine” as a closed details for projects and display toggles.
- **Modals:** 440px for one-field jobs, 560px for import/export, task sheet may be wide. Backdrop stays `rgba(23,23,20,.58)`.
- **Auth:** art panel may stay loud. Form column stays ≤390px, one primary button, full width.

Whitespace is a group, not a leftover. Tight inside a cluster, `--space-4` between clusters.

---

## Components

### Button
- Default plate, primary ink, acid once per view, ghost for cancel, danger-fill only inside a confirm.
- Label is a verb: “Add column”, “Invite”, “Sign out”.
- Disabled uses opacity and `cursor: not-allowed`; do not invent a fourth fill.

### Menu
- Title + one-line hint in body type.
- `hr` between groups (create/transfer, then record, then destroy).
- Danger items last.

### Dialog
- Title, one hint, the field(s), footer Cancel + primary.
- First field focused. Closed details for extras.
- Confirm dialogs do not reuse “Delete” when the action is Remove or Sign out.

### Facepile
- Up to three faces, then `+N`. Opens People. `aria-label="People on this board"`.

### Toast
- One line, ink plate, 2s. Not for errors the user must fix — those stay on the form.

### Empty
- Says what to do: “Select one project to add a column.” not “No data”.

---

## Voice

Short. Specific. No “please”. No “Oops”.

- Good: “That’s all most columns need. It starts as To do.”
- Good: “Guest User stays on this device but loses board access until invited again.”
- Bad: “Accounts live only in this browser. The first account becomes the board admin…” on the **sign-in** form.
- Bad: Unexplained “settlement” in a button. If the lens is for invoices, title it “Invoice” and explain settlement *inside* the sheet.

Passphrase can stay (it is a local secret, not a website password) if a hint says “at least 6 characters, stored only here”.

---

## Definition of done for UI work

A change is not done until:

1. A first-time path shows ≤4 choices before a door.
2. The board or report content is on screen at 900×700 without scrolling past decoration.
3. New copy is sentence case at ≥16px *or* a stamp at ≥11px with 4.5:1 contrast.
4. Keyboard can open, complete, and cancel the flow; focus is visible.
5. Viewers never see edit chrome; admins see manage chrome only when they open People.
6. You walked the flow in a browser, not only a screenshot of the first paint.

Re-run `/critique` after a visual pass. The score should move above 28/40 before we call the chrome “settled”.

Drain implementation (16 Sep 2026 evening) is sequenced in [DRAIN_GRAPH.md](DRAIN_GRAPH.md). Loops 06–10 are the prompts.

Drain implementation (16 Sep 2026 evening) is sequenced in [DRAIN_GRAPH.md](DRAIN_GRAPH.md). Loops 06–10 are the prompts.
