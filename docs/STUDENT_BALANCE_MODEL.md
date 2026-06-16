# Student Balance Model

This document fixes the target financial model for students in Maestro CRM.

## Core Rule

Each student has one shared денежный balance in `accountBalance`.

All lesson charges are deducted from this single balance.

## What A Package Is

A package, membership, or tariff is not a separate wallet.

It is a pricing rule used to suggest the average charge for a lesson.

Formula:

`package price / expected lesson count = average charge per lesson`

Examples:

- `32 000 / 8 = 4 000`
- `60 000 / 16 = 3 750`

## Lesson Closing

When a lesson is closed, CRM should:

1. Detect lesson type.
2. Find the best matching active package for that student.
3. Suggest the package and average lesson charge.
4. Deduct money only from the shared student balance.

## Manual Override

Admin or super admin can always:

- change the selected package
- change the charge amount
- skip the charge
- send the case to manual review

Automatic billing is only a suggestion, not a forced action.

## Forecast

Money forecast is calculated from:

- shared student balance
- future lesson schedule
- average lesson charge from the matching package for each future lesson

Forecast should answer:

- how many future lessons the balance likely covers
- approximately until which date the student has enough money

## UI Rules

Main student UI should show:

- money balance
- active tariff/package
- average charge per lesson
- forecast by money and future schedule

Main student UI should not treat `classesRemaining` as the student's real balance.

If `classesRemaining` still exists in the current backend, it is considered a temporary service field for internal CRM logic during migration.
