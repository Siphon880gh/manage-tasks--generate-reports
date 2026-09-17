# Loop 09 — Readability

Sentence case for humans. Stamps for machines. Contrast you can measure.

## Prompt

```
Drain type noise in styles.css and live regions.

Tokens: --muted #5c5b55 (readable on --paper). People face-3 uses --ink, not a stray purple.
Hints, confirm copy, waiting copy, empty states: Manrope, ≥16px, sentence case, max-width 65ch.
Stamps (eyebrows, field labels, tags, table headers, column type): DM Mono, uppercase, ≥11px.
Do not uppercase whole sentences. Viewer pill is sentence case.
Focus: 2px blue, offset 2px, on buttons, inputs, selects, switches, nav.
Checkboxes that select work: 44×44 hit area.
Remove aria-live from #app. Keep role=status + aria-live on #toast and the record HUD.
prefers-reduced-motion: reduce turns off toast slide and .rec-dot animation.
```

## Verify

- Nothing in the UI is smaller than 11px except decorative rules.
- Screenshot OCR should read “Board”, not “BOARDD”.
- `#app` has no `aria-live`.
