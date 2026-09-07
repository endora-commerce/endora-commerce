import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  FEED_TEMPLATE_DOCUMENT_FORMAT_VERSION,
  PRODUCT_FEED_ERROR_CODES,
  importFeedTemplateRequestSchema,
  slugify,
  type FeedFieldSourceKind,
  type FeedFieldTransform,
  type FeedItemGranularity,
  type FeedOutputFormat,
  type FeedProviderCode,
  type FeedTemplateDocument,
  type ImportFeedTemplateRequest,
  type TaxonomyProviderCode,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { FeedTaxonomy } from '../entities/feed-taxonomy.entity.js';
import { FeedTemplate } from '../entities/feed-template.entity.js';
import {
  makeImportTemplateCommand,
  type TemplateFieldValues,
  type TemplateWriteValues,
} from '../commands/feed-template.commands.js';
import { normalizeOutputName } from './feed-template.service.js';
import type { FeedTemplateService, TemplateView } from './feed-template.service.js';

/**
 * Template portability — feature 067 / FR-012–FR-018,
 * `contracts/template-portability.md`.
 *
 * ## Export
 *
 * The document deliberately carries **nothing local**: no uuid (meaningless on
 * the target), no timestamp (it would break "two exports of an unchanged
 * template are identical"), no `isSystem`, no feed binding, no token. Bindings
 * travel as stable definition **keys**, which is the only reason a
 * cross-installation import can resolve anything at all.
 *
 * Determinism (FR-013) is bought with an explicit key order and a total sort —
 * `sortOrder`, then `outputName` — rather than with a canonical-JSON
 * dependency. `JSON.stringify` over objects built key by key is sufficient,
 * because ES object key order is insertion order for string keys.
 *
 * ## Import
 *
 * This is the module's one **untrusted-input** surface, so the order of
 * operations matters:
 *
 *  1. the envelope is parsed by Zod first — shape, field-count ceiling and
 *     `formatVersion` (a literal, so an unknown version is refused rather than
 *     dispatched on);
 *  2. the template's own rules are re-checked (duplicate output names, a
 *     `provider_category` field with no taxonomy), because a document from
 *     another installation is not automatically a valid template here;
 *  3. bindings are resolved against the local definition registry — an
 *     unresolvable key is imported `unbound: true` and **reported**, never
 *     dropped and never a 400 (FR-015);
 *  4. only then is anything written, as **one** Command.
 *
 * The document has no id by construction, so an import can only ever create a
 * template or replace the one whose **name** the operator was shown and
 * explicitly chose to replace. There is no path by which a crafted file aims a
 * write at an unrelated row.
 */

/**
 * The template columns an export reads. Declared structurally rather than as
 * the entity so the deterministic-serialization test needs no database.
 */
export interface ExportableTemplate {
  name: string;
  description?: string | null;
  providerCode: FeedProviderCode;
  outputFormat: FeedOutputFormat;
  itemGranularity: FeedItemGranularity;
}

export interface ExportableTemplateField {
  outputName: string;
  sourceKind: FeedFieldSourceKind;
  sourceKey?: string | null;
  constantValue?: string | null;
  fallbackValue?: string | null;
  providerRequired: boolean;
  transform?: FeedFieldTransform | null;
  transformArg?: string | null;
  sortOrder: number;
  helpKey?: string | null;
}

/** The order every exported document is written in — see the determinism note. */
export function buildTemplateDocument(
  template: ExportableTemplate,
  fields: ExportableTemplateField[],
  taxonomyProviderCode: TaxonomyProviderCode | null,
): FeedTemplateDocument {
  const ordered = [...fields].sort(
    (a, b) => a.sortOrder - b.sortOrder || compareNames(a.outputName, b.outputName),
  );
  return {
    formatVersion: FEED_TEMPLATE_DOCUMENT_FORMAT_VERSION,
    template: {
      name: template.name,
      description: template.description ?? null,
      providerCode: template.providerCode,
      outputFormat: template.outputFormat,
      itemGranularity: template.itemGranularity,
      taxonomyProviderCode,
      fields: ordered.map((field) => ({
        outputName: field.outputName,
        sourceKind: field.sourceKind,
        sourceKey: field.sourceKey ?? null,
        constantValue: field.constantValue ?? null,
        fallbackValue: field.fallbackValue ?? null,
        providerRequired: field.providerRequired,
        transform: field.transform ?? null,
        transformArg: field.transformArg ?? null,
        sortOrder: field.sortOrder,
        helpKey: field.helpKey ?? null,
      })),
    },
  };
}

