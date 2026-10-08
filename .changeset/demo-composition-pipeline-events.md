---
'@endora-commerce/demo-composition': minor
---

The demo sales pipeline plans Events. The step `sales opportunities for the demo organisation`
now writes eight Events on six of the eight open demo opportunities — site visits, calls and two
all-day deadlines — so the CRM Calendar and an opportunity's Events tab have something to show
on a freshly seeded shop.

- They are dated from the day of the seed: seven in the coming two weeks and one five days back.
- **None has a reminder.** A seeded demo writes no notification and sends no e-mail.
- The closed opportunities have none: the Calendar shows active opportunities only.
- An all-day demo Event is a whole UTC day (`timeZone: 'UTC'`); a timed one is planned in
  `Europe/Warsaw`, inside the working day.

Nothing the package exports changes: the pipeline's declarations are not on its barrel.

`pnpm run cli demo reset` removes the Events with their opportunities. An opportunity that was
already seeded before this change is left exactly as it is, as every re-seed leaves it — it
gains no Event; reset and seed again to get them.
