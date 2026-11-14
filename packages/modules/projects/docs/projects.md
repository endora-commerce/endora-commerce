---
title: Projects
description: Projects for zero or more Organizations, run through their own Stages by Members holding Project Roles
---

# Projects (`projects`)

The Projects module keeps **projects**: a piece of work for one or more
Organizations — or for none, an internal project — run through **stages** of
its own by **members** who hold **project roles** such as *Sales Rep* or
*Project Manager*.

## What it does

Every project has a number, such as `PRJ-000042`, given when it is created and
never reused, a title, an optional value with its currency, and a start date.
A project is **open** while it runs and ends **completed** or **lost**; a
closed project can be reopened.

A project is for **zero or more Organizations**. A project for none is an
**internal** project.

Each project has its own **stages** — a name, a colour and a planned duration
in days — and its own **workflow**: the moves allowed between its stages. An
open project is always in exactly one stage.

The project roles are a list the operator keeps. Two are there from the start,
*Sales Rep* and *Project Manager*, and can be renamed or archived but not
deleted. A role is a label on a member of one project: it grants no permission
anywhere. The same person can hold different roles on different projects. The
reasons a project can be lost — *Price*, *Chose a competitor*, *Cancelled by the
client*, *No decision* and *Other* — are a list the operator keeps the same way.

## In the Admin UI

Projects are in the sidebar under **Projects & tasks → Projects** (`/projects`),
for administrators who may view projects. Their configuration is in the same
section, for administrators who may configure projects: **Templates**
(`/projects/templates`), **Project roles** (`/projects/roles`) and **Loss
reasons** (`/projects/loss-reasons`). **Analytics** (`/projects/analytics`) is
there too, for administrators who may view project analytics (see
*Analytics*).

**The list** shows every project you may see: its number, title,
Organizations — or *Internal* — the current stage with its deadline, marked
*Overdue* once it has passed, the value and the project managers. Filter it by
state, by Organization, to the projects you are a member of or those of any one
member, by a project role somebody holds on them, by the template they were
created from, and by the name of their current stage; search by number or
title, and sort it by creation date, value or the current stage's deadline;
projects without a value or a deadline come last either way.

**New project** (`/projects/new`) first offers the **templates**: choosing one
fills in the description and offers the template's roles first to each member,
and lists the stages the project will get from it — with their workflow, gates,
alerts and stage tasks — which are changed on the project's *Stages* tab once
it exists. Without a template the form asks for the stages, in order — a name,
a colour and a planned duration in days for each, at least one. Either way it
asks for a title and optionally the Organizations, a value with its currency, a
start date, a description and the members, each with the roles they hold;
whatever a template filled in can still be changed. With no Organization the
project is internal, and the form says who will see it. Last, it asks **who
sees the project** — following the module setting, the default; everyone who
may view projects; or its members and the people listed on it, who are then
chosen there — and says in one sentence what the choice means now (see *Who
sees a project*). The Organizations offered are the ones you can reach, and the
people offered are the active administrators: filling the form needs no
permission beyond creating projects. After that come the project's custom
fields, where the operator has defined any (see *Custom fields*).

**A project's screen** names the project, its state, value and Organizations.
Below them is the **stage bar**: every stage in order, the current one marked,
its deadline, and only what the project may do next — a button for each move
its workflow permits, *Close as completed* where the current stage permits
completion, and *Close as lost*, which asks for a loss reason and an optional
comment. A closed project says when and in which stage it ended and offers
*Reopen*. When somebody else changed the project in the meantime, or another
module refuses the change, the screen says why and shows the project as it is
now; when a completion gate refuses it, the open tasks it names are listed, each
a link to the task.

*Delete project* asks before it deletes. A project with linked records is not
deleted: the screen says so, and the records have to be unlinked first.

Its tabs:

- **Overview** — the description — its references drawn as links, and edited
  with *Edit description* (see *Notes, messages and references*) — the start
  date, **who sees the project** and the members by role. An administrator who may create and run projects
  changes who sees it there — the same three choices as on *New project* — and
  saves it with *Save who sees it*; everybody else is told what it is and who is
  listed.
- **Stages** — each stage's name, colour, planned duration, responsible roles,
  alert days, completion gate, whether the project may be completed from it
  and a deadline set by hand, saved one stage at a time; stages are added at the end, moved up or down
  and deleted here. With the Tasks module on, each stage also lists its
  **stage tasks** — a title, the days after the stage starts that the task is
  due, and the responsible role — saved as one list per stage; a stage whose
  tasks could not be created when the project entered it says so and offers
  *Create the stage's tasks again*. Below the stages the **workflow**, drawn as
  a graph, where moves are added and removed; a stage no move reaches from the
  first one is named in a warning.
- **Tasks** — with the Tasks module on, for administrators who may view tasks:
  every stage in order with its tasks — number (a link to the task), title,
  status, assignee and due date, overdue ones marked — and, for administrators
  who may create tasks and edit the project, a field under each stage that adds
  a task to it by its title. Adding a task to a project, taking one out of it
  and deleting one of its tasks — here or on the Tasks screens — needs the
  permission to edit projects as well as the one to change tasks.
- **Linked records** — the Orders, Quote Requests and Opportunities linked to
  the project (see *Linking records*).
- **Stage history** — every entry into a stage, every close and every reopen,
  newest first, with who did it and when.
- **Notes** and **Messages** — see *Notes, messages and references*. The
  *Messages* tab counts the messages you have not read yet.
- **Attachments** — see *Attachments*.
- **Change history** — everything done to the project, newest first: who did
  it, when, and the fields it changed, read a page at a time with *Show earlier
  changes*. A note or a message is recorded by its length, never by what it
  says. A change of the title, the value or a custom field shows it before and
  after — the project keeps those itself; the platform's audit log, which is
  not kept per Organization, names only *which* fields changed. Entries
  recorded before the title was kept this way still show it as recorded. An
  Organization outside your reach that the project once had is not named in
  it.

**On the screens of the records a project holds** — an Order, a Quote Request,
an Opportunity, a Task — a **Project** panel names the project it belongs to:
its number, a link to it, its title, its state and its current stage with the
stage's deadline. A record in no project, or in a project you may not see,
shows no panel at all.

**On an Organization's screen** a **Projects** panel lists the projects of that
Organization you may see, newest first — the ten newest, saying how many there
are and linking *All projects* to the projects list when there are more — each with
its number, a link to it, its title, its state and its current stage.
Administrators who may create projects get *New project* there, which opens the
form with the Organization already chosen.

**The command palette** (⌘K / CTRL+K) offers *Projects*, *New project*,
*Project templates* and *Project analytics*, each to administrators with the
permission its screen needs. The Admin UI's **global search** finds a project
by its number, its title or the name of one of its Organizations — only among
the projects you may see.

Without the permission to create and run projects the screen is read-only: the
stages, the workflow and the history are shown, and nothing can be changed.

**Templates** (`/projects/templates`) lists the templates by name with their
number of stages; archived ones are listed on request, marked *Archived*. A
template's screen — or *New template* — edits its name, default description and
project roles, and its stages with the same fields, stage tasks and workflow
graph as a project's *Stages* tab; everything is saved together with *Save
template*. *Duplicate* makes an independent copy and opens it; *Archive* takes
the template out of the choices of *New project*, and *Restore* puts it back.

