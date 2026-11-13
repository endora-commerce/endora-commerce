---
'@endora-commerce/admin-shell': minor
---

**The *Command hooks* screen** (`specs/176-command-hooks-outbox/` P4, FR-041) — **System → Command hooks**, at `/platform/command-hooks`, and from ⌘K / CTRL+K.

- **Execution plan** (behind `platform.modules.read`): every action an installed module declares hookable, with its owner; its `beforeCommit` hooks as a numbered list in the order they run, and its `afterCommit` handlers as an unnumbered list. Each hook says whether its module is on.
- **Outbox** (`/platform/command-hooks/outbox`, behind `platform.command_outbox.read`; the tab is hidden without it): the dead, waiting or in-progress deliveries, with the handler, attempts, last failure and dates, and a *Load more* page. A failure's code is shown as stored, beside a sentence when the handler's module or the platform translates it.
- **Retry** on a dead delivery, offered only with `platform.command_outbox.manage`.
- Either tab's permission opens the screen (the System entry is gated on `platform.modules.read` or `platform.command_outbox.read`); a tab you cannot read is hidden, and an outbox-only operator asking for the plan lands on the outbox.
- Retrying keeps keyboard focus on the list, a delivery someone else already retried leaves the list with its sentence announced, and a failed load offers *Try again*.
