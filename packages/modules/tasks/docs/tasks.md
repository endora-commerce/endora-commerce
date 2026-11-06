---
title: Tasks
description: Tasks for administrators — several assignees, due dates, priorities, tags, an operator-defined workflow, a list and a board, comments, sub-tasks, links, reminders and a daily digest — which other modules can own through a Task context
---

# Tasks (`tasks`)

The Tasks module keeps **tasks**: a piece of work for the people who use the
Admin UI. A task has a title, a formatted description, any number of
assignees, a due date (optionally with a time), a start date, a priority, tags,
custom fields and attachments. It moves through statuses the operator defines,
is shown as a list or as a board, can be discussed in comments, broken into
sub-tasks, linked to the opportunities, orders and quote requests it is about,
and reminds people of itself.

## What it does

Every task has a number, such as `TSK-000042`, given when it is created and
never reused.

**Statuses.** A task is always in one **status** of the operator's
**workflow**: the statuses, and the moves allowed between them (see
*Configuring Tasks*). Each status belongs to one **category** — *open*,
*finished* or *cancelled*. A task in a finished or cancelled status is
**closed**; every other task is **open**. A new task starts in the workflow's
start status. A fresh installation has four statuses, any of which may follow
any other:

| Status | Category |
| --- | --- |
| *To do* (`todo`) | open — the start status |
| *In progress* (`in_progress`) | open |
| *Done* (`done`) | finished |
| *Cancelled* (`cancelled`) | cancelled |

When a task enters a finished status the moment is recorded; leaving it clears
it again.

**Due date.** A task can have a due date, and with it a time of day. With a
time it is **overdue** from that moment while it is open; with a date alone,
from the start of the next day. Dates are counted in the time zone of the
Tasks module's settings (see *Settings*).

**Who sees a task.** A task can stand on its own, or belong to a record another
module owns — a project and one of its stages, for example. That record is the
task's **context**. A task with no context is visible to everybody allowed to
see tasks. A task with a context is visible only to the people the context's
own module says may see that record: someone who may not see a project does
not see its tasks either, anywhere — not in a list, on the board, in search,
in a reference or by its address. To them such a task does not exist.

Two more kinds of task are seen by fewer people:

- A **draft** is seen only by the person who created it — nobody else, whatever
  their permissions. Nobody is told about a draft and no reminder of it fires;
  it counts towards no project's completion gate. Its creator **publishes** it
  when it is ready; a published task cannot become a draft again.
- A **private** task is seen only by the person who created it and by holders
  of *See private tasks* — for example when its creator has left the company. A
  private task belongs to no record and can be assigned only to its creator.

A task can be both. Linking a task to an opportunity, an order or a quote
request does **not** change who sees it.

If the module that owns a context is switched off, the tasks of that context
disappear from the Tasks module until it is switched back on; nothing is
deleted.

## In the Admin UI

Tasks are in the sidebar under **Projects & tasks**: **My tasks**
(`/tasks/mine`) and **Tasks** (`/tasks`) for administrators who may view
tasks, and **Task settings** for those who configure them.

**Tasks** (`/tasks`) shows every task you may see, as a **list** or a
**board** — switch with *View*. The choice is remembered for you, on every
device you sign in from, and so are the filters you set while switching.

- **The list** shows each task's number, title, status, priority, tags, due
  date — marked *Overdue* once it has passed while the task is open —
  assignees, and the record it belongs to. That record is a link while it is
  available to you; one you may no longer see, or whose module is switched off,
  is named *Unavailable record*, without a link. *Sort by* orders it by when it
  was created or last changed, due date, priority, status (in workflow order),
  number or title. It pages forward and back, fifty tasks at a time.
- **The board** has one column per status, in workflow order, each stating how
  many tasks it holds and showing the first of them, with *Show more*. A card
  shows the task's title and the fields the operator chose (see *Configuring
  Tasks*) — by default its number, assignees, due date, priority and tags. Drag a card to another column to move the
  task there; with the keyboard, pick it up with Space or Enter, choose the
  column with the arrow keys, and drop it — or use the card's *Move to…* menu.
  A move the workflow does not allow is refused, and the card stays where it
  was. Without the permission to change tasks the board can be viewed but not
  moved.