## Running a project

**Creating a project.** A project is created with a title and its stages, in
order; optionally a description, a value with its currency, a start date (today
if left out), its Organizations, its members with their roles, and who sees it.
It gets its number, is **open**, and starts in its **first stage**. Every
Organization named must be one the person creating the project can reach, and
every member and listed person an active administrator. A member may hold any
number of roles, none included.

**Stages.** Each stage has a name, a colour, a planned duration in days, the
roles responsible for it, and whether the project may be completed from it.
Completing is permitted from the last stage unless the stages say otherwise. A
stage also keeps whether it is a **completion gate** for its tasks and its own
**stage tasks** — both described under *Stage Tasks and the completion gate*
below — and the days before its deadline on which its members are alerted
(see *Deadline alerts*). Stages
can be added (at the end), renamed, recoloured, reordered and removed — except
the stage the project is in, a project's only stage, and a stage that holds
tasks.

**The workflow.** The moves a project may make between its stages are its own.
By default each stage moves to the next one, and a stage added at the end is
reached from the stage that was last before it. The workflow can be replaced
with any set of moves — back from *Delivery* to *Design*, or skipping *Pilot*.
A stage no move reaches from the first one is allowed; the project names it as
**unreachable** so that the workflow can be corrected.

**Moving.** A project moves only along a permitted move; any other move is
refused and nothing changes. Entering a stage records the day it started —
today, in the time zone of `projects.alerts_time_zone` — and its deadline: that
day plus the stage's planned duration, or the day itself for a duration of
zero. A deadline set by hand — on the *Stages* tab, where emptying the field
returns the stage to its start plus its planned duration — is kept, and the
stage bar says it was set by hand. Entering a stage again starts it again.

**Closing.** A project is closed as **completed** from a stage that permits
completion, or as **lost** from any stage — with a loss reason from the list
and an optional comment; the stage it was lost in is recorded. A closed project
can be **reopened**: it returns to the stage it was closed in and its outcome
is cleared.

**Two people at once.** Every move, close, reopen and edit names the version of
the project it was made on. If somebody else changed the project in the
meantime, the change is refused and nothing is applied twice: reload the
project and try again.

**History.** Every entry into a stage, every close and every reopen is a row of
the project's stage history, with the stage names as they were, who did it and
when; every change is also in the audit log.

**Logic of other modules.** Another module, or a deployment, can register a
check that runs before a move, a close or a reopen and refuses it with a reason
of its own; a module that is switched off is not asked. What happened is
announced afterwards as an event.

The Tasks module is not needed for any of this: a project runs through its
stages with Tasks switched off.

## Stage Tasks and the completion gate

With the Tasks module switched on, a project's stages hold **tasks** — a task
of a project always belongs to one of its stages. A task in a project is a
task of the Tasks module like any other (its number, assignee, due date and
status are described on the Tasks page), and it is seen only by the people who
may see the project: by anybody else, nowhere — not in the Tasks list, not in
*My tasks*, not by its address, not even when it is assigned to them.

**The completion gate.** A stage can be a completion gate. A project does not
leave such a stage — by a move, or by being closed as completed from it —
while one of the stage's tasks is neither *done* nor *cancelled*: the move is
refused, nothing changes, and the refusal names the open tasks. A cancelled
task counts as finished. Closing a project as **lost** is never stopped by the
gate. A stage that is not a gate lets the project go with its tasks still
open; they stay under that stage.

**Stage tasks.** Each stage can carry a list of **stage tasks** — a title, a
description, the role responsible for it and a due offset in days. They
become real tasks when the project **enters** the stage: due on the day the
stage started plus the offset, and assigned to the member who holds the
responsible role, if exactly one active member does; otherwise the task is
left unassigned and its note names the role — in the language of whoever reads
the task, with the role's current name. They are created once per stage:
entering the stage again creates nothing. The tasks are created on behalf of
the person who moved the project and recorded in the Tasks module's own
history. A stage with no stage tasks creates none; stage tasks added to it
later are created the next time the project enters it.

If the Tasks module fails while creating them, the project is still in the new
stage, the stage history says *Creating the stage's tasks failed.*, and they can
be created again with *Create the stage's tasks again* on the stage in the
*Stages* tab. Each stage task is created **exactly once**, however the creation
failed and however often it is retried: a retry creates only the ones still
missing.

**With the Tasks module switched off** a project keeps working with nothing
but its own stages, and nothing is lost:

- a completion gate is not applied — the project moves on, and the stage
  history says *The completion gate was not applied: the Tasks module is off.*;
- a stage entered while Tasks is off does not create its stage tasks, then or
  later — the stage history says *The stage's tasks were not created.*;
- a stage can be deleted without its tasks being counted;
- the *Tasks* tab and the stage tasks of the *Stages* tab are not shown;
- the stage tasks and the gates are kept, and apply again to what happens
  after Tasks is switched back on.

Deleting a project deletes its tasks with it. With Tasks switched off they stay
for the moment, hidden, because nobody can see the project they belong to, and
a stage deleted then keeps its tasks too. **Within fifteen minutes of Tasks
being switched back on** they are cleaned up: the tasks of a deleted project
are deleted, and the tasks of a deleted stage stay in their project with no
stage — each recorded in the audit log. Nothing is cleaned up while the
Projects module is switched off: a project that cannot be asked is not taken
for deleted.

## Templates

A **template** is a structure a new project can start from — for example
*Showroom fit-out* or *Annual framework contract*: a default description, the
project roles involved, and its stages with everything a project's stage has —
planned duration, responsible roles, deadline alerts, completion gate, whether
the project may be completed from it, and its stage tasks — and the workflow
between them. A template has no Organizations, members, value or linked
records.

**Creating a project from a template** copies all of it into the new project:
its stages, workflow, gates, alerts, stage tasks and default description. The
copy is the project's own. The **first stage's** stage tasks become tasks as the
project is created, a later stage's when the project enters it, as for any
stage. Whatever the person creating the project typed wins over the template —
a description of their own, for one — and every part of the copy can be
changed on the project afterwards. A role of the template can be given to a
member even if it has been archived since.

**Changing a template changes no project.** Editing, archiving or deleting a
template leaves every project created from it exactly as it is; the project
names the template it came from for as long as the template exists.

**Duplicating** a template makes an independent copy, named *… (copy)*, that can
be changed without touching the original. **Archiving** a template takes it out
of the choices for new projects; it is kept, and can be restored.

## Project roles

A **project role** says what a member does on one project — *Sales Rep*,
*Project Manager*, or one of your own such as *Designer*, *Installer* or
*Account Manager*. Roles are used to say who does what on a project, to name
the role responsible for a stage or a stage task, and to say which roles a
template involves. One person can hold several roles on a project, and one
role can be held by several people.

**Project roles are not permissions.** Holding a role — even *Project Manager*
— grants nothing and withdraws nothing: what a person may see and do is
decided by their administrator role and its permissions alone, and by the
rules of *Who sees a project*. Being a member of a project, whatever the role,
is one of the ways to *see* it, never a way to change it.

