---
title: Merging duplicate organizations
description: How an operator merges a duplicate organization into the one that stays, follows the merge and resumes one that needs attention.
---

# Merging duplicate organizations

When the same company exists twice — an ERP import created a second organization, or a buyer
registered again — merge the duplicate into the organization that stays. The duplicate's
members, addresses, orders, quote requests, invoices and every other record follow the
organization that stays, and the duplicate is archived with a pointer to it.

**A merge cannot be undone.** There is no unmerge. Check the preview before you start.

## Who can merge {#who-can-merge}

- You need the **Merge duplicate organizations** permission (`organizations:merge`). It is not
  part of the predefined sales-representative role; an administrator grants it on the role
  screen.
- You must be able to see **both** organizations. An organization assigned to another sales
  representative cannot be picked.
- A personal (B2C) organization is never merged. To move a person into a company, change their
  membership instead.

## Starting a merge {#starting-a-merge}

Open the organization that **stays** and choose **More → Merge a duplicate into this
organization…**. You can also press ⌘K / CTRL+K and choose **Merge organizations**, which first
asks for the organization that stays.

The flow has three steps:

1. **Choose the duplicate.** Search by name or tax ID. Only company organizations you can see
   are listed.
2. **Review and choose values.** The preview shows, per area, how many records will move, any
   conflict and how it will be resolved, and any warning (for example credit exposure above the
   limit after the merge). Where the two organizations hold different values — name, legal
   name, tax ID, VAT status, registered address, customer group, credit inheritance mode,
   fulfilment strategy and custom fields — choose the value to keep. The organization that
   stays keeps its own value unless you choose otherwise, and a value it left empty takes the
   duplicate's. Order confirmation e-mails are always combined.
3. **Confirm.** Tick *I understand that a merge cannot be undone* and choose **Start the
   merge**. The merge's progress opens.

### When the merge is refused {#when-the-merge-is-refused}

The preview says in words why two organizations cannot be merged, before anything is written:

| You see | What to do |
| --- | --- |
| A record cannot be merged into itself | Pick the duplicate, not the organization that stays. |
| One of the records is deleted, already merged or rejected | Nothing; that organization can no longer be merged. |
| A personal organization cannot be merged | Change the person's membership instead. |
| The duplicate is above the organization to keep in the tree | Merge them the other way round, or move one of them first. |
| The organizations belong to different trees | Move one into the other's tree first, then merge. |
| Another merge already involves one of these records | Wait for it, or resume it if it needs attention. |
| **Merging is not available yet** | See below. |

**Merging is not available yet** lists the areas of the platform that cannot yet move their
records to the organization that stays. Until every area that holds records of an
organization can do so, the preview works and the start is refused. Nothing is lost by
previewing; start the merge once the notice is gone.

## Following a merge {#following-a-merge}

The merge runs in the background, in phases: structure, configuration, addresses, members,
records and finalize. The progress page (**Organization merges**, or the link on either
organization's screen) shows every step, what it moved and how many steps are finished. While
it runs:

- the duplicate cannot be changed — by you, by its buyers or by an integration;
- the organization that stays works as usual;
- both organizations' screens say that a merge is running and link to it.

You can **cancel** a merge from the progress page (**More → Cancel the merge**) only before any
record has moved. Afterwards it can only finish.

An area that is switched off when the merge reaches it is skipped and shows as *Deferred*; its
records follow automatically once it is switched on again.

## When a merge needs attention {#when-a-merge-needs-attention}

A step that keeps failing is retried, and then the merge stops in **Needs attention**. Every
administrator who may merge and sees both organizations gets a notification linking to the
merge. Open **Organization merges** (⌘K → *Organization merges*), which lists the merges that
need attention first, and choose **Resume**. Finished steps are not repeated.

When a merge completes, the administrator who started it is notified.

## After the merge {#after-the-merge}

- The duplicate is **archived**: it appears in no list, picker or search. Opening its address
  shows *Merged into … on … by …*, links to the organization that stays and is read-only.
- The organization that stays lists it under **Merged organizations** on its Overview tab,
  with a link to the merge.
- The audit log holds entries for the start and the finalize, and every change the merge made
  carries the merge's id. Field values are never written to the audit log, only
  the names of the fields chosen.
- Integrations receive one `organization.merged.v1` event and webhook. A request that still
  names the duplicate's id is refused with the id of the organization that stays.