/**
 * A byte-stable tie-break. Deliberately not `localeCompare`: its result depends
 * on the runtime's ICU data, and "identical on two exports" has to hold across
 * two machines, not just two calls.
 */
function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Two-space indentation and a trailing newline: a file a human may open. */
export function serializeTemplateDocument(document: FeedTemplateDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

/**
 * `google-merchant-center-pl.feed-template.json`. Named after the template
 * rather than its id, because the file is something a human hands to another
 * human.
 *
 * The slug is `slugify` from `@endora-commerce/contracts`, **imported, never
 * re-implemented** (issue #245). The private chain this carried folded with
 * `NFKD` and then stripped the combining marks, which leaves `ł` standing —
 * U+0142 has no canonical decomposition — for the `[^a-z0-9]+` collapse to
 * delete: `Łatwy szablon` produced `atwy-szablon`, and the leading separator
 * went with it. Its strip also ran before the 80-character cut, so a cut
 * landing on a separator left the filename ending in `-`.
 *
 * **The shared fold is NFD, so this gives up NFKD's compatibility mappings.**
 * They reach a filename only through characters that map into `[a-z0-9]` —
 * `ﬁ`, `²`, the full-width forms — none of which is typed into a template name,
 * and where one is it now collapses to `-` rather than to a wrong letter, so
 * the filename stays legal. `ł` was being deleted out of every Polish one.
 *
 * Filenames already downloaded are **not** re-derived anywhere: the importer
 * reads the document body (`importDocument` takes `request.document`), and this
 * value only ever reaches a `Content-Disposition` header. Nothing matches on it.
 */
export function templateDocumentFilename(name: string): string {
  const slug = slugify(name, { maxLength: 80, fallback: 'feed-template' });
  return `${slug}.feed-template.json`;
}

/** The two providers that publish a category taxonomy the module installs (FR-077). */
const TAXONOMY_PROVIDERS: ReadonlySet<string> = new Set(['google_merchant', 'meta']);

/**
 * Which provider taxonomy a document should declare.
 *
 * `FeedTemplate` stores the taxonomy as a foreign key to an **installed
 * revision**, which is null on an installation where the data has not been
 * dropped in. Exporting that null would produce a document that no installation
 * could import: it would still carry a `provider_category` field, which FR-082
 * refuses without a declared taxonomy.
 *
 * The fallback is the platform's own rule rather than an inference —
 * `TaxonomyReconcilerService.linkTemplatesToCurrentTaxonomies` points every
 * template at the current revision of **its own `providerCode`** — so a Google
 * template declares the Google taxonomy whether or not this installation has
 * the files.
 */
export function taxonomyProviderForExport(view: {
  template: { providerCode: FeedProviderCode };
  taxonomyProviderCode: TaxonomyProviderCode | null;
}): TaxonomyProviderCode | null {
  if (view.taxonomyProviderCode) return view.taxonomyProviderCode;
  return TAXONOMY_PROVIDERS.has(view.template.providerCode)
    ? (view.template.providerCode as TaxonomyProviderCode)
    : null;
}

/** Source kinds whose `sourceKey` names a local definition (FR-015). */
const KEYED_SOURCE_KINDS: ReadonlySet<FeedFieldSourceKind> = new Set([
  'attribute',
  'custom_field',
]);

export interface UnresolvedBinding {
  outputName: string;
  sourceKind: FeedFieldSourceKind;
  sourceKey: string;
}

export interface ImportResult {
  view: TemplateView;
  unresolvedBindings: UnresolvedBinding[];
}

export interface FeedTemplateIoDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  templates: FeedTemplateService;
  /** Product-host attribute and custom-field keys — one registry since 061. */
  listProductFieldKeys: () => Promise<Set<string>>;
}

/**
 * One refusal shape for the whole surface, matching the rest of the module: the
 * transport code says how the request failed, `details.reason` says which rule
 * refused it, and the message says what to do about it.
 */