- **Filters**, the same for the list and the board: status, open or closed,
  assignee (anyone, you, or nobody), created by (anyone or you), priority, tags
  (every one chosen), due from and until, only overdue tasks, only sub-tasks,
  only top-level tasks or only tasks with sub-tasks, only your drafts, only
  private tasks, the task custom fields marked as list filters, and a search by
  number or title. A *Tasks* panel's *Show in the task list* opens the list of
  one record's tasks, with *Show all tasks* to go back.
- **Saved views** keep a set of filters under a name, for you alone or shared
  with everyone who may view tasks, and apply to the list and the board alike.
  Only the person who saved a view, or a platform administrator, may change or
  delete it. A view that names a status, priority, tag or person that no longer
  exists still opens, leaving that value out and saying so.

**My tasks** (`/tasks/mine`) is your own open work: the published tasks
assigned to you that are not closed, the soonest due first and those without a
due date last, as a list or a board, with the same filters. Your drafts are not
in it — find them with the *Only my drafts* filter on **Tasks**. The **Daily
digest** control at its top turns your digest on and off and sets its hour.

**New task** (`/tasks/new`) asks for a title and, optionally, a description,
assignees — chosen by name among the active administrators who may view tasks,
or with *Assign to me* — a due date and time, a start date, a priority and
tags. *Create task* publishes it; *Save as draft* keeps it to yourself.
*Private* limits the assignees to you. A task created here belongs to no
record: a task of a project is added on the project's *Tasks* tab, into one of
its stages. Started from a record's *Tasks* panel, the task is linked to that
record; started from a task's *Add sub-task*, it is that task's sub-task.

**A task's screen** shows its number and title, its status — offering only the
moves the workflow allows — and *Draft* or *Private* when it is one. A draft
shows *Publish* to its creator; the creator of a task with no record can switch
*Private* on and off. Then:

- **Details** — the description, with its references as links; assignees, due
  date and time, start date, priority and tags, changed with *Edit* and saved
  together; *Assign to me*; who created the task and when, and when it was
  finished. *Delete task* asks before it deletes, and says how many sub-tasks
  the task has: they become top-level tasks, they are not deleted. It is not
  offered for a task of a record you may not change — a project you may not
  edit — and the screen says why.
- **Sub-tasks** — how many are done of how many, each with its status,
  assignees and due date; *Add sub-task* and *Make sub-task of…*. A sub-task
  names its parent, with *Remove from parent*.
- **Comments**, **Attachments** and **History**.
- Beside them: **Reminders**, **Belongs to** — the record the task belongs to,
  as its module names it, with *Place in a record*, *Move* and *Remove from the
  record* — **Linked records**, **Related tasks** and the task's **custom
  fields**.

Other modules can add panels at the end of a task's screen. Without the
permission to change tasks the screen is read-only.

**On other records.** The screens of an **opportunity**, an **order** and a
**quote request** end with a **Tasks** panel: the tasks linked to it that you
may see, with their status, assignees and due date, *Add task* — a new task
already linked to the record — and *Show in the task list*.

**The command palette** (⌘K / CTRL+K) offers *Tasks*, *My tasks*, *New task*,
*Task statuses and workflow*, *Task priorities* and *Task tags*, each to
administrators with the permission its screen needs. The Admin UI's **global
search** finds a task by its number or its title — only among the tasks you may
see.

## Using Tasks

**Creating a task.** A task needs only a title. It gets its number, starts in
the workflow's start status, and remembers who created it. It can be placed in
a record of another module — in this release, a stage of a project the creator
may see and edit; a task of a project always belongs to one of its stages. A
private task cannot be placed in a record.

**The description** is formatted text — bold, italic, strikethrough, links,
bulleted and numbered lists — written with the editor opportunities and
projects use. It can **refer** to things as you type: `@` a person, `@@` a
document — an order, a quote request, a task, an opportunity or a project, in
one grouped list — and `@@@` a product. Each group is offered only while its
module is switched on, and only to somebody who may read that kind of record. A
reference is shown as a link with the current number or name of what it refers
to, to whoever may see that; to anybody else, once it is gone, or while its
module is switched off, it is shown as unavailable and reveals nothing about
it. A description written before formatting existed reads as it did.

**Assignees.** A task has any number of assignees, up to twenty — each an
active administrator who may view tasks and, for a task of a record such as a
project, who may see that record. Assigning anybody else is refused, naming
them, and the assignee picker — on a task's screen, and on the new-task form
started inside a record — offers only those who may. Moving a task into another
record asks the same of the assignees it keeps. Somebody who loses sight of the
project after being assigned stays on the task, is not told about it, and does
not find it in *My tasks*. An assignee whose account is later deactivated stays on the
task, marked *inactive*; nobody is told anything on their behalf, and they can
be removed.

