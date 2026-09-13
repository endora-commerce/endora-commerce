import {
  defineModuleManifest,
  defineModuleSettingsManifest,
  type ModuleCliCommand,
} from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';

/**
 * Built-in settings manifest for the search module — feature 006.
 *
 * Reserves the `search` group and registers the search knobs
 * (`data-model.md §2`; embedder credentials via feature 058):
 *
 *   1. search.popup.suggestion_count       (number 0..50)
 *   2. search.popup.minimum_query_length   (number 1..32)
 *   3. search.llm.enabled                  (boolean)
 *   4. search.llm.embedder_credentials     (credential_ref → `llm`: Base URL +
 *                                           API key + model; the single embedder
 *                                           credential source)
 *   5. search.reindex_interval_minutes     (number)
 *   6. search.index_task_timeout_seconds   (number)
 *
 * The Settings module's value-type registry only recognises a handful of
 * primitives (`string`, `number`, `boolean`, `json`, `string_list`) — range
 * bounds are enforced by the Search module's own LlmToggleService and the
 * suggest endpoint's parser, not by the manifest.
 */
export const SEARCH_SETTING_CODES = {
  POPUP_SUGGESTION_COUNT: 'search.popup.suggestion_count',
  POPUP_MINIMUM_QUERY_LENGTH: 'search.popup.minimum_query_length',
  LLM_ENABLED: 'search.llm.enabled',
  // Feature 058 — the single embedder credential source: a reusable `llm`
  // credential configuration supplying the embedder URL (Base URL), API key and
  // model.
  LLM_EMBEDDER_CREDENTIALS: 'search.llm.embedder_credentials',
  REINDEX_INTERVAL_MINUTES: 'search.reindex_interval_minutes',
  INDEX_TASK_TIMEOUT_SECONDS: 'search.index_task_timeout_seconds',
} as const;

export const DEFAULT_POPUP_SUGGESTION_COUNT = 8;
export const DEFAULT_POPUP_MINIMUM_QUERY_LENGTH = 3;
export const DEFAULT_REINDEX_INTERVAL_MINUTES = 10;

/**
 * How long the indexer keeps waiting for one Meilisearch task before it gives
 * up and says so — the default of {@link SEARCH_SETTING_CODES.INDEX_TASK_TIMEOUT_SECONDS}.
 *
 * The number this replaces was the `meilisearch` client's own default of 5000
 * ms, taken by omission at nine of the indexer's twelve waits. It is the wrong
 * order of magnitude for the thing being waited on, and the reason is that a
 * task wait is not a measurement of the task: it is
 * `queue ahead of this task` + `this task's own work`, and Meilisearch's task
 * queue is global to the instance. Measured on a developer machine, a
 * one-document write into an empty index expired the 5000 ms wait after 5006 ms
 * with twelve document batches enqueued ahead of it, and then settled
 * `succeeded` 10540 ms later. Nothing about that task was slow.
 *
 * 120 s is therefore sized for the queue rather than for the corpus, and the
 * cost of sizing it generously is close to nil: an expired wait does **not**
 * cancel the Meilisearch task, and a task that genuinely dies comes back
 * `failed` immediately rather than by timing out. So the only thing a short
 * value buys is noticing a task that is stuck forever, and the only thing it
 * costs is aborting a reindex that was going to succeed — in
 * `reindexChannel`'s case between the wipe and the document push, which leaves
 * the channel index empty.
 *
 * An operator whose catalogue or Meilisearch host makes even this too short
 * raises the setting; nothing in this repository can know their corpus size or
 * their index throughput, which is why the number is a Setting and not only
 * this constant.
 */
export const DEFAULT_INDEX_TASK_TIMEOUT_SECONDS = 120;