**Project roles** (`/projects/roles`) lists every role with its name in each
language of the Admin UI. *Sales Rep* and *Project Manager* are there from the
start, marked **Built-in**.

- **Add role** asks for the name in each language. The English name is
  required: it is the name shown in any language that has none of its own.
  Two roles cannot have the same English name, whatever its case — archived
  roles included; restore an archived role rather than adding it again.
- **Rename** changes the names; the role stays the same role everywhere it is
  used. Built-in roles can be renamed too.
- **Archive** takes a role out of the choices — for a member, a stage or a
  template — but leaves it on every project and template that uses it, marked
  as archived. **Restore** offers it again. Tick *Show archived roles* to see
  the archived ones.
- **Delete** removes a role for good, and only one that nothing uses — no
  member of any project, no stage or stage task and no template. A built-in role
  cannot be deleted, and neither can a role in use: archive it instead.

## Loss reasons

**Loss reasons** (`/projects/loss-reasons`) are the reasons a project can be
closed as lost, one of which must be chosen when someone closes one: *Price*,
*Chose a competitor*, *Cancelled by the client*, *No decision* and *Other* are
there from the start, marked **Built-in**. The screen works exactly as
*Project roles*: add a reason with its name in each language, rename, archive
and restore it, and delete one no project was lost for. An archived reason is
no longer offered when a project is closed, and stays on the projects lost for
it.

## Who sees a project

Two rules decide it, always in this order.

**1. Organization reach.** An administrator who can reach every Organization —
any role other than the sales representative's — can see every project. A
sales representative sees a project only when **every** Organization of the
project is one they are assigned; a project for two Organizations, of which
they reach one, does not exist for them. An internal project is visible only to
administrators who can reach every Organization. Nothing below widens this
rule.

**2. Visibility.** Inside their reach, an administrator sees a project when
they:

- hold the permission to see every project (*See every project*), or
- are a member of the project, or
- are one of the people listed on the project, or
- the project is open to everyone.

Whether a project is open to everyone is each project's own choice, made when
it is created and changed on its *Overview* by an administrator who may create
and run projects:

| The project's choice | Who sees it, besides holders of *See every project* |
| --- | --- |
| *Follow the module setting* (the default) | Under the module setting **Who sees a Project** (`projects.visibility`) set to *everyone*: everybody who may view projects. Set to *members* — the default — its members and the people listed on it. |
| *Everyone who may view projects* | Everybody who may view projects, whatever the module setting. |
| *Members and listed people* | Its members and the people listed on it, whatever the module setting. |

The people listed are administrators named on the project without being its
members — somebody who needs to follow it without working on it. They are
chosen with *Members and listed people*; choosing another option takes them off
the project.

*See every project* (`projects:see_all`) lifts this second rule, never the
first: its holder sees every project **within their reach**, and a sales
representative who holds it still sees no project of an Organization they are
not assigned, nor any internal project.

A project somebody may not see does not exist for them, anywhere: not in a
list, not in its total, not by its address, not as the context of a task in the
Tasks module. An address of such a project answers exactly as an address of one
that was never created. Nor are they told about it: a task of the project
assigned to them is not announced in their notification bell — they would be
handed the number of a task they cannot open.

## Switching it on and off

Projects is an optional module. It is on by default and an operator switches it
off, and back on, on the **Modules** screen of the Admin UI
(`/platform/modules`).

While it is off:

- the *Projects*, *Analytics*, *Templates*, *Project roles* and *Loss reasons*
  entries and every one of their screens are gone from the Admin UI, and so are
  the *Project* panel on Order, Quote Request, Opportunity and Task screens, the
  *Projects* panel on the Organization screen, the command-palette actions and
  projects in the global search;
- every `/api/v1/admin/projects…` endpoint answers `503` with the code
  `MODULE_DISABLED`;
- its permissions can no longer be granted to a role, and its settings cannot be
  changed — except the switch itself;
- no deadline alert is sent;
- *Project* is not offered on the custom-fields screen, and its fields cannot be
  added, changed or deleted there.

Nothing is deleted. Every project, its stages and its history stay in the
database, and everything is back exactly as it was when the module is switched
on again.

## Settings

| Setting | Default | What it decides |
| --- | --- | --- |
| `projects.enabled` | on | Whether the module is switched on. |
| `projects.visibility` | `members` | Who sees a project that follows the setting: `everyone` who may view projects, or its `members` and listed people. |
| `projects.alerts_time_zone` | `Europe/Warsaw` | The time zone in which "today" is counted for projects — the day a stage starts, whether its deadline has passed, and the day a deadline alert is sent, from 08:00 in this zone. It must be an IANA time zone name such as `Europe/Warsaw`; any other value is refused when it is saved. |

## Permissions

| Code | What it allows |
| --- | --- |
| `projects:read` | View projects — the list, a single project and its stage history — subject to the two rules of *Who sees a project*; also the names the list's filters and the forms' pickers choose from (Organizations within your reach, administrators). |
| `projects:write` | Create, edit and delete projects; set their Organizations, members, stages and workflow; move, close and reopen them; link and unlink records — a record of a kind also needs the permission to view that kind (see *Linking records*); with `tasks:write`, add a task to a project, take one out of it or delete one of its tasks. Requires `projects:read`. |
| `projects:see_all` | See every project within your reach, whatever the module setting and each project's own choice (see *Who sees a project*). Requires `projects:read`; it never widens Organization reach. |
| `projects:configure` | Create, edit, duplicate, archive and restore templates; add, rename, archive, restore and delete project roles and loss reasons. Requires `projects:read`; anybody who may view projects can read the templates, roles and loss reasons, to use them on a project. |
| `projects:analytics` | View project analytics (see *Analytics*) — every figure over the projects you may see. Requires `projects:read`. |

A project role is not one of these: holding one grants no permission (see
*Project roles*).

## Linking records

A project's **Linked records** tab lists the Orders, Quote requests and
Opportunities linked to it, a group each: every record with its number — a
link to it — its status and its amount. A quote request's amount is the one
the Quote Requests module computes, the figure its own list shows. While only
some of its lines have an agreed price, it is marked **Partially agreed**;
while none has, **Not yet agreed**. A quote request without any price shows
`—`.

- **Only records of the project's Organizations** can be linked. The picker of
  each kind searches that kind's own list of the Organization chosen — with one
  Organization, that one — by number. An internal project has no Organization,
  so nothing can be linked to it.
- **A record belongs to at most one project.** Linking one that is already in
  another project is refused, and you are told which project holds it — if you
  may see that project; otherwise only that it belongs to one.
- **What a linked record shows is its own module's to show.** Its number,
  status and amount are shown only to somebody who may view records of its
  kind — Orders, Quote requests (handling quote requests) or Opportunities
  (viewing CRM); anybody else sees it listed as *Unavailable*. The same
  permission is needed to link a record of that kind.
- **While CRM or Quote Requests is switched off**, their links are kept and
  listed as unavailable, none can be added, and they are back as they were when
  the module is on again. The rest of the project keeps working.
- **A record that no longer exists** — an Opportunity deleted in CRM; Orders and
  Quote Requests are never deleted — is listed as unavailable and can be
  unlinked by hand.
- **Unlinking** asks for nothing more than running the project, and works for an
  unavailable record too.