**Telling people.** In the Admin UI's notification bell, by the task's number
only — never its text — with a link to the task:

- a new assignee, when a task is created or assigned to them later, unless they
  assigned it themselves;
- a person **newly mentioned** in the description or in a comment, once;
- on a new **comment**, the task's assignees and its creator, except the
  author — and somebody both mentioned in it and assigned is told once.

Nobody is told about a task they may not see, about a draft, or by themselves.
While the *Admin notifications* module is switched off everything works the
same and nobody is told.

Every administrator has the bell and reads their own notifications on it,
whatever their role: no permission is needed for that. The *View notifications
sent to all admins* permission only adds the notifications addressed to every
administrator at once.

**Changing a status.** A task moves only along a move the workflow allows; any
other is refused, naming the statuses it may move to. The status control and
the board offer only the allowed ones. Closing a task whose sub-tasks are still
open is allowed: you are told how many are still open, and they are not closed.

**Priority and tags.** A task has at most one priority from the operator's list
— *Urgent*, *High*, *Normal* and *Low* until the operator changes it — and up
to fifty tags. Anybody who may change tasks chooses among the existing tags;
only somebody who configures tasks creates one.

**Custom fields.** The custom fields an operator defines for **tasks** on the
*Custom fields* screen are shown and saved on a task like an opportunity's, can
filter the list and the board when marked as list filters, and can be shown on
a board card.

**Attachments.** A file of up to 25 MB can be attached to a task — uploaded, or
chosen from the media library by somebody who may read it. HTML, SVG, XML and
JavaScript files are refused. Each attachment shows its name, size, who
attached it and when, and can be downloaded by anybody who may see the task and
removed by somebody who may change it. The file stays in the media library, and
the library refuses to delete a file a task uses — also while Tasks is
switched off. In the media library, a file used only by tasks somebody may not
see — private, draft, or of a record hidden from them — is hidden from them too,
and a file of a task cannot be attached elsewhere by somebody who may not see
that task.

**Comments.** Everybody who may see a task can comment on it, with the
description's editor and references. Comments are listed oldest first, with
their author and time. Only its author edits or deletes a comment; a deleted
comment leaves a mark saying it was deleted, and the history keeps that it was
written.

**Sub-tasks and related tasks.** A task has at most one parent. A task cannot
become a sub-task of itself or of one of its own sub-tasks, and nesting deeper
than five levels is refused. A parent shows how many of its sub-tasks are done
out of how many, in the list, on its board card and on its screen — counting
only the sub-tasks you may see. Deleting a parent makes its sub-tasks top-level
tasks. Two tasks can be linked as **related**: the link shows on both and can
be removed from either; it needs the permission to change both.

**Linked records.** A task can be linked to up to twenty opportunities, orders
and quote requests — each by somebody who may read it — besides the one
record it may belong to. Linking a record twice keeps one link. A linked record
you may not see, one that is gone, or one whose module is switched off is shown
as *Unavailable record*; the link is kept, and shows the record again when its
module is back.

**Reminders.** Somebody who may change a task can add up to ten reminders to
it, each **at a date and time** or **before the due date** — 15 minutes, an
hour, a day, two days or a week before — for themselves and any of the task's
assignees. At that moment each recipient gets one notification in the bell and
one e-mail naming the task, with a link. A reminder before the due date moves
with the due date, and fires again at the new moment; when the due date is
removed, the reminder is removed too and the task's history says so. Nothing is
sent to a recipient who may no longer see the task, who has been deactivated,
or about a task that is closed, deleted or a draft. If the platform was down at
the moment, the reminder is sent once when it is back — if the moment is less
than 24 hours past; an older one is not sent. You see the reminders you set and
those that name you; *Sent* marks one that has gone out. A reminder can be
removed by whoever set it, or by somebody who may change the task.

**The daily digest.** Turn it on, on *My tasks*, and choose an hour: each day at
that hour in the Tasks time zone you get one notification and one e-mail
listing your open tasks due that day and those overdue. On a day with none,
nothing is sent; a task that becomes due later that day is in the next day's
digest. The digest is off until you turn it on.