const settings = defineModuleSettingsManifest({
  moduleCode: 'search',
  groups: [
    {
      code: 'search',
      name: 'Search',
    },
  ],
  settings: [
    {
      // Feature 073 — the operator's activation control. Platform-wide.
      code: 'search.enabled',
      name: 'Search enabled',
      description:
        'Switches product search on or off: the storefront typeahead popup and result feed, the search-phrase analytics ingest, the admin LLM and reindex screens, and the catalogue indexer that keeps Meilisearch in step with product changes. Nothing is dropped — the indexes, the recorded phrases and the LLM configuration stay, and a reindex after switching back restores what changed while it was off.',
      groupCode: 'search',
      valueType: 'boolean',
      defaultValue: true,
    },
    {
      code: SEARCH_SETTING_CODES.POPUP_SUGGESTION_COUNT,
      name: 'Suggestion popup — result count',
      description:
        'How many products the storefront shows in the typeahead popup. Set to 0 to suppress the popup; the explicit "Search" action still works.',
      groupCode: 'search',
      valueType: 'number',
      defaultValue: DEFAULT_POPUP_SUGGESTION_COUNT,
    },
    {
      code: SEARCH_SETTING_CODES.POPUP_MINIMUM_QUERY_LENGTH,
      name: 'Suggestion popup — minimum query length',
      description:
        'How many characters the customer must type before the typeahead popup is requested. Below the threshold the storefront fires no request and the analytics-record endpoint silently no-ops.',
      groupCode: 'search',
      valueType: 'number',
      defaultValue: DEFAULT_POPUP_MINIMUM_QUERY_LENGTH,
    },
    {
      code: SEARCH_SETTING_CODES.LLM_ENABLED,
      name: 'LLM-augmented search — enabled',
      description:
        'When on, Meilisearch runs hybrid lexical + semantic search using the configured embedder. Enabling this requires the three embedder.* values below to be non-empty.',
      groupCode: 'search',
      valueType: 'boolean',
      defaultValue: false,
    },
    {
      code: SEARCH_SETTING_CODES.LLM_EMBEDDER_CREDENTIALS,
      name: 'LLM-augmented search — embedder credentials',
      description:
        'Reference a reusable LLM credential configuration (Credentials screen). Its Base URL, API Key and Model provide the embedder endpoint, credential and model. Required to enable LLM-augmented search.',
      groupCode: 'search',
      valueType: 'credential_ref',
      configurationType: 'llm',
      defaultValue: '',
    },
    {
      code: SEARCH_SETTING_CODES.REINDEX_INTERVAL_MINUTES,
      name: 'Product reindex interval (minutes)',
      description:
        'How often the background worker rebuilds every sales-channel Meilisearch index so the catalogue stays in sync. Set to 0 to disable the periodic sweep — manual reindexing from the admin remains available.',
      groupCode: 'search',
      valueType: 'number',
      defaultValue: DEFAULT_REINDEX_INTERVAL_MINUTES,
    },
    {
      code: SEARCH_SETTING_CODES.INDEX_TASK_TIMEOUT_SECONDS,
      name: 'Index task timeout (seconds)',
      description:
        'How long to wait for one Meilisearch indexing task before reporting that it is still running. Raise it if reindexing a large catalogue, or a Meilisearch instance shared with other work, reports that a task is still running: the wait covers the instance-wide task queue as well as the work itself, and giving up early does not cancel the task. Lower it only to be told sooner that indexing has stopped moving.',
      groupCode: 'search',
      valueType: 'number',
      defaultValue: DEFAULT_INDEX_TASK_TIMEOUT_SECONDS,
    },
  ],
});