- **An Organization with a linked record cannot be removed from the project**
  until the records of it are unlinked; a project with linked records cannot be
  deleted until they are all unlinked.

Every link and every unlink is recorded in the project's history.

## Notes, messages and references

A project has two threads, both **internal** — no customer ever sees them, on
the storefront or anywhere else:

- **Notes** are what the people running the project want remembered. Only the
  person who wrote a note can edit or delete it — holding every permission there
  is does not make somebody else's note yours. A deleted note disappears from
  the list; the change history records that it was deleted, not what it said.
- **Messages** are the project's conversation. A message cannot be changed or
  deleted once it is sent, by anybody. Sending one notifies **every member of
  the project** except its author — in the bell, naming the project by its
  number and never by what the message says. The *Messages* tab shows how many
  messages others wrote that you have not read; opening it marks them read.

The description, notes and messages can **refer to things** as they are typed:

| Type | To refer to | Offered to |
| --- | --- | --- |
| `@` | a person | administrators who may create and run projects; the list offers only the people who may see the project |
| `@@` | a document — one list, grouped: Orders, Quote requests, Tasks, Opportunities, Projects | Orders with the permission to view Orders, Quote Requests with the permission to handle them, Tasks with the permission to view tasks, Opportunities with the permission to view CRM; Projects — any other project you may see — always; Orders and Quote Requests are those of the project's Organizations — none for an internal project; on the **New project** form, those of the Organizations chosen on it |
| `@@@` | a Product | administrators who may view the catalog |

The buttons above the field do the same — *Mention a person*, *Insert
document*, *Insert product*. A reference is shown as a link with the current
number or name of what it refers to, to whoever may see that; to anybody else —
and while the module it belongs to is switched off, or once it is gone — it is
shown as unavailable, without its number. A group of the `@@` list whose
module is switched off is not offered.

**A person newly mentioned** in a description, a note or a message is notified
once — naming the project by its number and the author, never the text — and
only if they may see the project (see *Who sees a project*). Nobody is notified
of their own mention, and a member mentioned in a message gets that one
notification, not a second for the message. With the notifications module
switched off nobody is notified, and everything is still saved.

## Attachments

The **Attachments** tab lists the files of a project — name, size, who attached
it and when — each with *Download*. *Add a file* (or dropping one on the field)
uploads a file and attaches it in one step, for anybody who may create and run
projects: the file is stored in the media library as a **private** file, and
the library's own rules on file types and sizes apply. A file a browser would
run — an HTML page, an SVG image, an XML document, a script — is refused.
*Remove* detaches a file; the file itself stays in the media library.

**The media library refuses to delete a file a project uses**, and names the
project by its number to those who may see it — also while Projects is switched
off. Detach it from the project first. A file used only by projects somebody is
not a member of is hidden from them in the media library. A download link is prepared at the moment you press *Download*
and is valid for a few minutes.

## Deadline alerts

A stage can carry **alerts** — whole days before its deadline, from 1 to 365,
each once, such as `7, 1` — set on the *Stages* tab of a project or in a
template, from which a new project copies them.

**On the day a deadline is that many days away**, from 08:00 in the time zone
of `projects.alerts_time_zone`, **every member** of the project who may see it
is told — in the notification bell and by e-mail — that the stage is due on
that date and how many days are left. The bell entry opens the project on its
*Stages* tab; the e-mail says the project's number, the stage, the deadline and
the days left, in the member's own Admin UI language, and has no link. Each
alert is sent **once** for a deadline:

- only for the **current stage** of an **open** project — nothing for a stage
  the project has left, and nothing for a closed project;
- **never backdated**: a project that enters a stage after its alert day, or a
  deadline moved so that the alert day has passed, sends nothing for that day;
  entering a stage on its alert day still sends it that day;
- a deadline **moved** to a new date sends its alerts again, once, for the new
  date;
- **members only** — not the people listed on a project, and not holders of a
  role who are not members; and of those only who may see the project when the
  alert goes out: an active administrator who may view projects and reaches
  every Organization of the project. A deactivated member or one out of reach
  is skipped.

Alerts are checked every fifteen minutes, so one arrives within a quarter of an
hour of 08:00. With the notifications module switched off members get the
e-mail only; an operator may switch the e-mail off, or edit it, on the e-mail
templates screen (*Stage deadline alert*). While Projects is switched off no
alert is sent, and none is used up: an alert due that day still goes out once
the module is back on the same day.

## Custom fields

An operator adds fields of their own to projects — a site region, a contract
number, a floor area — on the **Custom fields** screen (`/custom-fields`), where
*Project* is one of the record types, as *Order* and *Opportunity* are. Each
field has a type (text, number, yes/no, date, a choice or several choices) and
may be required.

The fields are on the project's *Overview* tab, below the members, and on the
**New project** form, after *Who sees this project*. A writer edits them on the
tab and saves them with *Save custom fields*; on the form they are sent with the
project. Anybody else who may see the project reads them. A
value that breaks its field — a required field left empty, a number that is not
one, a choice that is not offered — is refused, and the field is named; nothing
is saved. A required field added after a project was created is asked for the
next time somebody saves that project's fields, not on any other edit.

- The fields' values are shown only to somebody who **may see the project**
  (*Who sees a project*), and only to an administrator who may also view custom
  fields (`custom_fields:read`); without that permission the fields, and their
  values in the change history, are not shown.
- Every change of a field is in the project's **change history** — *Custom
  fields changed*, with each changed field's value before and after it; the
  values a project was created with are on its *Project created* entry. The
  project keeps these values itself: the platform's audit log, which is not
  kept per Organization, names only the fields that changed.
- A field marked as a **list filter** on the custom-fields screen is offered as
  a filter on the projects list, beside the list's own — to an administrator who
  may also view custom fields (`custom_fields:read`). A filter whose field is no
  longer offered is named above the list, with a way to remove it.
- A field deleted on the custom-fields screen is no longer shown on any
  project.

While Projects is switched off, *Project* is not offered on the custom-fields
screen and its fields cannot be changed there; they and every value are kept,
and are back when the module is.

## Analytics

**Analytics** (`/projects/analytics`) shows how projects went over a range of
days — this month, last month, the last 90 days, this year, or days of your
own — and can be narrowed to the projects created from one **template**, those
of one **Organization**, and those one **project manager** runs.

| Figure | What it counts |
| --- | --- |
| **Projects in the range** | *Opened*: projects created in the range. *Completed* and *lost*: projects closed in it either way. The *completion rate* is completed out of all closed — completed and lost. |
| **Average duration** | From a project's creation to its closing, in days, for completed and for lost projects apart — over the projects closed in the range. |
| **Average time in a stage** | How long projects stay in each stage, in days. A stay runs from entering the stage — when the project is created, moved there or reopened — to the next move or the close. It counts the stays that began in the range and **have ended**: a stage a project is still in is not counted yet. |
| **Where projects are lost** | The projects lost in the range, by the stage they were in when they were lost — the most frequent first, each with its share of all the losses. |
| **Loss reasons** | The same projects by the reason chosen when they were closed, each with its share. |
| **Value of lost projects** | What the projects lost in the range were worth, per currency. |
| **Average project value** | The average value of the projects created in the range, per currency, and how many it is over. |
| **Project managers with the most completed projects** | The members holding the *Project Manager* role on the projects completed in the range, by how many they completed — at most ten. |
| **Most valuable open projects** | The projects created in the range that are still open, the five most valuable in each currency, each a link to the project. |