**Drafts and private tasks.** *Save as draft* keeps a new task to yourself:
nobody is told about it, no reminder of it fires, and nobody else finds it
anywhere — not even a holder of *See private tasks*. *Publish* makes it a normal
task, and its assignees and the people its description mentions are told as
for a new task. A private task is shown with *Private*; a holder of *See
private tasks* may read and delete somebody else's private task, and change
nothing about it.

**Deleting a task** removes it for good; its sub-tasks become top-level tasks.

Adding a task to a record, taking one out of it — to no record or to another
one — and deleting a task of a record are changes to that record's work, so
the record's module decides who may make them: for a project, somebody who may
edit the project. Moving a task between the stages of one project, and every
other change to a task, needs only the permission to change tasks.

**History.** Every change of a task — its fields, assignees, status, priority,
tags, parent, links, attachments, reminders, comments edited or deleted,
publication and privacy — is recorded with who did it and when, and the task's
history lists them, newest first. The history records the length of a
description, never its text. A project the task has left, and you may not see,
is not named in it.

## Configuring Tasks

Holders of *Configure tasks* reach these screens from **Task settings** in the
sidebar and from the command palette; each links to the others.

**Statuses and workflow** (`/tasks/settings/workflow`). Add, rename — in English
and in Polish — recolour, reorder and remove statuses; mark the start status;
add and remove moves on the workflow graph, the editor orders and opportunities
use. A workflow is refused unless exactly one status is the start status and is
open, at least one is finished and at least one is cancelled. A status tasks
are in cannot change its category, and is removed only by choosing the status
its tasks move to — each move recorded in that task's history. On the same
screen, **Board card** chooses which fields a board card shows, and in what
order — at most six of: number, assignees, due date, priority, tags, start
date, the record it belongs to, sub-tasks done, created, last changed, and any
task custom field.

**Priorities** (`/tasks/settings/priorities`). Add, rename — in English and in
Polish — recolour and reorder priorities; sorting by priority follows that
order, the most urgent first, tasks without one last. Removing a priority tasks
have asks which priority — or none — they get instead, and records that in each
task's history.

**Tags** (`/tasks/settings/tags`). Add, rename, recolour and delete tags. Names
are unique whatever their letter case, up to 64 characters. Deleting a tag asks
for confirmation and removes it from every task that carries it; the deletion is
recorded once, on the tag, with how many tasks carried it.

**General settings** (`/tasks/settings/general`). The **time zone** in which
Tasks counts "today": when a task with a due date alone becomes overdue, when a
reminder before such a date fires, and the hour of the daily digest.

## Settings

| Code | Default | Meaning |
| --- | --- | --- |
| `tasks.enabled` | on | Whether the module is switched on — change it on the **Modules** screen. |
| `tasks.time_zone` | `Europe/Warsaw` | The IANA time zone Tasks counts dates in. Change it on **Task settings → General settings**. |
| `tasks.board_card_fields` | number, assignees, due date, priority, tags | The fields a board card shows, in order. Change it in the **Board card** section of **Task settings**, which offers the fields that exist. |

## Switching it on and off

Tasks is an optional module. It is on by default and an operator switches it
off, and back on, on the **Modules** screen of the Admin UI
(`/platform/modules`).

While it is off:

- the *My tasks*, *Tasks* and *Task settings* entries and every task screen are
  gone from the Admin UI, and so are a project's *Tasks* tab and its stage
  tasks, the *Tasks* panels of opportunities, orders and quote requests, the
  command-palette actions and tasks in the global search;
- every `/api/v1/admin/tasks…` endpoint answers `503` with the code
  `MODULE_DISABLED`, and its settings cannot be changed;
- no reminder and no digest is sent, and nothing accumulates: when the module
  is back, a reminder whose moment passed less than 24 hours earlier is sent
  once, an older one never, and only that day's digest goes;
- its permissions can no longer be granted to a role;
- other modules can neither read nor create tasks: a module that offers tasks
  as part of its own screens shows them as unavailable, and a task referred to
  in their texts reads as unavailable.

Nothing is deleted. Every task stays in the database, and everything is back
exactly as it was when the module is switched on again. A project — or a stage
— deleted while Tasks was off is the one exception that catches up: within
fifteen minutes of Tasks being back on, the deleted project's tasks are deleted
and the deleted stage's tasks stay in their project with no stage, each
recorded in the audit log.

## Permissions

