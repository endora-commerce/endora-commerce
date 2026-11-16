# @endora-commerce/mod-projects

## 0.111.0

### Minor Changes

- 67f1463: Issue #1226 (D-288; owner rulings O-1 and O-4) — a project's audit entries no longer carry the free text of its stages, stage tasks and attachments.

  - `projects.project.stage_move`, `close` and `reopen` drop `stageName`; `projects.project.create` records `stageIds` in place of `stages` (the list of stage names); `stage_create`, `stage_update` and `stage_delete` drop `name`; each task under `tasks` of `stage_tasks_set` drops `title` and is named by `position`; `attachment_add` drops `fileName`.
  - A stage's name, a stage's task titles and an attachment's file name go to the existing `project_value_changes` store (`ProjectValueState.name`, `.taskTitles`, `.fileName`), written in the same Command. The entry names them in `changedFields` (`['name']`, `['taskTitles']`, `['fileName']`) and points at the row by `valueChangeId`; a deleted stage's entry carries both on its state before. No migration is needed.
  - `GET /api/v1/admin/projects/:id/history` serves those names from the store in the shape older entries carried: `name` on a stage's entries, `title` on each task under `tasks`, `fileName` on `attachment_add`.
  - An internal `PROJECTS_AUDIT_KEYS` allowlist (not exported from the package) lists every key a `projects.project.*` audit state may carry, held by sentinel tests (`specs/conventions/audit-state.md` §6).
  - Audit entries written before the upgrade keep their names (owner ruling O-4).

  **Behaviour change on upgrade.** On the platform **Audit log** screen and in `audit_logs read`, new project entries name a stage by id, a stage task by position and a file by id. The project's **Change history** tab still names them; a stage task whose title a change did not touch is named by its place. See _Stage names, task titles and file names leave the project audit entries_ in the upgrade guide.

- bfdbeaf: Projects: optimistic concurrency for a Project's configuration (issue #449), additive. Two new tokens, neither of them the Project `version` that moves, closes, reopens and edits name — no write of the configuration moves that one, so a client that edits a Stage and then moves the Project with the version it read is served as before.

  - **A Stage's own edits.** `ProjectStageSchema` gains `version`. `UpdateProjectStageBodySchema` (`PATCH …/stages/:stageId`) and `SetProjectStageTasksBodySchema` (`PUT …/stages/:stageId/tasks`) take an optional `version` — the Stage's; each write moves it. A body of `PATCH …/stages/:stageId` naming only `version` is still refused as having nothing to change.
  - **The Project's sets.** `ProjectDetailSchema` gains `configurationVersion`. `CreateProjectStageBodySchema`, `ReorderProjectStagesBodySchema`, `SetProjectMovesBodySchema`, `SetProjectOrganizationsBodySchema` and `SetProjectMembersBodySchema` take an optional `configurationVersion`; each of those writes, and `DELETE …/stages/:stageId`, moves it. `SetProjectMovesResultSchema` gains `configurationVersion`, the value after the write.

  Sent and stale, either token answers `409 PROJECT_CHANGED` and nothing is written; a body without it is served as before. Both start at 1 — a migration adds `project_stages.version` and `projects.configuration_version` with that default.

  `PUT …/organizations` changes the set in one transaction: a failure part-way leaves it as it was. The audit trail still records one `projects.project.organization_add` or `projects.project.organization_remove` entry per Organization, now as child Commands of `projects.project.organizations_set`, which records no entry of its own. The Projects admin sends the Stage's version on a Stage or Stage Task edit and the Project's `configurationVersion` on adding and reordering Stages and on the workflow, and reads the Project again on a `409`.

- 48cefef: Issue #470 (D-288; owner ruling O-1, 2026-11-10: a title is a value) — a project's audit entries no longer carry its title.

  - The Project audit snapshot drops `title`. `projects.project.create` and `projects.project.update` name a title change in `changedFields` (`['title']`, beside `'value'`). The title before and after goes to the existing `project_value_changes` store (`ProjectValueState.title`), and the entry points at it by `valueChangeId`.
  - `GET /api/v1/admin/projects/:id/history` serves the title from that store, as it already does the value. No migration is needed.
  - Audit entries written before the upgrade keep their title (owner ruling O-4).

  **Behaviour change on upgrade.** On the platform **Audit log** screen and in `audit_logs read`, new project entries name a project by its number instead of its title. The project's **Change history** tab is unchanged. See _Project titles leave the platform audit log_ in the upgrade guide.

