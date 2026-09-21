# Lesson 05 — Reconcile Time, Periods, Rates, and Amounts

## Establish the cut-off

Pick a consistent time zone and cut-off date. Work performed after the cut-off belongs in the next period unless the agreement says otherwise. Use the **Billing period** field for the commercial period (for example, “September 2026”), not merely the date a task was created or edited.

The example workbook holds total logged hours plus separate month columns. That makes a key reconciliation possible:

> total logged hours = sum of period hours, subject to documented carryovers or exclusions

Investigate differences rather than forcing totals to match. Common causes are work crossing midnight, late entries, non-billable time, rounded entries, reclassification, or a formula omitting a row.

## Distinguish measures

- **Worked hours** are actual effort recorded.
- **Billable hours** are worked hours allowed by the agreement.
- **Included hours** are consumed within a fixed fee or retainer.
- **Invoice quantity** is the quantity shown on the formal invoice.

These can differ legitimately. Record the bridge between them.

## Apply rates consistently

For time-based work, the usual line calculation is:

`billable hours × contractual rate = gross line amount`

Then apply agreed discounts, caps, credits, taxes, or retainage in an explicit order. Keep adequate precision during calculation and round only as the contract, currency, and invoicing system require. Reconcile the sum of lines to the invoice subtotal and the subtotal through adjustments to the final amount due.

For fixed-fee or milestone work, hours explain effort but usually do not set the price. Do not manufacture an hourly rate merely to make a fixed fee look time-based. Show the agreed fee and milestone status; use hours internally for margin analysis.

## Avoid mixed-basis double counting

If an engagement amount already settles a project's work, do not also bill each task amount unless the agreement defines those tasks as additional charges. LedgerLane's settlement calculation avoids adding task amounts for projects represented by a cash or qualifying non-cash engagement. Treat this as a helpful guardrail, then independently reconcile the report to the contract.

## Period close checks

Before approval:

1. compare the period to source time or milestone records;
2. identify missing, duplicate, negative, or unusually large entries;
3. verify rates against the effective rate card;
4. check caps and pre-approval thresholds;
5. tie parent lines to sub-lines without double counting;
6. tie line amounts to subtotal, taxes, credits, and amount due; and
7. retain the calculation version used to issue the invoice.

