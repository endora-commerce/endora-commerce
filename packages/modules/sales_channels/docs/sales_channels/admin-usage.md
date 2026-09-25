---
title: Admin usage
sidebar_position: 2
---

# Admin usage — Sales Channels

How a platform administrator drives the Sales Channels module from the Admin UI day to day. Every action below is also reachable through the module's admin HTTP API.

## Locating the area

Sidebar → **Operations → Sales channels**.

The list page shows every channel registered on the platform. The system-default channel is marked with a `System default` badge and is always present (a freshly-installed platform automatically gets a `default` channel on first boot).

## Creating a new channel

1. Click **+ New channel**.
2. Fill in:
   - **Code** — lowercase machine-friendly identifier; immutable after creation.
   - **Display name** — currently a single `en-US` string; multi-locale support is a follow-up.
   - **Theme code** *(optional)* — opaque identifier the storefront uses to pick its theme.
   - **Languages** — comma- or newline-separated. Codes must already exist in the i18n module's languages registry.
   - **Default language** — must be one of the languages above.
   - **Currencies** / **Default currency** — same shape; codes must exist in the currencies registry.
   - **Active** *(default `true`)*.
3. **Create channel.** The system refuses if the code is already in use, or if any language / currency code is unknown.

## Editing an existing channel

1. Click a channel's `code` in the list.
2. The edit page loads its identity. Make changes; click **Save changes**.
3. If another administrator changed the same channel between your load and save, the save returns a 412 conflict banner with the current version. Refresh the page to pull the latest state and re-apply your changes.

## Deactivating a channel

Use the **Deactivate** button on the channel detail page. Deactivation is idempotent and reversible:

- The channel disappears from the resolver's accept list (storefront / POS requests pointing at it are refused with `INACTIVE_SALES_CHANNEL`).
- It is hidden from the "Add to channel" picker on every entity edit page.
- Existing memberships and historical Orders / Quotes still reference it.

The system-default channel cannot be deactivated.

## Hard-deleting a channel

The **Delete** button is destructive. The platform refuses the operation when:

- The channel is the system default.
- Any Order or Quote references the channel — these attributions are immutable, so the only way to free the channel is to keep it (deactivation is the right answer here).
- Removing the channel would leave one or more entities (Products, Customers, …) bound to **zero** channels — *unless* you confirm the rebind-to-Default prompt, in which case those entities are rebound to the system default in the same transaction before the channel row is dropped.

The bridge tables' `ON DELETE CASCADE` removes every remaining membership row.

## Managing membership from the entity side

Every entity edit page that supports channel membership (Products to start; the other 8 types are a mechanical follow-up) shows a **Sales channels** card near the bottom:

- The list shows the channels the entity is currently in, with a `System default` badge where appropriate.
- The picker lists channels the entity is **not** yet in. Pick one and click **Add**.
- **Remove** triggers the at-least-one-channel invariant — if the entity has only one channel left and you confirm the rebind-to-Default prompt, the system rebinds it to the system default before completing the remove.

## Multi-storefront set-up

To run two storefronts on the same backend (e.g. `serwisA.com` and `serwisB.com`), set the `SALES_CHANNEL_HOST_MAP` env var on the backend:

```env
SALES_CHANNEL_HOST_MAP=serwisA.com=channel-a,serwisB.com=channel-b
```

Each storefront request resolves to its host's channel automatically; no header is needed. Each storefront then sees only the products / customers / prices that belong to its channel.

## What admins cannot do

- Reassign an Order or Quote Request to a different channel after creation. The attribution is immutable; this is a deliberate audit guarantee, not an oversight.
- Delete the system-default channel. The boot-time reconciler will recreate it on the next platform boot.
- Force two channels to be system-default simultaneously. The partial unique index prevents it at the database layer.