Every figure:

- **counts only the projects you may see** — both rules of *Who sees a
  project* apply, so two people may see different numbers for the same range;
- says **the period and how many projects it was computed from**, and a figure
  of amounts also says how many projects it **left out for having no value**;
- shows **money per currency**: amounts in two currencies are never added
  together, and there is no figure for all currencies at once;
- groups **stages by name**, ignoring case and surrounding spaces, because
  every project has stages of its own — *Design* on one project and *design* on
  another are one row. A stage is named as it was when the project entered it
  or was lost in it, so renaming a stage later does not move old stays or
  losses.

Each chart has a table with the same numbers below it. Days are counted in the
**reporting time zone** — the *Reporting time zone* setting in the *Analytics*
section of the settings screen, `UTC` unless changed: a range starts at
midnight of its first day and ends at midnight after its last, both in that
zone. While the Analytics module is switched off, days are counted in `UTC`.
The range presets (*This month*, …) take today's date from your own computer.

While Projects is switched off the screen and its sidebar entry are gone, and
the figures are not served.

## For developers

### The API

| Method and path | Permission | What it answers |
| --- | --- | --- |
| `GET /api/v1/admin/projects` | `projects:read` | A page of projects and how many the caller may see: `{ items, nextCursor, total }`. Filters: `state` (repeatable), `organizationId`, `memberId` (an administrator's id or `me`), `roleId`, `templateId`, `stageName` (the current stage's name), `q` (number or title), `sort` (`createdAt` — the default, `value`, or `deadline` — the current stage's; projects without one come last either way), `order` (`asc` or `desc`, default `desc`), `cursor`, `limit` (at most 100), and `customFieldFilters` — custom fields marked as list filters, as JSON, the shape the Orders, Quote Requests and Opportunities lists take; a field the list does not offer is `400` `CUSTOM_FIELD_FILTER_UNAVAILABLE`, naming it. |
| `GET /api/v1/admin/projects/custom-field-filters` | `projects:read` | `{ data: CustomFieldListFilterField[] }` — the project custom fields marked as list filters. |
| `POST /api/v1/admin/projects` | `projects:write` | `201` `{ data: ProjectDetail }`. Without a `templateId`, `stages` is required; with one, the template's structure is copied and `stages` is refused (`422`), and an unknown or archived template is `422` `PROJECT_TEMPLATE_NOT_FOUND`. `customFieldValues` is held to the project's custom fields even when absent — a required one missing is `422` `CUSTOM_FIELD_VALUE_INVALID`, one issue per field, its `path` the field's key. |
| `GET /api/v1/admin/projects/:id` | `projects:read` | `{ data: ProjectDetail }`, or `404` `PROJECT_NOT_FOUND` — for a project that does not exist and for one the caller may not see alike. |
| `PATCH /api/v1/admin/projects/:id` | `projects:write` | Title, description, value, start date, `visibility` (`inherit`, `everyone` or `members_and_listed`) and `viewerIds` (the whole list of people listed — who see the project whatever its `visibility`; the Admin UI lists people only with `members_and_listed`), with `version`; `409` `PROJECT_CHANGED` when the project changed since it was read, `422` `PROJECT_MEMBER_INVALID` for a newly listed person who is not an active administrator. A change of who sees the project is audited apart from an edit of its text (`projects.project.visibility_set`, `projects.project.viewers_set`). `customFieldValues` names the fields it changes — the others keep their values, `null` clears one — and is refused like the create's; it is audited on its own (`projects.project.custom_fields_update`). |
| `DELETE /api/v1/admin/projects/:id` | `projects:write` | `204`; `409` `PROJECT_HAS_LINKS` while records are linked. |
| `GET /api/v1/admin/projects/lookups/organizations` | `projects:read` | `{ data: { id, name }[] }` — the Organizations the caller can reach, by name (`q`), or one by `id`; at most `limit` (50). |
| `GET /api/v1/admin/projects/lookups/admin-users` | `projects:read` | `{ data: { id, name, email }[] }` — active administrators by name or e-mail (`q`), or one by `id`; at most `limit` (50). |
| `GET /api/v1/admin/projects/visibility-setting` | `projects:read` | `{ data: { setting } }` — the module setting `projects.visibility` as it stands. |
| `PUT /api/v1/admin/projects/:id/organizations` | `projects:write` | The whole set → the project's detail, or `{ data: { id, outOfReach: true } }` when a caller confined to some Organizations removed them all — the project is internal and out of their reach; `422` `PROJECT_ORGANIZATION_OUT_OF_SCOPE`; `409` `PROJECT_ORGANIZATION_IN_USE` for removing an Organization a linked record belongs to. |
| `PUT /api/v1/admin/projects/:id/members` | `projects:write` | The whole set of members and their roles; `422` `PROJECT_MEMBER_INVALID`. |
| `POST /api/v1/admin/projects/:id/stages` | `projects:write` | `201` `{ data: ProjectStage }`, added at the end. A project that already has 50 stages is `422` `PROJECT_STAGE_LIMIT` (`details`: `projectId`, `maximum`); it was `422` `VALIDATION_FAILED` until issue #634. |
| `PATCH /api/v1/admin/projects/:id/stages/:stageId` | `projects:write` | Any attribute; `deadlineOn` sets the deadline by hand, `null` returns it to start + duration. |
| `DELETE /api/v1/admin/projects/:id/stages/:stageId` | `projects:write` | `204`; `409` `PROJECT_STAGE_CURRENT`, `PROJECT_STAGE_LAST` or `PROJECT_STAGE_HAS_TASKS`. |
| `PUT /api/v1/admin/projects/:id/stages/order` | `projects:write` | Every stage id, in the new order. |
| `PUT /api/v1/admin/projects/:id/moves` | `projects:write` | The whole workflow → `{ data: { moves, unreachableStageIds } }`. |
| `POST /api/v1/admin/projects/:id/move` | `projects:write` | `{ toStageId, version }` → `{ data: { project, entry, createdTaskIds, notes } }` — `createdTaskIds` are the stage tasks the move created, `notes` what the entry recorded (`gate_not_applied_tasks_off`, `stage_tasks_skipped`, `tasks_materialize_failed`); `409` `PROJECT_MOVE_NOT_PERMITTED`, `PROJECT_STAGE_GATE_OPEN_TASKS` (`details.openTaskCount`; `details.openTasks`: `{ id, number, title }[]` only for a caller holding `tasks:read`), `PROJECT_CHANGED` or `PROJECT_GUARD_REFUSED`. |
| `POST /api/v1/admin/projects/:id/close` | `projects:write` | `{ outcome: 'completed', version }` or `{ outcome: 'lost', lossReasonId, comment?, version }`; `409` `PROJECT_COMPLETION_NOT_PERMITTED` or, when completing, `PROJECT_STAGE_GATE_OPEN_TASKS`; `422` `PROJECT_LOSS_REASON_INVALID`. |
| `POST /api/v1/admin/projects/:id/reopen` | `projects:write` | `{ version }` → back into the stage it was closed in. |
| `GET /api/v1/admin/projects/:id/stage-history` | `projects:read` | Every entry, close and reopen, oldest first. |
| `PUT /api/v1/admin/projects/:id/stages/:stageId/tasks` | `projects:write` | `{ tasks: StageTaskDefinition[] }` (at most 100), replacing the stage's stage tasks → `{ data: ProjectStage }`; `422` for an unknown responsible role. |
| `POST /api/v1/admin/projects/:id/stages/:stageId/materialize-tasks` | `projects:write` | Creates the stage's tasks again after a recorded failure — the stage's `tasksMaterializeFailed` — → `{ data: { created } }`; `409` `PROJECT_STAGE_TASKS_NOT_RETRYABLE` otherwise, `503` `MODULE_DISABLED` while Tasks is off. |
| `GET /api/v1/admin/projects/:id/tasks` | `projects:read` | `{ data: { tasksAvailable, stages: [{ stageId, tasks: TaskSummary[] }] } }`, in stage order; `tasksAvailable: false` and no stages while Tasks is off or for a reader without `tasks:read`. |
| `GET /api/v1/admin/projects/:id/links` | `projects:read` | `{ data: ProjectLink[] }`, oldest first: `{ id, kind, recordId, available, number?, status?, amount?, currency?, href?, linkedBy, linkedAt }`. The record's fields are present only when `available` — the reader holds its owner's read code (`orders:read`, `rfqs:handle`, `crm:read`), its module is on and it still exists. |
| `POST /api/v1/admin/projects/:id/links` | `projects:write` | `{ kind: 'order' \| 'quote_request' \| 'opportunity', recordId }` → `201` `{ data: ProjectLink }`. `503` `MODULE_DISABLED` while the kind's module is off; `403` without its owner's read code; `404` `PROJECT_RECORD_NOT_FOUND` for a record that does not exist or is out of the caller's reach; `422` `PROJECT_LINK_ORGANIZATION_MISMATCH` for a record of an Organization the project does not have; `409` `PROJECT_RECORD_ALREADY_LINKED`, whose `details.project` (`{ id, number, title }`) names the project holding it only to a caller who may see that project. |
| `DELETE /api/v1/admin/projects/:id/links/:linkId` | `projects:write` | `204`; `404` for a link of another project or one that does not exist. |
| `GET /api/v1/admin/projects/records/:kind/:recordId/project` | `projects:read` | `{ data: ProjectSummary }` — the project an `order`, `quote_request`, `opportunity` or `task` (through its context) belongs to; `404` `PROJECT_NOT_FOUND` alike for a record in no project and one in a project the caller may not see. Needs the kind's read code as well (`403`), and its module on (`503`). |
| `GET /api/v1/admin/projects/:id/comments?kind=note\|message` | `projects:read` | `{ data: ProjectComment[] }`, oldest first, deleted notes left out; each with `references` — what its tokens name for the reader. |
| `POST /api/v1/admin/projects/:id/comments` | `projects:write` | `{ kind, body }` → `201` `{ data: ProjectComment }`. A message notifies every member who may see the project except its author; a newly mentioned person who may see it is notified once. |
| `PATCH /api/v1/admin/projects/:id/comments/:commentId`, `DELETE …` | `projects:write` | A note, by its author only — `403` `PROJECT_NOTE_NOT_AUTHOR` for anybody else; a message never — `409` `PROJECT_MESSAGE_IMMUTABLE`. `DELETE` keeps the row, marked. |
| `POST /api/v1/admin/projects/:id/messages/read` | `projects:read` | `{ throughMessageId }` → `{ data: { unreadMessageCount } }`; the caller's own read marker, which only moves forward. Not audited. |
| `GET /api/v1/admin/projects/:id/attachments` | `projects:read` | `{ data: ProjectAttachment[] }`, each with a download link valid for minutes. |
| `POST /api/v1/admin/projects/:id/attachments/upload` | `projects:write` | `multipart/form-data` with one `file` part → `201`; stored private, then attached — a file that could not be attached is taken back. `415` for active content or a type the library refuses, `413` `PROJECT_ATTACHMENT_TOO_LARGE` beyond 25 MB, and the library's own size limit. |
| `POST /api/v1/admin/projects/:id/attachments` | `projects:write` **and** `assets.read` | `{ assetId }` of a private, live file that is not active content → `201` (`200` for a file already attached); `422` `PROJECT_ATTACHMENT_NOT_PRIVATE` for a public file (`details`: `assetId`, `visibility`; `VALIDATION_FAILED` until issue #634), and `422` `VALIDATION_FAILED` for one that is not there — including one attached to a project the caller may not see. |
| `DELETE /api/v1/admin/projects/:id/attachments/:attachmentId` | `projects:write` | `204`; the file stays in the library. |
| `GET /api/v1/admin/projects/:id/history` | `projects:read` | `RecordHistoryPage` — the audit trail of the project, newest first, `limit` and an opaque `cursor`, reaching back 499 entries (`truncated` on the last page past that). A write that changed the title, the value or custom fields is served with them before and after — `title`, `valueAmount` (two places, as the project stores it) / `valueCurrency` and `customFieldValues` of the changed fields, from the project's own `project_value_changes` — while its audit entry names them only (`changedFields` / `changedCustomFields`, and `valueChangeId`, which the response leaves out). Custom fields, by value or by name, only for a holder of `custom_fields:read`; no Organization out of the reader's reach, nor the record of a link that named one. |
| `GET /api/v1/admin/projects/lookups/mentionable` | `projects:write` | `?projectId=&q=` → `{ data: { id, name, email }[] }` — active administrators holding `projects:read` who may see the project (without `projectId`, every holder of `projects:read`); at most 20. |
| `GET /api/v1/admin/projects/lookups/documents` | `projects:write` | `?projectId=&q=` → `RecordDocumentLookupResponse` (`{ groups: { kind, items }[] }`, not wrapped in `data`) — the `@@` list, the schema CRM's `GET /crm/lookups/documents` answers; a group only with its read code and its module on, at most 10 per group. Before a project exists, `organizationIds` (repeatable) names the Organizations whose Orders and Quote Requests are offered — only those within the caller's reach count, an Organization out of reach is left out without a word; beside a `projectId` it is ignored. |
| `GET /api/v1/admin/projects/roles`, `…/loss-reasons` | `projects:read` | The dictionaries, with `label` in the reader's language; `active=true` leaves archived rows out. |
| `POST /api/v1/admin/projects/roles`, `…/loss-reasons` | `projects:configure` | `{ defaultName, name }` (`name`: a name per language) → `201` `{ data }`. The `code` is derived from `defaultName` — `_`-separated, with `_2`, `_3`… when another row holds it — and never changes. `409` `PROJECT_DICTIONARY_NAME_TAKEN` for a default name another row of the same dictionary has, whatever its case — also when two such creates arrive at the same moment: one is added, the other gets the `409`, never a second row. |
| `PATCH /api/v1/admin/projects/roles/:id`, `…/loss-reasons/:id` | `projects:configure` | `defaultName` and/or `name`, which replaces the names per language → `{ data }`; `404` `PROJECT_DICTIONARY_ENTRY_NOT_FOUND`, `409` `PROJECT_DICTIONARY_NAME_TAKEN`. |
| `POST …/roles/:id/archive`, `…/restore` (and the same under `loss-reasons`) | `projects:configure` | `{ data }`. |
| `DELETE /api/v1/admin/projects/roles/:id`, `…/loss-reasons/:id` | `projects:configure` | `204`; `409` `PROJECT_DICTIONARY_ENTRY_SYSTEM` for a built-in row, `409` `PROJECT_DICTIONARY_ENTRY_IN_USE` for one a project or a template uses. A role delete and a write that names the role (a stage, a stage's tasks, a template, a new project or a project's members) never both go through: whichever comes second waits for the first, so either the write lands and the delete answers `409` `PROJECT_DICTIONARY_ENTRY_IN_USE`, or the delete lands and the write answers `422` — `PROJECT_MEMBER_INVALID` for a member's role, `VALIDATION_FAILED` otherwise. |
| `GET /api/v1/admin/projects/templates` | `projects:read` | `{ data: ProjectTemplateSummary[] }` by name; `active=true` leaves archived templates out. |
| `GET /api/v1/admin/projects/templates/:id` | `projects:read` | `{ data: ProjectTemplateDetail }`, or `404` `PROJECT_TEMPLATE_NOT_FOUND`. |
| `POST /api/v1/admin/projects/templates`, `PUT …/templates/:id` | `projects:configure` | The whole template in one body (`ProjectTemplateBody`: name, description, `roleIds`, `stages` each with a `key` and its `tasks`, `moves` naming stages by key — left out, each stage moves to the next) → `201` / `200` `{ data: ProjectTemplateDetail }`. A key that is the id of one of the template's stages keeps that stage's id. An archived role the template does not already hold is `422` `PROJECT_TEMPLATE_ROLE_ARCHIVED` (`details`: `roleId`; `VALIDATION_FAILED` until issue #634). |
| `POST /api/v1/admin/projects/templates/:id/duplicate` | `projects:configure` | `201` `{ data: ProjectTemplateDetail }` — an independent copy. |
| `POST /api/v1/admin/projects/templates/:id/archive`, `…/restore` | `projects:configure` | `{ data: ProjectTemplateDetail }`. |

| `GET /api/v1/admin/projects/analytics/summary` | `projects:analytics` | `{ opened, completed, lost, completionRate }` — `completionRate` is `null` when nothing closed. |
| `GET /api/v1/admin/projects/analytics/durations` | `projects:analytics` | `{ completedAverageDays, completedCount, lostAverageDays, lostCount }` — creation to closing, over the projects closed in the range. |
| `GET /api/v1/admin/projects/analytics/time-in-stage` | `projects:analytics` | `{ stageName, averageDays, sampleCount }[]` per stage name, over the stays begun in the range that have ended, in the order stages are usually walked. |
| `GET /api/v1/admin/projects/analytics/losses` | `projects:analytics` | `{ byStage: { stageName, count, share }[], byReason: { lossReasonId, code, name, count, share }[], lostValue: { currency, amount }[] }` over the projects lost in the range; `name` in the reader's language. |
| `GET /api/v1/admin/projects/analytics/value` | `projects:analytics` | `{ average: { currency, amount, count }[] }` over the projects created in the range. |
| `GET /api/v1/admin/projects/analytics/top-open` | `projects:analytics` | `ProjectSummary[]` — the open projects created in the range, five per currency, by currency, the most valuable first. |
| `GET /api/v1/admin/projects/analytics/managers` | `projects:analytics` | `{ adminUser: { id, name }, completedCount }[]` — holders of the `project_manager` role on the projects completed in the range, at most ten. |

Every analytics route takes `from` and `to` (`YYYY-MM-DD`, both included,
days in the reporting time zone, `analytics.reporting_time_zone`, which the
`analytics` module owns and serves through its gated `reportingTimeZonePort` —
`UTC` by default, and `UTC` while `analytics` is off: a `degrades-without`
edge, asked before the port in `services/reporting-time-zone.ts`) and optionally `templateId`, `organizationId` and `projectManagerId`; a
range that ends before it starts is `400`. Each answers
`{ from, to, projectCount, excluded: { noValue }, data }`: `projectCount` is
how many projects the range and the filters select for that figure, among
those the caller may see, and `excluded.noValue` how many of them a figure of
amounts left out for having no value.

The request and response shapes are the Zod schemas of
`@endora-commerce/contracts` (`projects.ts`).

### Stage guards and events

A module or a deployment refuses a move, a close or a reopen by registering a
guard in `projectStageGuardRegistry` (`ProjectStageGuardRegistryPort` of
`@endora-commerce/contracts`) from a contribution-only boot hook, declaring the
edge as `contributes-to`. The guard is asked with the project, the stages and
the kind (`move`, `close_completed`, `close_lost`, `reopen`) before anything is
written, and answers `{ allow: true }` or `{ allow: false, reason }`; a refusal
is `409` `PROJECT_GUARD_REFUSED` with the reason as its message. A guard whose
module is switched off is skipped.

After each committed write the module emits, once:
`projects.project.created.v1`, `projects.stage.moved.v1` (with the stage names
as they were), `projects.project.closed.v1` (with the outcome, the stage and,
when lost, the loss reason's code), `projects.project.reopened.v1`, and
`projects.record.linked.v1` / `projects.record.unlinked.v1` (with the project,
the record's kind and its id). A link and an unlink are the audited commands
`projects.project.link_add` and `.link_remove`.

Every change to a project role or a loss reason is one audited command —
`projects.role.create`, `.update`, `.archive`, `.restore`, `.delete` with
`objectType: 'project_role'`, and the same under `projects.loss_reason.*` with
`objectType: 'project_loss_reason'`.

### The `project` Task context

The module owns the Task context type `project`, registered in the Tasks
module's `taskContextRegistry` from a contribution-only boot hook (see the
Tasks page, *Task contexts*). A task of a project carries
`contextType: 'project'`, the project's id as `contextId` and one of its
stages' ids as `contextGroupId`; it is labelled `<number> <title>`, linked to
`/projects/:id`, and its group is labelled with the stage's name. Every answer
goes through `ProjectAccess`, so the Tasks module shows a project's tasks to
exactly the people who may see the project. To put a task into a stage, create
it with `POST /api/v1/admin/tasks` and that context. The descriptor's
`canChangeTasks` answers yes only to a holder of `projects:write` who sees the
project, so putting a task into a project, taking one out of it and deleting one
of its tasks need that permission as well as `tasks:write`; moving a task
between the project's stages does not.

The module reads and writes tasks only through `taskReadPort` and
`taskWritePort`, after deciding that Tasks is present (`degrades-without`
edges). Stage tasks are created after the move's own transaction has
committed, one audited `tasks.task.create` command each, each carrying the
stage's own stage-task definition id as its `sourceKey`: `createMany` creates a
key the project does not hold yet and answers the existing task's id for one it
does, so a retry is idempotent. `created` in the answer of
`materialize-tasks` therefore counts the stage's tasks after the retry, those
of earlier attempts included.

The descriptor also implements `existingContexts(ids)`, answered by
`ProjectAccess.existingWithStages` — one statement over `projects` and
`project_stages`, answered only to the system actor. The Tasks module's
maintenance pass calls it to find the tasks of projects and stages deleted
while Tasks was off (see the Tasks page, *Task contexts*). The note of a stage
task left unassigned is stored as the responsible role (`role:<id>`), not as a
sentence; the descriptor's `renderNote` words it in each reader's language.

### Notes, messages, references and attachments

A note or a message is a row of `project_comments`, its references an index in
`project_references` (`source_kind` `description` or `comment`) rebuilt by the
command that saves the text — `projects.project.note_add`, `.note_update`,
`.note_delete`, `.message_add` and the project's own `.create` and `.update`.
The audit entries carry the comment's id, kind and length, never its text: the
audit trail is not tenant-scoped. References are resolved on every read, in one
call per kind, through their owners' ports and read codes — `orderReadPort`,
`quoteRequestReadPort` and `opportunityReadPort` (both through
`linked-records.ts`), `taskReadPort` (through `project-tasks.ts`, after
`present()`), `catalogProductReadPort` and `adminUserReadPort`; a referenced
project is read through `ProjectAccess`, so it is shown only to somebody who
may see it.

Notifications go through `adminNotificationRecordPort` (a `degrades-without`
edge: presence is decided first, and nothing is caught) with the kinds
`projects.project.message` and `projects.project.mention`, subject `project`,
and are recorded only after the write has committed; every recipient is asked
`ProjectAccess.canSeeAs` first. A bell entry's title names the project by its
number and the author by name, translatable through
`notifications.<key>.title` of this module's bundle.

An attachment is an asset id in `project_attachments`, read through
`assetReadPort` and downloaded through a link `assetsLibraryPort` signs. The
module registers a scanner in `assetReferenceRegistry` from a contribution-only
boot hook, with no presence probe — so the library refuses to delete a file a
project uses (`kind` `project_attachment`, label `Project PRJ-…`) also while
Projects is off — and a resolver for `project` in `auditReferenceRegistry`, so
the audit log names a project the reader may see by its number and title.

### Deadline alerts

One BullMQ Job Scheduler, `projects-stage-alerts`, every fifteen minutes, with
a data-less job and one consumer at a time per process, attached through
`ctx.worker` only in a process that runs workers (`workers/stage-alert-worker.ts`).
A tick decides the module's presence first, then asks a one-bit probe outside
any tenant scope (`anyRowExists`, through the module's copy of
`scheduled-work-probe.ts`) and enters a system scope only when something is
due — a tick with nothing due writes no `tenant.escape_hatch` audit row.

A pass (`services/stage-alert-service.ts`) claims every alert due today in the
alert zone, from 08:00: one row of `project_stage_alert_deliveries` per
(stage, offset, deadline), inserted with `on conflict do nothing` against that
unique key, and committed before anything is delivered — so two passes at once
claim each alert once, and a moved deadline is a new key. Delivery runs outside
the transaction: every member is asked `ProjectAccess.canSeeAs`, told through
`adminNotificationRecordPort` (kind `projects.project.stage_deadline`, subject
`project`, sentence `notifications.stageDeadline.title`) and through the
transactional e-mail `projects_stage_deadline_alert` (variables
`project.number`, `stage.name`, `stage.deadline`, `alert.daysLeft`; defaults in
English and Polish pushed into `emailDefaultsPort` from a contribution-only
boot hook). The row is then settled with its outcome — `bell_email`, `bell`,
`email`, `no_recipient` or `undeliverable` — and how many members were told. A
claim whose delivery failed before anything went out is given back for the
next tick; a process that dies between claim and settle leaves an alert that
is never sent twice. The claim and settle statements run through the Command
Bus with no audit entry: they are bookkeeping, not a change to a project.

### Linked records and their owners

A link holds its record by value and keeps the record's Organization, read from
the owner once, when the link is made; a foreign key from `project_links` into
the project's Organizations is what stops that Organization being removed while
the record is linked. Records are read through their owners' published ports —
`orderReadPort` (a binding dependency), `quoteRequestReadPort` and
`opportunityReadPort` (both `degrades-without`) — always under the caller's
reach, and the presence of a switchable owner is decided before its port is
asked.

### Custom fields

*Project* is the `project` record type of `custom_fields`
(`SUPPORTED_ENTITIES.project`: owner `projects`, organisation-owned, a list
filter, no carry targets); its values are the `custom_field_values` column of
`projects`. The module validates and merges a bag through
`customFieldValueService.validateAndMerge` before the Command that writes it,
and answers a project's values through `project()`, which leaves out a value
whose definition is gone; the list's filter is `customFieldListFilterPort`'s id
condition, intersected with the visible set. `custom_fields` is a binding
dependency and cannot be switched off. An audit entry names the custom fields a
write changed (`changedCustomFields`), never their values; the values before and
after are a `project_value_changes` row the entry points at (`valueChangeId`),
written in the same Command. `GET /projects/:id/history` serves the values in
place of the names, and either only to a reader holding `custom_fields:read`.

### Analytics

Each figure is one grouped SQL statement over `projects` — and, for time in a
stage and the stage lost in, `project_stage_entries`, whose rows keep the
stage names as they were — carrying the `ProjectAccess` predicate for the
reader; a reader who reaches no Organization is answered with empty figures and
no statement runs. Nothing is read project by project: a project manager's name
and a top project's card are read afterwards, for the few rows the statement
answered. The service is `services/analytics-service.ts`, the range and ratios
`domain/analytics-range.ts`.

### Reading projects from another module

`projectReadPort` (`ProjectReadPort` of `@endora-commerce/contracts`) is the
one door another module, an overlay or a deployment reads projects through.
It is gated: resolving it while Projects is off throws, and the call answers
`503` `MODULE_DISABLED` — resolve it with `lazyPort` and declare the edge
`degrades-without` with a `whenAbsent` sentence.

| Method | What it answers |
| --- | --- |
| `findById(id)` | The project as a `ProjectRecord` — `id`, `number`, `title`, `state`, `currentStageId`, `currentStageName`, `organizationIds`, `valueAmount`, `valueCurrency`, `templateId`, `closedAt`, `createdAt` — or `null`. |
| `findByRecord(kind, id)` | The project an `order`, `quote_request` or `opportunity` is linked to, as a `ProjectRecord`, or `null`. |

Both answer for the caller, through `ProjectAccess` under the caller's own
tenant context: a project that does not exist, one out of the caller's reach
and one the caller may not see are the same `null`. The answer is a plain
object, never an entity.

`./backend` also exports **`nextProjectNumber(em)`**, the module's door to its
number sequence — the next `PRJ-…` number, for code that writes projects
without a Command, such as the demo composition; one format and one sequence,
whoever creates the project.

### One read path

Every table a project owns is classified **rule-scoped**: no ORM filter narrows
it, and the module enforces both rules of *Who sees a project* itself, in one
place — the `ProjectAccess` service. Every list, count and read by id in the
module either carries its SQL predicate or starts from a project it returned,
and a test of the module's own refuses a read of a project table anywhere else.
Code added to this module reads projects through it.
