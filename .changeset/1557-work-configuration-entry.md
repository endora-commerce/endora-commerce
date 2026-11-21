---
'@endora-commerce/mod-crm': patch
'@endora-commerce/mod-tasks': patch
'@endora-commerce/mod-projects': patch
---

Each work module's configuration is one sidebar entry with tabs (issue #1557, UX audit WORK-06):

- **CRM → Configuration** (`/crm/workflow`): **Workflow** | **Tags**. The tag list moves to `/crm/workflow/tags`; `/crm/tags` redirects there. The separate *Tags* and *Workflow* rows are gone.
- **Task configuration** (`/tasks/settings`): **Workflow** | **Priorities** | **Tags** | **General**. The workflow is the tab at `/tasks/settings`; `/tasks/settings/workflow` redirects there and keeps `#board-card`. The workflow header no longer has text links to the other screens, and they no longer have a back link. *General* is a short card with the time zone, and the result shows beside *Save*.
- **Project configuration** (`/projects/settings`): **Templates** | **Roles** | **Loss reasons**. Templates is the tab at `/projects/settings`, the editor is at `/projects/settings/templates/:id`, and the dictionaries are at `/projects/settings/roles` and `/projects/settings/loss-reasons`. The old addresses redirect. The three separate rows are gone.

Every command-palette action still opens its tab. `open-task-workflow`, `open-crm-tags`, `open-project-templates`, `open-project-roles` and `open-project-loss-reasons` now target the new addresses. New i18n keys: `nav.configuration.label` and `configuration.tab.*` in all three modules. Retired keys: `nav.tags.label` and `nav.workflow.label` (crm); `nav.templates.label`, `nav.roles.label` and `nav.lossReasons.label` (projects); `nav.settings.label`, `settings.description`, `settings.link`, `settings.nav`, `settings.priorities.link`, `settings.tags.link` and `settings.back` (tasks).