| Code | What it allows |
| --- | --- |
| `tasks:read` | View tasks — the list, the board, *My tasks*, a single task, its comments, attachments and history — subject to each task's context, drafts and private tasks; comment on the tasks you see; keep saved views and your daily digest. |
| `tasks:write` | Create, change, assign, link, remind and delete tasks. Requires `tasks:read`. |
| `tasks:configure` | Configure the workflow, priorities, tags, board card and time zone. Requires `tasks:read`. |
| `tasks:see_private` | See other people's private tasks — read and delete only, never change, and never their drafts. Requires `tasks:read`. |

## Upgrading from the first version

- **Statuses are now configurable.** The four statuses become the default
  workflow, every move between them allowed, so everything behaves as before
  until an operator changes it, and every task keeps its status. A project's
  completion gate treats every finished and cancelled status as closed.
- **Existing assignees are kept**, as each task's first assignee. Every task
  is published and has no priority, tag, start date or due time.
- **For integrations:** a task's `assignedAdminUserId` became `assigneeIds`
  (`assignees` in the API's answers), a status is a code with its category,
  `PATCH /api/v1/admin/tasks/:id` no longer takes `status` (use
  `POST …/:id/status`), `DELETE …/:id` answers `200` with
  `{ data: { subtasksDetached } }` instead of `204`, and the event
  `tasks.task.assigned.v1` is replaced by `tasks.task.assignees_changed.v1`
  (see *Events*).

## For developers

### The API

Every route is under `/api/v1/admin/tasks`; the request and response shapes are
the Zod schemas of `@endora-commerce/contracts` (`tasks.ts`). A task the caller
may not see — its context, a draft of somebody else's, a private task without
`tasks:see_private` — answers `404` `TASK_NOT_FOUND`, exactly like a task that
does not exist.

| Method and path | Permission | What it answers |
| --- | --- | --- |
| `GET /` | `tasks:read` | `{ items, nextCursor, prevCursor? }`. Filters: `status`, `statusCategory`, `assignee` (`me`, `none` or an id; any of), `creator` (`me` or an id), `priority` (codes or `none`), `tagId` (every one), `dueFrom`, `dueTo`, `overdue`, `linkedKind` with `linkedId`, `parentId`, `isSubtask`, `hasSubtasks`, `draft` (the caller's own), `private`, `customFieldFilters`, `q`; `sort` (`created`, `number`, `title`, `due`, `priority`, `status`, `updated`) and `dir`; `cursor`, `limit` (at most 100). An unknown status, priority or tag matches nothing. |
| `GET /mine` | `tasks:read` | `{ data }` — the caller's open, published tasks, by due moment, undated last (at most 500); the same filters. |
| `GET /board` | `tasks:read` | `{ data: { columns: [{ status, count, items, hasMore }] } }`, one column per status in workflow order; the list's filters and `perColumn` (at most 50, default 25). |
| `POST /` | `tasks:write` | `{ title, description?, assigneeIds?, dueOn? \| dueAt?, startOn?, priorityCode?, tagIds?, customFieldValues?, context?, parentTaskId?, links?, draft?, private? }` → `201` `{ data: TaskDetail }`. |
| `GET /:id` | `tasks:read` | `{ data: TaskDetail }` — with `references`, `links`, `subtaskItems`, `relatedTasks`, the caller's `reminders` and `permissions { canChange, canDelete, canPublish }`. |
| `PATCH /:id` | `tasks:write` | Any field of the create body but `draft`; `assigneeIds` replaces, `addAssigneeIds` / `removeAssigneeIds` adjust; `parentTaskId: null` detaches; `private` by the creator only. |
| `POST /:id/status` | `tasks:write` | `{ to, from }` → `{ data: { task, openSubtasks } }`; `409` `TASK_TRANSITION_FORBIDDEN` (`details.allowedTargets`), `409` `TASK_TRANSITION_CONFLICT` when the task left `from` meanwhile, `422` `TASK_STATUS_UNKNOWN`. |
| `POST /:id/publish` | `tasks:write` | The creator's draft becomes a task; `409` `TASK_ALREADY_PUBLISHED`. Somebody else's draft is `404`. |
| `DELETE /:id` | `tasks:write`, or `tasks:read` with `tasks:see_private` for a private task | `200` `{ data: { subtasksDetached } }` — the former sub-tasks the caller may see. |
| `GET /:id/history` | `tasks:read` | The task's audit trail, newest first (`RecordHistoryPage`). |
| `GET`, `POST /:id/comments`; `PATCH`, `DELETE /:id/comments/:commentId` | `tasks:read` | Comments, oldest first, references resolved; somebody else's comment is `403` `FORBIDDEN`. |
| `GET`, `POST /:id/attachments`; `POST /:id/attachments/upload`; `DELETE /:id/attachments/:attachmentId` | `tasks:read` to list, `tasks:write` to change | `{ assetId }` attaches a library file (with the library's read permission); `upload` takes a multipart file; `413` / `415` `TASK_ATTACHMENT_REFUSED`. |
| `PUT`, `DELETE /:id/relations/:otherId` | `tasks:write` on both | `204`, idempotent both ways. |
| `POST /:id/links`; `DELETE /:id/links/:linkId` | `tasks:write` | `{ kind, id }` → `201` a new link, `200` the existing one; `422` `TASK_LINK_INVALID`. |
| `GET`, `POST /:id/reminders`; `DELETE /:id/reminders/:reminderId` | `tasks:read` to list, `tasks:write` to add | `{ remindAt }` or `{ offsetMinutes }`, and `recipientIds`; `422` `TASK_REMINDER_INVALID`. Its creator, or a holder of `tasks:write`, removes one. |
| `GET /lookups/assignees`, `/lookups/mentionable`, `/lookups/documents`, `/lookups/records`, `/lookups/contexts` | `tasks:write` (`mentionable`: `tasks:read`) | The pickers: assignees, people to mention, the `@@` document list (groups `order`, `quote_request`, `task`, `opportunity`, `project`, each for its readers while its module is on), link targets, and projects with their stages. |
| `GET /custom-field-filters` | `tasks:read` | The task custom fields usable as list filters. |
| `GET /workflow`; `POST /statuses`; `PATCH`, `DELETE /statuses/:code`; `PUT /transitions` | `tasks:read` to read, `tasks:configure` to change | Every write answers the whole workflow; `422` `TASK_WORKFLOW_INVALID` (`details.rule`); removing a status in use needs `?replacement=`; `409` `TASK_STATUS_IN_USE_TOO_MANY` above 5,000 tasks. |
| `GET`, `POST /priorities`; `PATCH`, `DELETE /priorities/:code` | `tasks:read` to read, `tasks:configure` to change | As statuses; `replacement` may be `none`. |
| `GET`, `POST /tags`; `PATCH`, `DELETE /tags/:id` | `tasks:read` to read, `tasks:configure` to change | `409` `TASK_TAG_NAME_TAKEN`. |
| `GET`, `PUT /board/card-fields`; `GET`, `PUT /settings/time-zone` | `tasks:read` to read, `tasks:configure` to change | Written through the Settings module's own audited write. |
| `GET`, `POST /list-views`; `PATCH`, `DELETE /list-views/:id` | `tasks:read` | Saved views; `409` `TASK_VIEW_NAME_TAKEN`. |
| `GET`, `PUT`, `DELETE /me/digest` | `tasks:read` | The caller's digest: `{ hour }`, or `null` when it is off. |

Every write also refuses `403` `TASK_PRIVATE_READ_ONLY` to a holder of
`tasks:see_private` working on somebody else's private task, `422`
`TASK_PRIVATE_ASSIGNEE` for anybody but the creator on a private task, `422`
`TASK_PARENT_CYCLE` and `TASK_HIERARCHY_TOO_DEEP` for the hierarchy, and `422`
`TASK_PRIORITY_UNKNOWN` / `TASK_TAG_UNKNOWN` for a priority or a tag that does
not exist. The list/board choice is the admin preference `listViewModes`
(`tasks`, `tasks-mine`), served by the Admin users module.

A `context` written through the API must belong to a switched-on module that
lists the record as one you may see, and — when the record has groups, such as
a project's stages — name one of them; otherwise `422` `TASK_CONTEXT_INVALID`.
A task's `context` is read as `{ type, id, groupId, available, label, href,
groupLabel }`. When the owning module no longer describes the record,
`available` is `false`, `label` reads *Unavailable record* in your language and
`href` and `groupLabel` are `null`.

### Task contexts

The Tasks module names no other module. A module that wants tasks of its own
registers a **Task context** — a context type it owns, such as `project` —
and from then on tasks can carry that type, the id of one of its records and,
optionally, the id of a group inside the record (a project's stage).

The registry is the container entry `taskContextRegistry`
(`TaskContextRegistryPort`). It is registered ungated, so push into it from a
**contribution-only boot hook with no presence probe**, and declare the edge in
your manifest's `nonBindingDependencies` as `contributes-to`:

```ts
ctx.onBoot(() => {
  lazyPort<TaskContextRegistryPort>(ctx, 'taskContextRegistry').register({
    contextType: 'project',
    ownerModuleId: 'projects',
    allVisibleContextIds: () => /* every record id the caller may see */,
    visibleContextIds: (ids) => /* which of these ids the caller may see */,
    describe: (ids) => /* id → { label, href, groups: groupId → label } */,
    canSeeAs: (adminUserId, id) => /* may that administrator see this record? */,
    canChangeTasks: (id) => /* may the caller add, take out or delete a task of this record? */,
    existingContexts: (ids) => /* id → the group ids it has now, for each id that still exists */,
  });
});
```

The contract a descriptor keeps:

- **Every method but `existingContexts` runs under the caller's own tenant
  context.** Answer for the caller, exactly as your own screens would.
- `allVisibleContextIds()` is the list pre-filter: the Tasks list and board ask
  it once per request and narrow their query to those ids, so pages stay
  exact. Keep it cheap.
- `visibleContextIds(ids)` answers for a single task, or a few.
- `describe(ids)` is how a task shows its context: a label, an address in the
  Admin UI, and the labels of the record's groups.
- `canSeeAs(adminUserId, id)` is the one method that answers for **somebody
  else**: whether that administrator, by their own permissions and reach, may
  see the record. It is asked before anybody is told about a task of the
  record — an assignee, a mention, a comment, a reminder, the digest; `false` —
  or an owner that is switched off — means nobody is told.
- `canChangeTasks(id)` decides whether the caller may change which tasks the
  record holds: put a task **into** it (create it there, or move it there), take
  one **out of** it (detach it with `context: null`, or move it to another
  record) or **delete** one of its tasks. Moving a task between the record's own
  groups, and editing a task where it is, are not asked. Projects answers yes to
  a holder of `projects:write` who sees the project; `false` refuses putting in
  and taking out with `422` `TASK_CONTEXT_INVALID`, and deleting with `403`
  `FORBIDDEN`.
- `renderNote(note, language)`, optional, words the note your module left on a
  task when it created it (`contextNote` of `taskWritePort.createMany`) in the
  reader's language. Store a key rather than a sentence — Projects stores the
  responsible role — and answer the sentence here; without it the note is shown
  as stored.
- `existingContexts(ids)`, optional, answers **which of these records still
  exist, and the group ids each has now** — a map from each existing id to its
  set of group ids. It is asked **only under the system actor**, by the
  maintenance pass below, and must answer regardless of who may see the
  records. **An id missing from the answer deletes that record's tasks**, so an
  id your module cannot vouch for — one it cannot read, or does not recognise —
  must be answered as existing. A group missing from an existing record's set
  takes the record's tasks out of that group. A module without the method is
  never cleaned up.
- One context type has one owner; registering a second, different descriptor
  for a type already taken stops the backend at boot.
- **The policy is fail-closed.** A task whose context type nobody registered,
  or whose owner is switched off, is hidden from lists, boards, counts and by
  id, and reappears when the owner is back. The system — a background job with
  no administrator behind it — is never narrowed.

**The maintenance pass.** A context owner deletes the tasks of a record it
deletes through `taskWritePort.deleteInContext` — but only while Tasks is on.
What was deleted while Tasks was off is found by the third pass of the
`tasks-reminders` worker, which runs at most every **fifteen minutes**: for each
**present** owner that implements `existingContexts`, it reads the distinct
contexts its tasks name, 500 at a time, and asks the owner about them. Each
task of a gone record is deleted through the module's delete command
(`deleteTaskCommand(id, auditLog, { reason, onlyIn })` — re-read under a lock,
left alone if it moved meanwhile, its sub-tasks detached) with the audit row's
reason `context_gone`; each task of an existing record whose group is gone loses
its group, a `tasks.task.update` audit row with the reason
`context_group_gone`. One command per task, each with its own audit row. An
owner that is switched off is not asked, so nothing of it is taken for gone; a
pass with nothing to do enters no system scope.

### Reading and writing tasks from another module

Two ports, both gated — resolving either while Tasks is off throws, and the
call answers `503` `MODULE_DISABLED`. Resolve them with `lazyPort` and declare
them `degrades-without` with a `whenAbsent` sentence.

| Port | Methods |
| --- | --- |
| `taskReadPort` (`TaskReadPort`) | `findById`, `findByIds`, `search` (number or title), `listInContext`, `listOpenInContext` (open category and not a draft — a completion gate's question), `countInContext`. A `TaskRecord` carries `status` (a code), `statusCategory`, `closed`, `assigneeIds`, `dueAt`, `draft` and `private`. Narrowed by the full visibility rule for an administrator — context, drafts, private tasks — not for the system. |
| `taskWritePort` (`TaskWritePort`) | `createMany({ context, tasks })` — at most 100 tasks, each `{ title, description?, assigneeIds?, dueOn?, contextGroupId?, contextNote?, sourceKey? }`, published, in the workflow's start status; one audited `tasks.task.create` command and one `tasks.task.created.v1` event per task created; refused with `TASK_CONTEXT_INVALID` when no switched-on module owns the context type and with `TASK_ASSIGNEE_INVALID` when an assignee is not an active administrator, before anything is written. Whether an assignee may see the record is the owning module's to decide — a project assigns each stage task to the member holding its role — so the port does not ask it, as the Tasks screens and API do. `deleteInContext({ contextType, contextId })` — every task of one record, one audited `tasks.task.delete` command each. |

**`sourceKey` makes creation idempotent.** A task given a `sourceKey` (up to 100
characters) is created only if the context holds no task with that key; the
answer's `ids` are in input order, an existing task's id standing where it was
asked for. A key repeated in one call is created once, and two calls at once
with the same keys create each task once — the database's unique key decides,
and the loser answers the winner's id. Projects passes each stage task
definition's id, which is what makes its *Create the stage's tasks again*
safe to repeat.

Call `createMany` **after your own transaction has committed**: each task is
written in a transaction of its own.

`./backend` also exports **`nextTaskNumber(em)`**, the module's door to its
number sequence — the next `TSK-…` number on the caller's transaction, for code
that writes tasks without a Command, such as the demo composition; one format
and one sequence, whoever creates the task.

### Notifications, reminders and the digest

Bell entries go through `adminNotificationRecordPort` (a `degrades-without`
edge), with subject `task`, after the write has committed: `tasks.task.assigned`,
`tasks.task.mention`, `tasks.task.comment`, `tasks.task.reminder` and
`tasks.digest.daily`. Every recipient is asked first whether they may see the
task — `tasks:read`, drafts and private tasks, and the context's `canSeeAs`.

A reminder's bell entry is written with **`recordWithin(em, input)`**, the
port's co-transactional method: in the same transaction as the reminder's
delivery row, which is unique per reminder and recipient. So the bell entry is
written **exactly once**, even when two workers run the pass at once, and the
e-mail — sent after the commit, as the transactional e-mail
`tasks_task_reminder` — **at most once**: a crash between the commit and the
send loses the e-mail and keeps the bell entry. A reminder more than 24 hours
late is recorded as `expired`, one for a recipient who may no longer be told as
`skipped`, and neither sends anything. The digest claims each subscriber's day
before it sends (`tasks_daily_digest`), so it is sent at most once a day.

All three passes — reminders every minute, the digest and the maintenance pass
at most every fifteen minutes — run in the one BullMQ Job Scheduler
`tasks-reminders`, attached through `ctx.worker` only in a process that runs
workers. A tick decides the module's presence first, then asks each pass's
one-bit probe outside any tenant scope, and enters a system scope only for a
pass with work; a tick with nothing to do writes no `tenant.escape_hatch`
audit row.

### Events

| Event | Payload |
| --- | --- |
| `tasks.task.created.v1` | `{ taskId, contextType, contextId, contextGroupId, assigneeIds }` |
| `tasks.task.status_changed.v1` | `{ taskId, from, to, toCategory, contextType, contextId, contextGroupId }` — `from` and `to` are status codes. |
| `tasks.task.assignees_changed.v1` | `{ taskId, added, removed }` — **replaces** `tasks.task.assigned.v1` |
| `tasks.task.deleted.v1` | `{ taskId, contextType, contextId }` |

Each is emitted once per command, after it commits. A change of several kinds
at once — a `PATCH` with a new title and new assignees — is one command per
kind, each with its own audit row. **A draft emits no event** until it is
published: `tasks.task.created.v1` is emitted at publication, with the
assignees the task has then. Removing a status or a priority moves its tasks
with one audit row each and no event.