/** Module-lifecycle manifest (feature 018). */
export const manifest = defineModuleManifest({
  id: 'search',
  name: 'Search',
  description:
    'Per-channel Meilisearch indexes, suggest popup, and optional LLM-augmented search.',
  version: '1.0.0',
  /**
   * What this module needs from the environment (`specs/117-instance-bring-up/`
   * FR-002). Only what it **owns**: its reads of platform-owned names are
   * satisfied by `packages/platform/src/env/index.ts`.
   *
   * Why each of these is not a Setting is its entry in
   * `backend/scripts/ledgers/module-environment-inputs/search.ts`.
   *
   * `MEILISEARCH_URL` is **not** here, and its absence is the rule working
   * rather than an omission. D-229 moved the liveness probe into the platform,
   * and the probe reads that address — so the platform declares it, and
   * `module-declares-a-platform-input` refuses a second description of one
   * variable (D-100). This module still reads it; a read resolves against the
   * platform's declaration as well as its own.
   */
  env: [
    {
      name: 'MEILISEARCH_API_KEY',
      describes: {
        en: 'The key this instance presents to Meilisearch.',
        pl: 'Klucz, którym ta instancja uwierzytelnia się w Meilisearch.',
      },
      requirement: {
        kind: 'optional',
        without: {
          en: 'Meilisearch is addressed with no key, which works only against a server that has none — and such a server can be read and rewritten by anything that can reach it.',
          pl: 'Meilisearch jest odpytywany bez klucza, co działa tylko wobec serwera, który go nie ma — a taki serwer może odczytać i nadpisać wszystko, co zdoła się z nim połączyć.',
        },
      },
      secret: true,
      generable: false,
      owner: { kind: 'module', moduleId: 'search' },
      consumers: ['backend'],
      addressOf: null,
    },
  ],
  // Feature 075, Phase C — `organizations` joins the five that were already
  // here. The typeahead's price resolution needs the buyer's organisation, and
  // this module used to read that row with `em.findOne(Organization, …)`; it
  // now resolves `organizationDetailsPort`, and an undeclared port edge is a
  // build failure rather than a silent one.
  dependencies: [
    'catalog',
    'credentials',
    'organizations',
    'price_lists',
    'sales_channels',
    'settings',
  ],
  settings,
  activation: { settingCode: 'search.enabled', default: true },
  /**
   * Feature 090, Phase 3 — the error codes this module owns.
   *
   * The list is the incumbent prefix chain's *answer* for `search`, copied from
   * the frozen capture at `backend/test/fixtures/error-code-routing/chain-answers.ts`
   * (`grep -oE "^  [A-Z0-9_]+: 'search'," …`). It is a transcription, not a
   * judgement: the migration is answer-preserving over all 289 codes and
   * re-routing is out of scope (`specs/090-module-owned-error-codes/` §6.2, §6.5).
   *
   * **Trap T1 does not bite here, and that was measured rather than assumed.**
   * The chain answers `search` from three prefixes — `QUERY_`, `SEARCH_`,
   * `PHRASE_` — plus a three-member `SEARCH_MISC_ERROR_CODES` set. Every code in
   * the enumeration carrying one of those prefixes routes here (five of them),
   * no earlier rule shadows any of them, and all three misc members survive to
   * this rule. So reading the chain's source would have given the same eight as
   * reading its answer. `inventory` and `assets_library` are where it does bite;
   * this module is the case where the two agree, which is worth recording so the
   * next reader knows the question was asked.
   *
   * **Six of the eight are codes a reader would attribute to `core`.**
   * `LIMIT_OUT_OF_RANGE`, `PHRASE_REQUIRED`, `PHRASE_TOO_LONG`, `QUERY_TOO_LONG`,
   * `QUERY_TOO_SHORT` and `RESULT_COUNT_INVALID` carry no `SEARCH_` prefix and
   * read as generic request-validation refusals; only `SEARCH_BACKEND_UNAVAILABLE`
   * and `LLM_CONFIG_INCOMPLETE` name this module's domain. They belong here
   * because `routes.public.ts` hand-parses `?q=&limit=` precisely to avoid the
   * generic `VALIDATION_FAILED` — its own comment says so — and nothing else in
   * `packages`, `backend/src`, `admin/src` or `storefront/src` names any of the
   * six. Do not read the plain names as a routing accident; they are this
   * module's refusals wearing generic clothes.
   *
   * **The inverse is the larger half: this package raises three codes it does
   * not own, and one of the three is recorded nowhere else.** `routes.public.ts`
   * raises `sales_channels`' `MISSING_SALES_CHANNEL_CONTEXT` (which
   * `sales_channels` recorded in !1128), `llm-toggle.service.ts` raises
   * `settings`' `SETTING_OUT_OF_SCOPE_FOR_CHANNEL` (which `settings` recorded in
   * !1133), and `search-query.service.ts` raises `catalog`'s
   * `FILTER_NOT_ALLOWED` when a requested facet is not a filterable attribute —
   * `catalog` declared that code in !1117 and named no thrower, so this is the
   * first record of it. All three are the D-95.2 rule seen from the thrower's
   * side: routing follows the domain noun, and a channel, a setting scope and an
   * attribute's filterability are not search nouns. None is declared here.
   *
   * **No code is raised by nothing.** All eight have a live raise site. This
   * package throws `HttpError` ten times; seven of the ten raise one of these
   * eight (six in `routes.public.ts`, one in `llm-toggle.service.ts`) and the
   * other three are the foreign codes above — so it contributes nothing to the
   * register entry that splits unraised codes by kind, in any of its five. Three
   * of the eight reach the `throw` through a computed local rather than at the
   * call: `routes.public.ts` picks `PHRASE_TOO_LONG` / `RESULT_COUNT_INVALID` /
   * `PHRASE_REQUIRED` into a `const code` from the first Zod issue and throws
   * that, and all three branches are reachable under
   * `RecordPhraseRequestSchema`. The route carrying them is mounted
   * unconditionally by `plugin.ts`, so the reachability question the register's
   * fifth kind asks — is there an HTTP door — answers yes for every one.
   *
   * Both spellings were searched, which trap T12 asks for: `ERROR_CODES.<CODE>`
   * and the bare quoted literal, over `packages`, `backend/src`, `admin/src` and
   * `storefront/src`. Outside the enumeration in `@endora-commerce/contracts`,
   * the chain's own `SEARCH_MISC_ERROR_CODES` set and this declaration, every
   * occurrence is one of those seven raise sites.
   *
   * No `tokens`, derived rather than assumed. `refusalToken`
   * (`packages/platform/src/http/error-envelope.ts`) reads `details.code` and
   * nothing else; all seven raise sites were read, and the six that pass a
   * fourth argument all pass the Zod-style `Array<{ path, issue }>`, which
   * `refusalToken` returns `null` for by construction. The runbook's §5
   * raise-site scan attributes the tree's ten token-carrying codes over 41 sites
   * to `core`, `invoices` and `carts` and names none of these, and in the other
   * direction the module's own bundles hold eight `errors.<CODE>` sentences and
   * no `errors.<CODE>.<token>` key.
   */
  errorCodes: [
    { code: 'LIMIT_OUT_OF_RANGE' },
    { code: 'LLM_CONFIG_INCOMPLETE' },
    { code: 'PHRASE_REQUIRED' },
    { code: 'PHRASE_TOO_LONG' },
    { code: 'QUERY_TOO_LONG' },
    { code: 'QUERY_TOO_SHORT' },
    { code: 'RESULT_COUNT_INVALID' },
    { code: 'SEARCH_BACKEND_UNAVAILABLE' },
  ],
  i18n: { bundlesDir: 'i18n' },
  docs: { dir: 'docs' },
  permissions: [{ code: 'search:write', label: 'Configure search (LLM / indexing)' }],
});

/** Legacy export retained for backward compatibility. */
export const searchManifest = settings;

/**
 * The operator command this module declares — feature 080, T042b / D-160.9.
 *
 * It was `scripts/reindex.ts`, which hand-built a second `SearchIndexer` out of
 * five services owned by `catalog` and `custom_fields`. The body is
 * `await import()`ed because this file is imported by the generated manifest
 * index, and through it by every static check script and by
 * `src/db/configured-migrations.ts`; a static import of the indexer would pull a
 * Meilisearch client into all of them.
 *
 * `search` is switchable (`search.enabled` above), so this is also the command
 * that shows what the host does with a switched-off module's declaration: the
 * runner asks `requireModuleEnabled('search')` before it builds a context, and
 * the command does not run.
 */
export const cliCommands: ReadonlyArray<ModuleCliCommand<ModuleContext>> = [
  {
    name: 'reindex',
    summary: "Rebuild every sales channel's Meilisearch index from PostgreSQL.",
    run: async (context) => (await import('./backend/cli/reindex.js')).reindex(context),
  },
];
