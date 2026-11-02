# @endora-commerce/mod-projects

## 0.109.0

### Minor Changes

- 4bc5c7f: Project attachments are reader-restricted references (`specs/166-asset-reference-visibility/`): the asset library hides a file used only by Projects a reader may not see — by membership and `projects:read`, the rule the Projects screens use. Every attachment reference is tagged with its `assetId`. Attaching an existing library file (`POST /api/v1/admin/projects/:id/attachments`) asks the library first whether the caller may see it, and answers a hidden file exactly as a missing one (`422`), before the private-file and active-content refusals.
- 11b0eb8: A new module package, `@endora-commerce/mod-projects` (module id `projects`): Projects for zero or
  more Organizations — or for none, an internal Project — run through Stages of their own by
  Members holding Project Roles, opened, completed, lost and reopened.

  - **Activation and settings.** `projects.enabled` (on by default, switchable on
    `/platform/modules`), `projects.visibility` (`members` by default, or `everyone`) and
    `projects.alerts_time_zone` (`Europe/Warsaw`). Off is non-destructive: every route answers
    `503` `MODULE_DISABLED`, every screen, panel, palette action and search hit is gone, no alert
    is sent, and everything is back as it was when it is switched on again.
  - **Migrations.** `projects_init` (Projects, their Stages, workflow, Organizations, Members and
    their Roles, listed viewers, Stage Tasks, Stage history, links, notes and messages, references,
    attachments, Templates, Project Roles and loss reasons with their seeded rows, alert
    deliveries), `projects_link_organization` and `projects_value_changes` (the values a write
    changed, which a Project's change history shows).
  - **Permissions.** `projects:read`, `projects:write`, `projects:configure` (Templates, Project
    Roles, loss reasons), `projects:analytics`, and `projects:see_all`, which lifts the visibility
    rule but never Organization reach; each of the last four requires `projects:read`. A Project
    Role grants no permission.
  - **Admin API** under `/api/v1/admin/projects`: the list (filters, search, sort, `total`, custom
    field filters) and a Project's CRUD; its Organizations, Members, Stages, workflow, moves, close
    and reopen, and Stage history; Stage Tasks and the completion gate; linked Orders, Quote
    Requests and Opportunities, and the Project a record or a Task belongs to; notes, messages,
    mentions, references, attachments (multipart upload) and change history; Templates; the two
    dictionaries; seven analytics figures, over days counted in the reporting time zone of Analytics
    (`analytics.reporting_time_zone`, `UTC` by default, `UTC` while Analytics is off); and the module's own lookups. Every read goes through
    the module's `ProjectAccess` — Organization reach and visibility — and an invisible Project
    answers exactly as a missing one.
  - **Admin UI.** The list, _New project_, a Project's screen with its tabs, Templates, Project
    Roles, Loss reasons and Analytics, in the sidebar's _Projects & tasks_ section; four palette
    actions (`open-projects`, `new-project`, `open-project-templates`, `open-project-analytics`);
    Projects in admin global search, by number, title or Organization name; a _Project_ panel on
    the Order, Quote Request, Opportunity and Task screens, and a _Projects_ panel on the
    Organization screen. English and Polish.
  - **Collaboration.** Notes and messages with `@` mentions and `@@` / `@@@` references, through the
    admin kit's components; a message notifies the Project's Members, a mention the person named,
    through the bell (`admin_notifications`, optional).
  - **Deadline alerts.** A Stage's alert days send a bell entry and the transactional e-mail
    `projects_stage_deadline_alert` (defaults in English and Polish, editable) to every Member who
    may see the Project, from a BullMQ job scheduler every fifteen minutes.
  - **Custom fields.** _Project_ is a record type on `/custom-fields`; values are validated on save,
    shown on the Project, and offered as list filters. A Project's change history shows each change
    of a custom field or of the value with the value before and after it, kept by the module itself;
    the platform audit log, which is not kept per Organization, names the changed fields only.
  - **For other modules.** `projectReadPort` (`findById`, `findByRecord`), gated;
    `projectStageGuardRegistry`, through which a guard refuses a move, close or reopen; the `project`
    Task context in Tasks' registry, which lets a Task into a Project, out of one or be deleted from
    one only for a holder of `projects:write` who sees the Project; the events `projects.project.created.v1`,
    `projects.stage.moved.v1`, `projects.project.closed.v1`, `projects.project.reopened.v1`,
    `projects.record.linked.v1` and `projects.record.unlinked.v1`; and `nextProjectNumber(em)` on
    `./backend`, the door to the `PRJ-…` number sequence.
  - **Dependencies.** Binding on `_i18n`, `admin_roles`, `admin_users`, `assets_library`,
    `audit_logs`, `auth`, `catalog`, `custom_fields`, `orders`, `organizations`, `settings` and
    `transactional_emails`; degrades without `analytics` (analytics count in UTC), `tasks` (no Tasks tab, Stage Tasks or completion
    gates), `crm`, `quote_requests` and `admin_notifications`. The package declares
    `@fastify/multipart` `^10`, `bullmq` `^5` and `ioredis` `^5` as peer dependencies, beside the
    platform's own.

  Its contract — the API schemas, `ProjectReadPort` and `ProjectStageGuardRegistryPort` — is in
  `@endora-commerce/contracts` (see that package's entry).

- 55864a1: Projects follows the new Tasks shapes and gains two reference kinds (`specs/165-task-management/`).

  - Migration `projects_reference_kinds` widens `project_references_target_type_check` to the seven reference kinds; its `down` restores the five. A Project's texts resolve `[[opportunity:…]]` and `[[project:…]]` references, and the `@@` list offers Opportunities and Projects.
  - `projectReadPort` gains `findByIds` and `search`, through the Project access seam.
  - Stage Tasks are created with a source key (the Stage Task definition's id), so retrying a Stage whose Tasks were partly created creates only the missing ones (#450). The Project's Task context answers `existingContexts`, so Tasks of a deleted Project or Stage are cleaned up by Tasks' maintenance pass.
  - The completion gate counts a Task as finished by its status category; the Tasks tab shows each Task's configured status and all its assignees.

### Patch Changes

- bd7968e: Every sidebar screen of these eight modules can now be found from the command palette (⌘K / CTRL+K), with English and Polish labels and search keywords. Each action carries the permission code of the screen it opens, so the palette never offers a screen the operator is refused.

  - `@endora-commerce/mod-catalog` declares `open-attribute-sets`, `open-attachment-types` and `open-bulk-operations` (`catalog:read`).
  - `@endora-commerce/mod-crm` declares `open-crm-tags` and `open-crm-workflow` (`crm:configure`).
  - `@endora-commerce/mod-inventory` declares `open-warehouses`, `open-low-stock` and `open-stock-notifications` (`inventory:read`), and `import-stock` (`inventory:write`).
  - `@endora-commerce/mod-newsletter` declares `open-newsletter-tags` and `open-newsletter-blocks` (`newsletter:read`), and `open-newsletter-provider` (`newsletter:write`).
  - `@endora-commerce/mod-orders` declares `new-order` for the order-entry form (`orders:write`).
  - `@endora-commerce/mod-projects` declares `open-project-roles` and `open-project-loss-reasons` (`projects:configure`).
  - `@endora-commerce/mod-promotions` declares `open-promotion-rules` (`promotions:read`).
  - `@endora-commerce/mod-settings` declares `open-setting-groups` (`settings:read`) and `clear-cache` (`settings:write`).

- 8eb0fcb: The command-palette actions of the work-management modules (`crm`, `projects`, `tasks`) keep only English `keywords` in their manifests. Their Polish search words moved to each module's `i18n/pl.json` under the action's new `keywordsKey`, with an English entry in `i18n/en.json` (issue #573, following #560). A Polish operator finds the same screens by the same words; an English-language admin is no longer offered the Polish ones.
- df95f59: The manifests now declare the refusal tokens of every error code they raise with a computed `details.code`. `mod-tasks` declares `TASK_WORKFLOW_INVALID`'s ten rule tokens and `TASK_STATUS_IN_USE_TOO_MANY`'s `priority`; `mod-custom-fields` (`CUSTOM_FIELD_OPTION_IN_USE`, `CUSTOM_FIELD_STORED_VALUES_EXIST`, `CUSTOM_FIELD_VALUE_TYPE_LOCKED`), `mod-document-templates` (`DOCUMENT_TEMPLATE_INVALID`) and `mod-projects` (`PROJECT_MOVE_NOT_PERMITTED`) declare `tokens: []`, stating that those raises never carry a token. Every token already had its sentence in English and Polish, so no rendered message changes.
- Updated dependencies [42b1038]
- Updated dependencies [5d192d3]
- Updated dependencies [9b45768]
- Updated dependencies [d2acc82]
- Updated dependencies [22604fa]
- Updated dependencies [c3165da]
- Updated dependencies [0e33ca9]
- Updated dependencies [e64ed74]
- Updated dependencies [e03e6a9]
- Updated dependencies [50338a6]
- Updated dependencies [0e33ca9]
- Updated dependencies [22604fa]
- Updated dependencies [0e33ca9]
- Updated dependencies [9ff8307]
- Updated dependencies [0e33ca9]
- Updated dependencies [07f3764]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [ea892d5]
- Updated dependencies [678fed1]
- Updated dependencies [dcbd154]
- Updated dependencies [a76d6ee]
- Updated dependencies [22604fa]
- Updated dependencies [9a38360]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [bdef54c]
- Updated dependencies [1b4f2b7]
- Updated dependencies [d560d58]
- Updated dependencies [dd6deb2]
- Updated dependencies [3f697a3]
- Updated dependencies [df0a90e]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [774d23e]
- Updated dependencies [4cb0a7d]
- Updated dependencies [0e33ca9]
- Updated dependencies [f148418]
- Updated dependencies [3ea1249]
- Updated dependencies [476c5aa]
- Updated dependencies [8ef189b]
- Updated dependencies [4bc5c7f]
- Updated dependencies [eba4fd8]
- Updated dependencies [61fc321]
- Updated dependencies [9b3e7f0]
- Updated dependencies [ecdd2f7]
- Updated dependencies [ecdd2f7]
- Updated dependencies [b7baf8a]
- Updated dependencies [1b1c43e]
- Updated dependencies [56e237d]
- Updated dependencies [d50b874]
- Updated dependencies [a166cfd]
- Updated dependencies [0a816a0]
- Updated dependencies [f261ed3]
- Updated dependencies [302e5ce]
- Updated dependencies [d68fb89]
- Updated dependencies [c73366c]
- Updated dependencies [b0a1e48]
- Updated dependencies [b25d8be]
- Updated dependencies [5038a3a]
- Updated dependencies [df95f59]
- Updated dependencies [1fd4822]
- Updated dependencies [9cb3c8d]
- Updated dependencies [0f5bcde]
- Updated dependencies [c72a83e]
- Updated dependencies [42189ce]
- Updated dependencies [d9053a7]
- Updated dependencies [23489bf]
- Updated dependencies [f40ce92]
- Updated dependencies [55864a1]
- Updated dependencies [ed85493]
- Updated dependencies [3174251]
- Updated dependencies [55864a1]
- Updated dependencies [11b0eb8]
- Updated dependencies [b8b6eed]
- Updated dependencies [2aa2c9b]
- Updated dependencies [883d192]
- Updated dependencies [5114576]
- Updated dependencies [8f7c38e]
- Updated dependencies [1846755]
  - @endora-commerce/admin-kit@0.109.0
  - @endora-commerce/platform@0.109.0
  - @endora-commerce/contracts@0.109.0
  - @endora-commerce/email-components@0.109.0