function refuse(
  status: 400 | 409,
  reason: string,
  message: string,
  extra: Record<string, unknown> = {},
): HttpError {
  return new HttpError(
    status,
    status === 409 ? ERROR_CODES.PRODUCT_FEED_TEMPLATE_CONFLICT : ERROR_CODES.VALIDATION_FAILED,
    message,
    { reason, ...extra },
  );
}

/**
 * Parses the import envelope.
 *
 * A free function, and called by the route before the service is touched, so
 * that "shape and size are checked before anything is read" is visible in the
 * call site rather than being a property one has to trust.
 */
export function parseImportRequest(body: unknown): ImportFeedTemplateRequest {
  const parsed = importFeedTemplateRequestSchema.safeParse(body);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const path = issue?.path.join('.') || 'document';
  throw refuse(
    400,
    PRODUCT_FEED_ERROR_CODES.INVALID_TEMPLATE_DOCUMENT,
    `This file is not a feed template the platform can read (${path}: ${issue?.message ?? 'invalid'}). Nothing was imported.`,
    { field: path },
  );
}

export class FeedTemplateIoService {
  constructor(private readonly deps: FeedTemplateIoDeps) {}

  // -------------------------------------------------------------------------
  // Export (FR-012, FR-013)
  // -------------------------------------------------------------------------

  async exportDocument(
    templateId: string,
  ): Promise<{ document: FeedTemplateDocument; filename: string; serialized: string }> {
    const view = await this.deps.templates.view(templateId);
    const document = buildTemplateDocument(
      view.template,
      view.fields,
      taxonomyProviderForExport(view),
    );
    return {
      document,
      filename: templateDocumentFilename(view.template.name),
      // `serialized`, not `body`: this module spells an HTTP request body
      // `body` too, and one module-scoped key of that name made
      // `check:port-catches` read `response.body.cancel()` in three
      // unrelated files as a call through a port.
      serialized: serializeTemplateDocument(document),
    };
  }

  // -------------------------------------------------------------------------
  // Import (FR-014 – FR-018)
  // -------------------------------------------------------------------------

  async importDocument(request: ImportFeedTemplateRequest): Promise<ImportResult> {
    const incoming = request.document.template;
    const em = this.deps.emFactory();

    const taxonomyId = incoming.taxonomyProviderCode
      ? ((
          await em.findOne(FeedTaxonomy, {
            providerCode: incoming.taxonomyProviderCode,
            isCurrent: true,
          })
        )?.id ?? null)
      : null;

    const { fields, unresolvedBindings } = await this.resolveFields(
      incoming.fields,
      incoming.taxonomyProviderCode !== null,
    );

    const values: TemplateWriteValues = {
      name: incoming.name.trim(),
      description: incoming.description ?? null,
      providerCode: incoming.providerCode,
      outputFormat: incoming.outputFormat,
      itemGranularity: incoming.itemGranularity,
      taxonomyId,
    };

    const existing = await em.findOne(FeedTemplate, { name: values.name, deletedAt: null });

    // FR-017 — nothing is ever overwritten by default. The refusal names the
    // template the operator already has, so the admin can offer the choice.
    if (existing && !request.onNameConflict) {
      throw refuse(
        409,
        PRODUCT_FEED_ERROR_CODES.TEMPLATE_NAME_CONFLICT,
        `You already have a template called "${values.name}".`,
        { existingTemplateId: existing.id, existingName: existing.name },
      );
    }

    if (existing && request.onNameConflict === 'replace') {
      if (existing.isSystem) {
        throw refuse(
          409,
          PRODUCT_FEED_ERROR_CODES.TEMPLATE_IS_SYSTEM,
          'That template comes with the platform, so it cannot be replaced. Import it under a different name instead.',
          { existingTemplateId: existing.id, existingName: existing.name },
        );
      }
      // Replacing in place keeps the id, so every feed already pointing at this
      // template keeps working and picks the new field list up on its next run.
      const saved = await this.deps.commandBus.run(
        makeImportTemplateCommand({ mode: 'replace', templateId: existing.id }, values, fields),
      );
      return { view: await this.deps.templates.view(saved.template.id), unresolvedBindings };
    }

    if (existing) values.name = await this.freeCopyName(values.name);
    const saved = await this.deps.commandBus.run(
      makeImportTemplateCommand({ mode: 'create' }, values, fields),
    );
    return { view: await this.deps.templates.view(saved.template.id), unresolvedBindings };
  }

