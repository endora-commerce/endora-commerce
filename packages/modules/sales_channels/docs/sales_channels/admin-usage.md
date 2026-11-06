---
title: Admin usage
sidebar_position: 2
---

# Admin usage — Sales channels

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
   - **Languages** — a searchable multi-select over the active entries of the Dictionary's languages. Type part of a code (`pl-`) or of a name (`Polish`, `Polski`) to narrow the list, press **Enter** or click to add an entry, and remove one with the **×** on its chip or with **Backspace** in the empty search box. At least one is required.
   - **Default language** — a searchable select offering only the languages selected above. Removing the language that is the current default empties this field: the form says so and cannot be saved until you choose a default again — it never picks one for you.
   - **Currencies** / **Default currency** — the same two controls over the Dictionary's currencies, with the same rule for the default.
   - **Active** *(default `true`)*.
   - **Open to anonymous visitors** *(default on)* — see [Opening and closing a store to anonymous visitors](#anonymous-access).
3. **Create channel.** The system refuses if the code is already in use, or if any language / currency code is unknown.

## Editing an existing channel

1. Click a channel's `code` in the list.
2. The edit page loads its identity. Make changes; click **Save changes**.
3. If another administrator changed the same channel between your load and save, the save returns a 412 conflict banner with the current version. Refresh the page to pull the latest state and re-apply your changes.

## Opening and closing a store to anonymous visitors {#anonymous-access}

The **Open to anonymous visitors** checkbox on the channel form decides who may use the channel's storefront:

- **On** (the default, and how every channel worked before the option existed) — anyone may browse the store; signed-in customers may use it when their Organization is assigned to the channel.
- **Off** — the store serves signed-in customers only. A visitor who is not signed in is taken to the sign-in page from every page of the store, with a notice that the store is available to signed-in business customers; nothing of the catalogue, prices or content is served to them. Business registration stays available on the sign-in page, and an Organization registered there is assigned this channel. Individual (B2C) self-registration is not offered on a closed store.

The list of channels marks a closed channel with a **Sign-in required** badge.

Whether anonymous visitors see **prices** is a separate setting, and it is not on this form: the
*unauthenticated display mode* (`pricing.unauthenticated_display_mode`). The hint under the
checkbox links to *Pricing settings*, where it is set for every channel; the *Settings* screen sets
it for one channel. *None* hides prices until sign-in. A product or category display-mode override
takes precedence over it, for anonymous visitors too. Signed-in customers see prices according to
their own display mode. Channels used to carry a price-visibility flag of their own, which also hid
prices from signed-in customers; it was retired, and every channel that had it off was given
*None* for anonymous visitors, so they still see no prices there.

One thing to keep in mind when closing a store:

- **Moderation decides who gets in by registering.** An Organization registered on a closed store is assigned that store's channel. With automatic moderation it is active at once, so anyone who registers a business there gets access; with manual moderation nobody gets in until an operator approves the Organization.

## Deciding which customers may use a store

A signed-in customer may use a store only when their Organization is assigned to the store's channel. Assignments are made on the Organization's page, in its **Sales channels** panel (see the Organizations module documentation); an Organization must keep at least one channel. A customer whose Organization is not assigned is refused at sign-in with *"This account does not have access to this store."* and, if the assignment is removed while they are signed in, sees a *No access to this store* screen listing the stores they can use.

That list links each store when the channel's **Storefront URL** setting is filled in; otherwise it shows the store's name only.

When this rule was introduced, every existing Organization was assigned the system-default channel and every channel it already had orders on, so no existing customer lost access to a store they had bought in.

## Prefixing the default language in URLs {#prefix-default-language}

On the channel's edit screen, **Prefix the default language in URLs** decides whether the
channel's default language carries its prefix in storefront addresses (`/pl/p/wiertarka`)
or not (`/p/wiertarka`). Every other language of the channel is always prefixed
(`/en/p/drill`). Under the switch the screen lists the prefix of every language of the
channel, recomputed as you change the languages.

- New channels start with the switch **on**. Channels that existed before the upgrade that
  introduced the switch start **off**, so their addresses did not change.
- **Switching it on** moves every default-language address under its prefix. Old addresses
  are redirected (307) to the language chosen by the visitor's `?lang=`, `lang` cookie or
  browser languages — nothing indexed or bookmarked breaks.
- **Switching it off** makes the unprefixed address the default language again; the
  prefixed one answers a permanent redirect to it.
- **Changing the channel's languages changes addresses too**: a new language gets a prefix,
  and adding a second variant of a language (`en-GB` beside `en-US`) switches both to full
  prefixes (`/en-us`, `/en-gb`) while `/en` keeps redirecting.
- Browsers may keep a permanent redirect they cached for up to an hour after a change.
- Operators with read-only access to sales channels see the switch disabled.
- A CMS page whose slug starts with a language prefix (for example `en`) cannot be saved;
  an existing one is marked in the CMS page list as hidden by the language prefix.

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

The host in the map is the one the **backend** is called on, so give each storefront its own address for the backend (its `BACKEND_BASE_URL` and `NEXT_PUBLIC_API_BASE_URL`) and map that address; each storefront's calls then resolve to its channel and no header is needed. Alternatively, put a reverse proxy in front of each storefront that sets the `X-Sales-Channel` header. Whichever way the channel is resolved, the storefront then names it on every call it makes to the backend, including the calls its pages make from the browser.

On each storefront:

- **products, categories, prices and promotions** are the ones bound to its channel;
- **anonymous visitors** are served only when the channel is open to anonymous visitors;
- **signed-in customers** are served only when their Organization is assigned to the channel;
- **baskets** belong to the store they were filled in: a customer who shops on two stores has a basket on each, priced by that store.

## What admins cannot do

- Reassign an Order or Quote Request to a different channel after creation. The attribution is immutable; this is a deliberate audit guarantee, not an oversight.
- Delete the system-default channel. The boot-time reconciler will recreate it on the next platform boot.
- Force two channels to be system-default simultaneously. The partial unique index prevents it at the database layer.
