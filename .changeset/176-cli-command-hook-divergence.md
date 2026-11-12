---
'@endora-commerce/cli': minor
---

**`command-hook` divergence kind** (`specs/176-command-hooks-outbox/` FR-026). `endora generate` records each `ctx.commandHooks` entry of a deployment's overlay modules as `command-hook:<module>:<action>#<id>`, on rung 2 beside interceptors, and asks a reason for each in the deployment's `divergence.ts`. The action is read from a published ref (`ORGANIZATION_HOOKABLE_ACTIONS.register`), a `hookableAction('…')` call or a literal `{ action: '…' }`; any other spelling is a `computed-subject` finding. An instance's report states that it does not attribute a hooked action to its owner. The rung-2 cost sentence now names hookable actions too.
