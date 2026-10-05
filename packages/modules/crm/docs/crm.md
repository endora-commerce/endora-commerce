---
title: crm
description: Sales opportunities with a configurable status workflow that linked orders follow
---

# `crm`

The CRM module keeps track of **sales opportunities**: a deal a sales
representative is working with one customer organization, from the first
contact to the moment it is won or lost.

This page grows with the module. The sections marked *coming* describe
capabilities that are designed and not yet shipped.

## What it does

An opportunity belongs to exactly one organization and moves through a
**status workflow** the operator configures: a set of statuses and the
transitions allowed between them. Every status is one of three kinds:

- **open** — the opportunity is still being worked;
- **won** — the opportunity is closed and the deal was made;
- **lost** — the opportunity is closed without a deal.

A fresh installation starts with a default workflow of six statuses:

| Code | Kind | Moves to |
| --- | --- | --- |
| `new` (the start status) | open | `qualified`, `lost` |
| `qualified` | open | `proposal`, `lost` |
| `proposal` | open | `negotiation`, `won`, `lost` |
| `negotiation` | open | `won`, `lost` |
| `won` | won | — |
| `lost` | lost | `new` |

A closed opportunity is not necessarily finished: `lost` can move back to
`new`, so a deal that comes back to life is reopened rather than re-entered.

Opportunities are visible according to the organizations an administrator may
see. An administrator restricted to a set of organizations sees only those
organizations' opportunities; to them, another organization's opportunity does
not exist.

### The workflow, over the API

| Verb + Path | Permission | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/crm/workflow` | `crm:read` | The configured statuses, with how many opportunities are in each, the transitions between them, the order-status mappings and the statuses that count toward a computed value. |

## Switching it on and off

CRM is an optional module. It is on by default and an operator switches it
off, and back on, on the **Modules** screen of the Admin UI
(`/platform/modules`).

While it is off:

- every `/api/v1/admin/crm/…` endpoint answers `503` with the code
  `MODULE_DISABLED`;
- its screens, sidebar group, command-palette entries and settings disappear
  from the Admin UI;
- its permissions can no longer be granted to a role;
- nothing it would do in the background happens.

Nothing is deleted. Every opportunity, its history and the workflow
configuration stay in the database, and everything is back exactly as it was
when the module is switched on again.

## Permissions

| Code | What it allows |
| --- | --- |
| `crm:read` | View sales opportunities and the status workflow. |

A role that holds `crm:read` should also hold `orders:read`: an opportunity
shows the orders linked to it, and those are read from the Orders module.

No role receives a CRM permission automatically. Grant them on the
**Roles** screen.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `crm.enabled` | on | The switch described above. |
| `crm.auto_create_from_orders` | off | *Coming.* Create an opportunity for every newly placed order. |
| `crm.auto_create_from_quote_requests` | off | *Coming.* Create an opportunity for every newly submitted quote request. |

## Coming

- Creating and editing opportunities, and configuring the workflow, in the
  Admin UI.
- Linking orders to an opportunity, and having a linked order follow the
  opportunity's status.
- Moving an opportunity when one of its orders reaches a given status.
- Assigning opportunities to sales representatives.
- Notes, internal messages, attachments and tags.
- A board view with a column per status.
- Linking quote requests, and a value computed from the linked documents.
- A change history for every opportunity.
- Analytics: handling time, time in each status, results by sales
  representative.