- 48b2505: Every `GET /api/v1/admin/projects/analytics/*` answer adds `timeZone`, the reporting time zone its
  days were counted in (`UTC` while `analytics` is switched off), beside `from`, `to`,
  `projectCount` and `excluded` (issue #475). The analytics screen names that zone under its
  filters and takes the range presets (_This month_, …) from that zone's calendar instead of the
  browser's, so around midnight a preset means the days the figures are counted over.
- 0b991d6: Three `projects` refusals have error codes of their own instead of `VALIDATION_FAILED`, and a
  sentence in English and Polish (issue #634, part of #86). **A caller that matches on
  `VALIDATION_FAILED` for these refusals now sees the specific code.** The HTTP status is unchanged.
  Until now each was answered with an English sentence in every language, because the error envelope
  never replaces the message of `VALIDATION_FAILED`, and the stage maximum was written into that text.

  | Route                                                                               | Was                                                                                                           | Is                                   | `details`               |
  | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------- |
  | `POST /api/v1/admin/projects/:id/stages`                                            | `422 VALIDATION_FAILED`, _"A project has at most 50 stages."_                                                 | `422 PROJECT_STAGE_LIMIT`            | `projectId`, `maximum`  |
  | `POST /api/v1/admin/projects/:id/attachments`                                       | `422 VALIDATION_FAILED`, _"An attachment must be a private file. Upload it to the media library as private."_ | `422 PROJECT_ATTACHMENT_NOT_PRIVATE` | `assetId`, `visibility` |
  | `POST /api/v1/admin/projects/templates`, `PUT /api/v1/admin/projects/templates/:id` | `422 VALIDATION_FAILED`, _"An archived project role is not added to a template."_                             | `422 PROJECT_TEMPLATE_ROLE_ARCHIVED` | `roleId`                |

  A project created with no stages, a file that is not in the media library and a template role that
  is not a project role stay `422 VALIDATION_FAILED`. The three codes are members of `ERROR_CODES` in
  `@endora-commerce/contracts`, declared by the `projects` manifest, and the module's documentation
  page names them. No setting, permission or migration changes.

- 42a9a4b: One sales-representative reach rule on every admin surface (issue #305, owner ruling 2026-11-07). A sales representative reaches every Organization not governed by another representative — the ones assigned to them (with `organizations:rollup`, their subtrees, the nearest assignment winning) and every Organization nobody is assigned to. `adminTenantScopePort` answers that reach as its complement, computed in one statement per request (`SalesRepAssignmentService.reachOf`), so the tenant-scoped reads and writes of every module, the Organizations list and its pickers, admin search and the Organization screens answer by the same rule. Every module that read the reach as a list of assigned ids now reads it through the platform's helpers.

  `mod-orders`: `resolveAdminOrdersScope` answers `{ allowAll: boolean }` (was `{ allowAll: false, allowedOrganizationIds }`); the list's reach is the ambient tenant context's. `mod-customers`: `ResolveModerationActor` answers `{ adminUserId, isPlatformAdmin }` (was with `allowedOrganizationIds`).

  **Behaviour change on upgrade.** Every sales representative gains the tenant data of every unassigned Organization — members, customers, orders, invoices, carts, returns, quote requests and customer-level settings — and, since no representative can be assigned to a personal Organization, of every B2C customer (confirmed by the owner on 2026-11-08). The Organizations list, its pickers and admin search stop showing Organizations assigned to other representatives. A sales representative with no assignment used to be treated as a platform administrator by the quick-order default-preference routes; they now manage only the Organizations they reach, and a write naming an Organization that does not exist answers `404 NOT_FOUND`. The read-only query in _Upgrading an instance_ ("One sales-representative reach rule on every surface") counts, per representative, what they gain and what leaves their lists.

### Patch Changes

- baa0dae: The custom-fields panel on the Opportunity, Project and Task Overview no longer clears stored values the operator did not touch (issue #1007). Each screen used to add a `null` for every stored key missing from the panel's bag before sending its `PATCH`, written when the panel reported a cleared field as `undefined`. The panel has reported a cleared field as `null` since issue #176, and leaves out every key it does not offer for editing (a `read` or `hidden` field, or a value with no definition) and, now, every key the operator did not change. The screens forward the panel's bag as it is, so a save writes the changed fields only and the server's merge keeps every other stored value.
- ed57923: Published tarballs no longer carry source maps (issue #107). Every package publishes `dist` and
  not `src`, so each `.js.map` and `.d.ts.map` pointed at source files no consumer had; they were
  about a third of a tarball's unpacked size. Each package's `files` list now ends with
  `"!dist/**/*.map"`: `@endora-commerce/mod-quick-order` packs 69 files instead of 131 (243.6 kB
  unpacked instead of 359.9 kB), and `@endora-commerce/test-kit` packs 25 instead of 47. The
  compiled JavaScript, the type declarations and every other shipped file are unchanged, and so is
  every export. A stack trace from an installed package now names the compiled `dist` file rather
  than a source path that does not exist in the install.
- f39d37f: Each manifest exports `customFieldWrites` (`specs/175-buyer-input-custom-fields/`), the `CustomFieldWriteDeclaration[]` naming the admin routes that write its custom-field host's values: opportunity, project and task create (`POST`) and update (`PATCH …/:id`), and the customer values patch (`PATCH /api/v1/admin/customers/:id/custom-fields`). A type-only declaration read by `check:custom-field-writes`; no runtime behaviour changes.
- cbfe104: Projects admin: nothing typed is discarded without a question (issue #452). On the create form, choosing a Template while Stages are typed by hand, or while the description is one written by hand, asks first in the admin's confirmation dialog; Cancel leaves the form as it was, and choosing "No template" again brings back the typed Stages and description. The Template editor guards unsaved edits with the admin kit's unsaved-changes prompt (links and leaving the page), asks before Cancel discards them, and asks before Duplicate, which copies the saved Template and not what is on screen. New strings in English and Polish under `create.template.replace.*`, `templates.editor.unsaved.*` and `templates.editor.duplicateUnsaved.*`.
- 4b12959: The Projects list in the admin (`/projects`) now keeps its filters and its sort in the address
  (issue #454). The parameters carry the names `GET /api/v1/admin/projects` takes — `q`, `state`,
  `organizationId`, `memberId` (an administrator's id, or `me` for _Only my projects_), `roleId`,
  `templateId`, `stageName`, `sort`, `order` — and custom-field filters use the admin kit's
  `cf.<key>.<op>` parameters. Back, a reload and a shared link keep the filters, and another screen
  can link to a narrowed list. A parameter the list does not take (an unknown state, a value that is
  not an id, a sort the server does not serve) is ignored, and a Role or Template the screen's choices
  no longer hold is removed from the address once they are read. The Organization and member filters
  show the name of a value they were given in the address. On the Organization screen, the Projects
  panel's _All projects_ link now opens `/projects?organizationId=<id>`.
- 65f7abc: Issue #455 — a Project's _Linked records_ tab and its link picker name each record's status the way the record's own module names it, in the reader's language, instead of showing the stored code (`new`, `proposal`, `Pending`).

  - **`@endora-commerce/contracts`** adds `statusName(code, language)` to `OpportunityReadPort` and `statusName(status, language)` to `QuoteRequestReadPort`, each answering a `Promise<string>`, and the optional `statusName` to `ProjectLinkSchema` beside `status`. A test double that implements either port in full needs the new method.
  - **`@endora-commerce/mod-crm`** implements `OpportunityReadPort.statusName` by its own rule: the configured name in that language, else the status's default name, else the code.
  - **`@endora-commerce/mod-quote-requests`** implements `QuoteRequestReadPort.statusName` in the wording its global-search results already use (a code outside the six statuses answers as it is), and each row of `GET /api/v1/admin/quote-requests` now also carries `statusName` in the response language.
  - **`@endora-commerce/mod-projects`** serves `statusName` on `GET` and `POST /api/v1/admin/projects/:id/links` (an Order's name from `orderReadPort.findStatusDefinition`), and the admin tab and picker show it.

  **On upgrade.** Nothing to migrate; `status` keeps answering the code.

- a998fee: Issue #457 — a Project with many linked Quote Requests and Opportunities no longer reads them one at a time.

  - **`@endora-commerce/contracts`** adds two batched reads to `QuoteRequestReadPort`: `findByIds(ids)`, which answers what `findById` answers for each id in one read (a missing, out-of-scope or malformed id is absent), and `amountsOf(quoteRequestIds)`, a `Map` keyed by quote id holding what `amountOf` answers for each (a quote `amountOf` answers `null` for has no entry). Every implementation of the port must provide both; consumers are unaffected.
  - **`@endora-commerce/mod-quote-requests`** implements both under the caller's tenant scope: `findByIds` in one statement, `amountsOf` in two (the quotes, then their lines), whatever the number of ids.
  - **`@endora-commerce/mod-projects`** reads a Project's linked Quote Requests through `findByIds` and `amountsOf`, and its linked Opportunities through `OpportunityReadPort.findByIds`, one batch per kind. `GET /api/v1/admin/projects/:id/links` now costs the same number of statements for one linked record of each kind as for many; what it shows is unchanged.

- 54ae028: The permission inventory scanner (`scanEnforcedPermissionGates`) now reads
  `hasAnyPermission(['a', 'b'])` as one gate site that carries every code in the array, in the same
  way as `requireAdminAny([...])` (issue #458). It reads an array argument only up to the array's
  closing bracket. If code after the array narrows it at runtime, as in `['a', 'b'].filter(f)`, the
  scanner still reads `a` and `b`, and ignores any string in the narrowing. The `@@` document-list
  gate in CRM and in Projects now uses `hasAnyPermission`, so the scanner checks all four codes in
  each gate. Before, it marked them as runtime values and did not check them. Who can open the
  `@@` list does not change.
- 021a254: Issue #460 — a Project's _Change history_ names what its entries refer to and draws the nested changes, on the kit `RecordHistory`'s label and renderer props.

  - People (members, listed people), Organizations, Stages and Roles are shown by name, never as ids. Names come from the Project, the Roles dictionary and the entries' actors. A Stage the Project no longer has keeps the name an older entry recorded for it. Anything else that cannot be named reads as _no longer on this project_.
  - A change of the members lists who was added (with their roles), whose roles changed and who was removed. A change of the workflow lists the moves it allowed and withdrew. A change of a Stage's tasks lists the tasks added, changed and removed. An entry about one Stage names that Stage first.
  - A comment's kind, a Stage entry's notes and a loss reason are shown in the reader's language. A Stage's own fields (planned duration, responsible roles, deadline, completion gate and the rest) have labels.
  - `ProjectHistory` now takes the Project (`project`) instead of `projectId`.

  Nothing new is recorded in the audit log, and nothing is migrated.

- 20cda0c: Issue #461 — the Projects `@` list (`GET /api/v1/admin/projects/lookups/mentionable`) judges who may see the Project for every candidate administrator at once, instead of several reads per person.

  - **`@endora-commerce/contracts`** adds `PermissionReadPort.resolveRoles(adminUserIds)` — a `Map` holding, for every id asked, what `resolveRole` answers — and `AdminTenantScopePort.resolveForAdmins(adminUserIds)` — a `Map` holding, for every id asked, the scope `resolveForAdmin` answers. Every implementation of these ports must provide the new method; consumers are unaffected.
  - **`@endora-commerce/mod-admin-roles`** implements `resolveRoles` in two statements whatever the number of ids, and adds `holdersOf(adminUserIds, permission)` beside `hasPermission` on the `permissionService` container entry: the ids `hasPermission` answers yes for, refusing with `ADMIN_ROLE_REQUIRED` as `hasPermission` does when an active administrator asked holds no role.
  - **`@endora-commerce/mod-organizations`** implements `resolveForAdmins` with the same rule as `resolveForAdmin` — one batched role read, and the roll-up question asked once for the sales representatives only. A failure of that question leaves every representative asked unresolved, holding no organization, as one call at a time would. `SalesRepAssignmentService` gains `hasRollupCapabilities(adminUserIds)`.
  - **`@endora-commerce/mod-projects`** adds `ProjectAccess.canSeeAsMany(adminUserIds, projectId)`: the accounts, their roles and their reach each read once, and both visibility rules evaluated for everybody in one statement. `canSeeAs` is now that check for one person. The mentionable lookup asks it once; the people it offers, their order and the limit of 20 are unchanged.

- fbb3ec7: Projects: a Stage deadline alert whose sweep died between claiming and settling it is now marked `interrupted` (issue #462), as CRM's reminder sweep marks its own. The first pass thirty minutes after the claim (`STAGE_ALERT_CLAIM_STALE_MS`) sets the outcome and logs a warning naming the delivery rows; the alert is never retried, since a bell entry or an e-mail may already have gone out. A pass that outlives the bound still records what it delivered, over the presumption. `ProjectStageAlertOutcome` gains `interrupted`; the new type `StageAlertDeliveryOutcome` is what a delivery itself can come to. A migration widens the outcome check of `project_stage_alert_deliveries` and adds a partial index on `claimed_at` for unsettled claims; nothing else in the table changes.
- 6bfd758: `@@` in an Opportunity's or a Project's text now opens the document list for a role that holds only the module's own codes (issue #498). `useCrmReferences` offers the `document` trigger to a `crm:write` holder whose role includes `crm:read`, and `useProjectReferences` to a `projects:write` holder whose role includes `projects:read`, because `GET /crm/lookups/documents` and `GET /projects/lookups/documents` already answer the module's own group (Opportunities, Projects) to every writer. Before, such a role kept `@@` as the characters it typed and was shown no _Insert document_ button, although the server had a group to offer it. A Projects group with nothing in it is an empty list, not a reason to hide `@@`. No API change.
- 939c455: The attachment lists of Tasks, Projects and CRM Opportunities resolve every file's download link in one batched `assetReadPort.resolveUrls` read instead of one `assetsLibraryPort.getAsset` call per file (issue #545). The full asset detail asked every registered asset-reference descriptor about each attached file, so a list of N files issued about 12 × N reference statements. The links are unchanged: the same signed, expiring URL for a private file, with `download=1`. A host that composes these services itself must provide `resolveUrls` on the `assets` dependency (it is part of the published `AssetReadPort`).
- 49b43de: **Breaking (0.x, so `minor`):** a sales representative's reach is no longer computed on every admin request (issue #955, owner ruling of 2026-11-10). `@endora-commerce/platform/tenancy` removes `isOrgInScope(id, ctx?)` and `ruleVisibleForScope(ids, ctx?)` — use `await orgInScope(id, ctx?)` and `await ruleInScope(ids, ctx?)`, or `const inScope = await orgScopeTest(ctx?)` for a synchronous predicate over rows you already hold — and `assignedOrganizationIdsForRanking(ctx?)` now returns a promise. They were removed rather than retyped because `if (!isOrgInScope(x))` over a promise is always false.

  `AdminTenantScope`'s `excluding` member (`@endora-commerce/contracts`) replaces `excludedOrganizationIds` / `assignedOrganizationIds` with `loadReach(): Promise<{ excludedOrganizationIds, assignedOrganizationIds }>`, beside `excludedOrganizationsQuery`; the platform memoises it once per tenant context, and a failure rejects every helper that awaits it. `OrgConstraint`'s `excluded` arm and `AdminScopeInput` follow. `PreferenceActor`'s `salesperson.reaches(id)` returns `Promise<boolean>`, and `canManagePreference` (`quick_order`) is async. `adminTenantScopePort` (`organizations`) answers without calling `reachOf`. The listed modules move their call sites to the async helpers.

- 93146d1: Resolving the references in a text no longer reads the reader's administrator record when the text mentions a Product (issue #963). The reference services of `crm`, `tasks` and `projects` still looked up the reader's preferred language and then discarded it, a leftover from per-locale product names: a Product is named by its single Global `name`. The labels shown do not change.
- 4933779: The module's documentation page states the Organization rule by reach (an Organization assigned to the representative or to no representative), names `findByIds` and `search` on `ProjectReadPort`, says the media library hides a file used only by projects the reader may not see, and renders the analytics routes as part of the API table again. English and Polish.
- 04bdf9c: A note, a message or an attachment written on a Project now locks the Project and asks again, under the lock, whether the writer may still see it (issue #471), as the Project's own writes already did. When another administrator takes the Project out of the writer's sight or reach between the check and the write — adding an Organization the writer does not reach, or taking them off a members-only Project — adding a note or a message, editing or deleting a note, and attaching or removing a file answer `404 PROJECT_NOT_FOUND` and write nothing; an upload refused this way takes its stored file back. Writes on one Project's notes, messages and attachments now run one at a time with the Project's other writes.
- Updated dependencies [baa0dae]
- Updated dependencies [ee0698d]
- Updated dependencies [9c8efbe]
- Updated dependencies [3de70b4]
- Updated dependencies [2ee4923]
- Updated dependencies [e9df6b5]
- Updated dependencies [1937bed]
- Updated dependencies [3254098]
- Updated dependencies [7616ef1]
- Updated dependencies [ed57923]
- Updated dependencies [cffa0bf]
- Updated dependencies [644739b]
- Updated dependencies [c58acd1]
- Updated dependencies [fc91398]
- Updated dependencies [feaa40b]
- Updated dependencies [d2f179f]
- Updated dependencies [d16b343]
- Updated dependencies [34b3387]
- Updated dependencies [e283396]
- Updated dependencies [4ecb155]
- Updated dependencies [ff7bd10]
- Updated dependencies [097b599]
- Updated dependencies [761d9c4]
- Updated dependencies [8e7f794]
- Updated dependencies [8e7f794]
- Updated dependencies [f39d37f]
- Updated dependencies [f39d37f]
- Updated dependencies [3f95d1c]
- Updated dependencies [695636f]
- Updated dependencies [27834f3]
- Updated dependencies [190986e]
- Updated dependencies [3f95d1c]
- Updated dependencies [27834f3]
- Updated dependencies [190986e]
- Updated dependencies [f5caa4e]
- Updated dependencies [d14a4fd]
- Updated dependencies [86a92af]
- Updated dependencies [ee2a111]
- Updated dependencies [c7ec2fa]
- Updated dependencies [bfa1ac4]
- Updated dependencies [8a4ca9c]
- Updated dependencies [c7ec2fa]
- Updated dependencies [52831b7]
- Updated dependencies [a2d306f]
- Updated dependencies [aaa50ff]
- Updated dependencies [6e528ad]
- Updated dependencies [eedda68]
- Updated dependencies [2e603f7]
- Updated dependencies [73e8e8c]
- Updated dependencies [bf257b8]
- Updated dependencies [d591709]
- Updated dependencies [577e94c]
- Updated dependencies [e435bad]
- Updated dependencies [7bdf512]
- Updated dependencies [5c148de]
- Updated dependencies [e435bad]
- Updated dependencies [5c148de]
- Updated dependencies [036865c]
- Updated dependencies [0beb869]
- Updated dependencies [37532da]
- Updated dependencies [bfdbeaf]
- Updated dependencies [65f7abc]
- Updated dependencies [a998fee]
- Updated dependencies [54ae028]
- Updated dependencies [20cda0c]
- Updated dependencies [48b2505]
- Updated dependencies [c24bd3c]
- Updated dependencies [6b664cd]
- Updated dependencies [cd05402]
- Updated dependencies [91272e6]
- Updated dependencies [eb4dbc6]
- Updated dependencies [e2669cd]
- Updated dependencies [aec841a]
- Updated dependencies [da2b459]
- Updated dependencies [77904b3]
- Updated dependencies [4ab926c]
- Updated dependencies [a3b1da5]
- Updated dependencies [28fc1c7]
- Updated dependencies [2b12d58]
- Updated dependencies [9110863]
- Updated dependencies [2905024]
- Updated dependencies [ae1cedf]
- Updated dependencies [6f0debc]
- Updated dependencies [d6e7a55]
- Updated dependencies [62d3e2d]
- Updated dependencies [0b2f558]
- Updated dependencies [dc9bbea]
- Updated dependencies [1acf873]
- Updated dependencies [edf46c9]
- Updated dependencies [ef656f9]
- Updated dependencies [71ec1f8]
- Updated dependencies [7a3673f]
- Updated dependencies [1c3366d]
- Updated dependencies [ea965bb]
- Updated dependencies [fc08f90]
- Updated dependencies [d34fe02]
- Updated dependencies [59b5246]
- Updated dependencies [c55dcf5]
- Updated dependencies [3e7b0b6]
- Updated dependencies [d68aa70]
- Updated dependencies [0b991d6]
- Updated dependencies [9af7a64]
- Updated dependencies [ecbebe2]
- Updated dependencies [e61a12b]
- Updated dependencies [d362c3c]
- Updated dependencies [ef9630f]
- Updated dependencies [b7a9c8e]
- Updated dependencies [75f89d2]
- Updated dependencies [ca66684]
- Updated dependencies [b6fd6df]
- Updated dependencies [6658f0f]
- Updated dependencies [877477b]
- Updated dependencies [767d5de]
- Updated dependencies [d0c5dc8]
- Updated dependencies [ac094f5]
- Updated dependencies [61a6edf]
- Updated dependencies [dd869ee]
- Updated dependencies [ff6b599]
- Updated dependencies [ac65359]
- Updated dependencies [49b43de]
- Updated dependencies [5f8eede]
- Updated dependencies [de28088]
- Updated dependencies [44529a4]
- Updated dependencies [af88938]
- Updated dependencies [9aff446]
- Updated dependencies [42a9a4b]
- Updated dependencies [8ae3f58]
- Updated dependencies [65cdd0e]
  - @endora-commerce/admin-kit@0.111.0
  - @endora-commerce/contracts@0.111.0
  - @endora-commerce/platform@0.111.0
  - @endora-commerce/email-components@0.111.0

## 0.110.0

### Patch Changes

- 3f020ba: Product names, descriptions, alt texts, attachment and packaging-unit names are read at the document's sales channel and language — Channel × language → Channel → Global — through `catalogProductAvailabilityPort.effectiveTexts`, or as the Global string where there is no channel (feature 174). Basket, quote and order snapshots take the effective name when the line is created; a deliberately empty packaging-unit name at the scope keeps the Global name. The back-in-stock e-mail shows the Global name.
- 34eedab: Projects dictionaries no longer race (issue #453). Two creates of one default name on `/api/v1/admin/projects/roles` or `…/loss-reasons` arriving at the same moment collided on the code's unique index (reported in the issue as a `500`, answered today as `409` `VERSION_CONFLICT`) instead of answering `PROJECT_DICTIONARY_NAME_TAKEN`; a create now takes the dictionary's advisory lock inside its Command before it checks the name, picks the code and reads the next position (a rename takes it before its name check), so the second create answers `409` `PROJECT_DICTIONARY_NAME_TAKEN` and no `_2` row is written. A Role delete could also commit while a Stage save stored that Role's id in `responsible_role_ids`, which has no foreign key; the delete now takes the Role's lock exclusively before asking whether it is in use, and every Stage, Stage Task, Template, new-Project and Member write that names Roles takes each one's lock shared, in sorted order, and checks again inside it that each still exists (`422` if not: `PROJECT_MEMBER_INVALID` for a Member's Role, which used to surface as a `500` on the foreign key, `VALIDATION_FAILED` otherwise). Stage saves share the lock and do not wait for each other.
- ff60e93: A linked quote request's amount is the one `quoteRequestReadPort.amountOf` publishes (issue #456).
  - The link carries `agreement`, and the Linked records tab marks the quote request "Partially agreed" or "Not yet agreed".
  - A quote request without any price shows `—`.
  - Each line value is now rounded to the cent before the sum, as the quote desk and CRM do. Projects used to round the sum only.
- d69e765: A path parameter that is not a UUID is answered exactly as a well-formed id that names nothing, on every customer- and admin-facing id route, mutations included, instead of `500` (issue #781). The shape is checked with `isUuidShape` from `@endora-commerce/contracts` before the database is asked, so a malformed id gets the route's own answer for an unknown record: its own not-found code (`404`), or the empty list or `204` the route gives an unknown id. Examples: `POST /api/v1/orders/:id/cancel` answers `404 ORDER_NOT_FOUND`; the returns comment, delivery-method and cancel routes and `POST /api/v1/organization/carts/:id/approve` and `/reject` answer `404 NOT_FOUND`.

  Routes whose params schema demanded a UUID answered a malformed id `400 VALIDATION_FAILED`; they now answer `404` like an unknown id (owner ruling of 2026-11-05): `/api/v1/organizations/mine/roles/:id`, `/api/v1/admin/organizations/:id/roles[/:roleId]` and `…/permission-catalogue`, `/api/v1/organizations/mine/members/:id[/role]`, every `/api/v1/admin/product-feeds/:id…`, `/api/v1/admin/feed-templates/:id` and `/api/v1/admin/feed-taxonomies/revisions/:taxonomyId…` route, `/api/v1/admin/document-templates/:id…`, `/api/v1/admin/quote-requests/:id/document-templates`, `…/document-template` and `…/pdf`, the blog `url-redirects/:redirectId` and `addresses/:id` deletes, `PATCH /api/v1/admin/cms/hooks/:id/attachments/:blockId`, and `GET`, `PATCH` and `DELETE /api/v1/admin/import-export/profiles/:id` (`404 IMPORT_PROFILE_NOT_FOUND`). A client that told a malformed id from an unknown one by the `400` can no longer do so.

  Every private copy of the UUID pattern is replaced by `isUuidShape`, `UUID_SHAPE_PATTERN` or, where a filter has always asked for RFC 9562 version and variant bits (the CRM board filters), `uuidSchema`; what each check accepts is unchanged, except that the invoice-ledger delivery retry now accepts any uuid-shaped id and answers an unknown one `404` from the lookup.

- d24be0e: The module documentation pages have readable titles instead of the module id (for example _Carts_ instead of `carts`), in the docs sidebar, the module map and the browser tab, in English and Polish. Page headings and screen names in the page text are sentence case, as in the Admin UI (#795). File names and URLs are unchanged.
- b3ec2a8: The refusal of an Opportunity or Project attachment that a browser would open and run (HTML, SVG,
  XML, JavaScript) now has its own sentence in English and Polish. Before, the error envelope
  answered the asset library's generic "Files of this type cannot be uploaded to the asset library",
  which named the wrong place and none of the refused types (issue #623).

  The code and status are unchanged (`415 ASSET_UPLOAD_TYPE_NOT_ALLOWED`); **`details` gained
  `code: 'attachment_active_content'`**, so a client that compares `details` for equality will see
  it. The sentence lives in `@endora-commerce/mod-assets-library`'s bundle, which owns the code:
  "HTML, SVG, XML and JavaScript files cannot be attachments: a browser would open and run them." /
  "Pliki HTML, SVG, XML i JavaScript nie mogą być załącznikami: przeglądarka by je otworzyła i
  uruchomiła." The thrower's English message is the same sentence.

- Updated dependencies [18cce2e]
- Updated dependencies [18cce2e]
- Updated dependencies [9cfb28b]
- Updated dependencies [a206da9]
- Updated dependencies [34485ae]
- Updated dependencies [34485ae]
- Updated dependencies [0f1717c]
- Updated dependencies [86e8761]
- Updated dependencies [9bfb0b8]
- Updated dependencies [ed5cf6a]
- Updated dependencies [2da23d2]
- Updated dependencies [2da23d2]
- Updated dependencies [9d9c8df]
- Updated dependencies [9d9c8df]
- Updated dependencies [9d9c8df]
- Updated dependencies [9d9c8df]
- Updated dependencies [5303aab]
- Updated dependencies [16f85f4]
- Updated dependencies [270aa2b]
- Updated dependencies [3f020ba]
- Updated dependencies [3f020ba]
- Updated dependencies [b59e5d5]
- Updated dependencies [b59e5d5]
- Updated dependencies [bf1cc2d]
- Updated dependencies [ff60e93]
- Updated dependencies [6f19230]
- Updated dependencies [06cf85b]
- Updated dependencies [77b8c37]
- Updated dependencies [65104b8]
- Updated dependencies [7acaa33]
- Updated dependencies [7019c71]
- Updated dependencies [4eee98b]
- Updated dependencies [14ac256]
- Updated dependencies [248bf1b]
- Updated dependencies [b2db8c3]
- Updated dependencies [4cf529d]
- Updated dependencies [5e4dd48]
- Updated dependencies [75b053f]
- Updated dependencies [54fc8f1]
- Updated dependencies [dac5795]
- Updated dependencies [5bbb389]
- Updated dependencies [d69e765]
- Updated dependencies [dbc1cef]
- Updated dependencies [d69e765]
- Updated dependencies [a6bc891]
- Updated dependencies [8ad737c]
- Updated dependencies [a9398c8]
- Updated dependencies [0b56038]
- Updated dependencies [717e4c6]
- Updated dependencies [cea1470]
- Updated dependencies [cea1470]
- Updated dependencies [d46d414]
- Updated dependencies [73e2eec]
- Updated dependencies [29d7e90]
- Updated dependencies [7f2fa6e]
- Updated dependencies [57145f7]
- Updated dependencies [58a1632]
- Updated dependencies [e46d233]
- Updated dependencies [e46d233]
- Updated dependencies [58a1632]
- Updated dependencies [b476f44]
- Updated dependencies [14fe4fb]
- Updated dependencies [76d89ab]
- Updated dependencies [5cbffb9]
- Updated dependencies [6bd2ab7]
- Updated dependencies [a3502c0]
- Updated dependencies [7a73cc8]
- Updated dependencies [5ff8302]
- Updated dependencies [fc7db4c]
- Updated dependencies [c34b405]
- Updated dependencies [5af8c25]
- Updated dependencies [48f055e]
- Updated dependencies [bf50b85]
- Updated dependencies [2c6fba0]
- Updated dependencies [0801f69]
- Updated dependencies [d1c0d13]
- Updated dependencies [6d1d284]
- Updated dependencies [974be57]
- Updated dependencies [99c075e]
- Updated dependencies [32b4d0c]
- Updated dependencies [3355e60]
- Updated dependencies [7ce9b8a]
  - @endora-commerce/contracts@0.110.0
  - @endora-commerce/platform@0.110.0
  - @endora-commerce/admin-kit@0.110.0
  - @endora-commerce/email-components@0.110.0

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