  /**
   * `"<name> (imported)"`, then `"<name> (imported 2)"`, … — a counter rather
   * than a uuid suffix, because the operator has to recognise the row in a list
   * a minute later.
   */
  private async freeCopyName(name: string): Promise<string> {
    const em = this.deps.emFactory();
    const base = `${name} (imported)`.slice(0, 200);
    if (!(await em.findOne(FeedTemplate, { name: base, deletedAt: null }))) return base;
    for (let index = 2; index < 100; index += 1) {
      const candidate = `${name} (imported ${index})`.slice(0, 200);
      if (!(await em.findOne(FeedTemplate, { name: candidate, deletedAt: null }))) return candidate;
    }
    throw refuse(
      409,
      PRODUCT_FEED_ERROR_CODES.TEMPLATE_NAME_CONFLICT,
      `Too many templates are already called "${name}". Rename one before importing again.`,
      { existingName: name },
    );
  }

  /**
   * Re-validates the document against the template rules and resolves every
   * keyed binding locally.
   *
   * The asymmetry is deliberate and is the heart of FR-015/FR-016: a
   * **structurally** broken template (two fields with one output name, a
   * provider category with no taxonomy) is refused, because it could never be
   * saved through the editor either. A **binding** that does not resolve is
   * accepted and reported, because it is exactly the thing the operator has to
   * fix here and cannot fix in the file.
   */
  private async resolveFields(
    incoming: FeedTemplateDocument['template']['fields'],
    hasTaxonomy: boolean,
  ): Promise<{ fields: TemplateFieldValues[]; unresolvedBindings: UnresolvedBinding[] }> {
    const seen = new Set<string>();
    for (const field of incoming) {
      const name = normalizeOutputName(field.outputName);
      if (seen.has(name)) {
        throw refuse(
          400,
          PRODUCT_FEED_ERROR_CODES.DUPLICATE_OUTPUT_NAME,
          `The file has two fields called "${name}". Nothing was imported.`,
          { outputName: name },
        );
      }
      seen.add(name);
    }

    const knownKeys = incoming.some((field) => KEYED_SOURCE_KINDS.has(field.sourceKind))
      ? await this.deps.listProductFieldKeys()
      : new Set<string>();

    const unresolvedBindings: UnresolvedBinding[] = [];
    const fields: TemplateFieldValues[] = [];

    for (const field of incoming) {
      const outputName = normalizeOutputName(field.outputName);
      const sourceKey = field.sourceKey?.trim() ? field.sourceKey.trim() : null;

      if (field.sourceKind === 'provider_category' && !hasTaxonomy) {
        throw refuse(
          400,
          PRODUCT_FEED_ERROR_CODES.TAXONOMY_REQUIRED_FOR_PROVIDER_CATEGORY,
          `"${outputName}" sends a provider category, but the file declares no provider taxonomy. Nothing was imported.`,
          { outputName },
        );
      }

      if (field.sourceKind === 'constant' && (field.constantValue ?? '').trim() === '') {
        throw refuse(
          400,
          PRODUCT_FEED_ERROR_CODES.INVALID_TEMPLATE_DOCUMENT,
          `"${outputName}" sends a fixed value but the file carries none. Nothing was imported.`,
          { outputName },
        );
      }

      let unbound = false;
      if (KEYED_SOURCE_KINDS.has(field.sourceKind)) {
        if (sourceKey === null || !knownKeys.has(sourceKey)) {
          // FR-015 — imported, flagged and reported. FR-016 then stops any feed
          // on this template from running until the operator fixes it, so an
          // empty column can never reach a provider.
          unbound = true;
          unresolvedBindings.push({
            outputName,
            sourceKind: field.sourceKind,
            sourceKey: sourceKey ?? '',
          });
        }
      }

      fields.push({
        outputName,
        sourceKind: field.sourceKind,
        sourceKey,
        constantValue: field.constantValue ?? null,
        fallbackValue: field.fallbackValue ?? null,
        providerRequired: field.providerRequired,
        transform: field.transform ?? null,
        transformArg: field.transformArg ?? null,
        // Travels with the document: an unknown key renders as no gloss, never
        // as a raw key, so it is safe to carry across installations.
        helpKey: field.helpKey ?? null,
        unbound,
      });
    }

    return { fields, unresolvedBindings };
  }
}
