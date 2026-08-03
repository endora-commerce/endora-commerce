import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  PRODUCT_FEED_ERROR_CODES,
  type CreateFeedTemplateRequest,
  type FeedTemplateFieldWrite,
  type TaxonomyProviderCode,
  type UpdateFeedTemplateRequest,
} from '@b2b/contracts';
import type { CommandBus } from '../../../commands/index.js';
import { HttpError } from '../../../http/error-envelope.js';
import { FeedTaxonomy } from '../entities/feed-taxonomy.entity.js';
import { FeedTemplate } from '../entities/feed-template.entity.js';
import { FeedTemplateField } from '../entities/feed-template-field.entity.js';
import { ProductFeed } from '../entities/product-feed.entity.js';
import {
  makeCreateTemplateCommand,
  makeDeleteTemplateCommand,
  makeDuplicateTemplateCommand,
  makeUpdateTemplateCommand,
  type TemplateFieldValues,
  type TemplateWithFields,
  type TemplateWriteValues,
} from '../commands/feed-template.commands.js';

/**
 * Feed template CRUD — feature 067 / FR-001–FR-010, FR-068, FR-074, FR-076,
 * FR-082.
 *
 * This service is the whole reason a merchandiser can be trusted with the
 * structure editor: it is where "the operator built something that cannot
 * work" is turned into a sentence naming the field, **before** the template is
 * saved and long before a run fails at four in the morning.
 *
 * Three rules that are easy to get subtly wrong:
 *
 *  - **A system template is read-only** (FR-008). Not "read-only in the UI" —
 *    every mutation path refuses it, because the boot reconciler owns those
 *    rows and an operator edit would be silently reverted on the next upgrade.
 *  - **Removing a provider-required field is neither refused nor silent**
 *    (FR-074). The platform cannot know a provider's current rules better than
 *    the operator, so it states the consequence and then obeys.
 *  - **`provider_category` needs a declared taxonomy** (FR-082). Without one
 *    the field can only ever resolve to nothing, so binding it is a promise
 *    the template cannot keep.
 */

export interface FeedTemplateServiceDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  /**
   * Product-host attribute and custom-field keys — one registry since feature
   * 061. Injected as a lambda so this module never reaches into
   * `custom_fields` internals (Principle I).
   */
  listProductFieldKeys: () => Promise<Set<string>>;
}

/** What the operator has to be told about before the save goes through. */
export interface TemplateSaveWarning {
  code: 'provider_required_field_removed';
  outputName: string;
}

export class ConfirmationRequiredError extends HttpError {
  constructor(warnings: TemplateSaveWarning[]) {
    super(
      409,
      ERROR_CODES.PRODUCT_FEED_CONFIRMATION_REQUIRED,
      'This save removes a field the provider requires. Confirm it to go ahead.',
      { warnings },
    );
  }
}

/**
 * One refusal shape for the whole surface: the transport code says how the
 * request failed, `details.reason` says which rule refused it, and the message
 * says what to do about it (FR-073 — plain operator language, not a code).
 */
function refuse(
  status: 400 | 409,
  reason: string,
  message: string,
  extra: Record<string, unknown> = {},
): HttpError {
  return new HttpError(
    status,
    status === 409
      ? ERROR_CODES.PRODUCT_FEED_TEMPLATE_CONFLICT
      : ERROR_CODES.VALIDATION_FAILED,
    message,
    { reason, ...extra },
  );
}

/** Source kinds that carry a definition key rather than a fixed meaning. */
const KEYED_SOURCE_KINDS = new Set(['attribute', 'custom_field']);

export interface TemplateView extends TemplateWithFields {
  taxonomyProviderCode: TaxonomyProviderCode | null;
  usedByFeedCount: number;
}

export class FeedTemplateService {
  constructor(private readonly deps: FeedTemplateServiceDeps) {}

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async getOrFail(templateId: string): Promise<FeedTemplate> {
    const template = await this.deps
      .emFactory()
      .findOne(FeedTemplate, { id: templateId, deletedAt: null });
    if (!template) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Feed template not found.');
    return template;
  }

  async view(templateId: string): Promise<TemplateView> {
    const template = await this.getOrFail(templateId);
    return this.decorate(template);
  }

  async list(): Promise<TemplateView[]> {
    const em = this.deps.emFactory();
    const templates = await em.find(
      FeedTemplate,
      { deletedAt: null },
      { orderBy: { isSystem: 'desc', name: 'asc' } },
    );
    if (templates.length === 0) return [];
    const ids = templates.map((t) => t.id);
    const fields = await em.find(
      FeedTemplateField,
      { feedTemplateId: { $in: ids } },
      { orderBy: { sortOrder: 'asc' } },
    );
    const feeds = await em.find(ProductFeed, { feedTemplateId: { $in: ids } });
    const taxonomies = await em.find(FeedTaxonomy, {});
    const byTemplate = new Map<string, FeedTemplateField[]>();
    for (const field of fields) {
      const list = byTemplate.get(field.feedTemplateId) ?? [];
      list.push(field);
      byTemplate.set(field.feedTemplateId, list);
    }
    const usage = new Map<string, number>();
    for (const feed of feeds) {
      usage.set(feed.feedTemplateId, (usage.get(feed.feedTemplateId) ?? 0) + 1);
    }
    const taxonomyById = new Map(taxonomies.map((t) => [t.id, t]));
    return templates.map((template) => ({
      template,
      fields: byTemplate.get(template.id) ?? [],
      taxonomyProviderCode: template.taxonomyId
        ? (taxonomyById.get(template.taxonomyId)?.providerCode ?? null)
        : null,
      usedByFeedCount: usage.get(template.id) ?? 0,
    }));
  }

  private async decorate(template: FeedTemplate): Promise<TemplateView> {
    const em = this.deps.emFactory();
    const fields = await em.find(
      FeedTemplateField,
      { feedTemplateId: template.id },
      { orderBy: { sortOrder: 'asc' } },
    );
    const taxonomy = template.taxonomyId
      ? await em.findOne(FeedTaxonomy, { id: template.taxonomyId })
      : null;
    return {
      template,
      fields,
      taxonomyProviderCode: taxonomy?.providerCode ?? null,
      usedByFeedCount: await em.count(ProductFeed, { feedTemplateId: template.id }),
    };
  }

  // -------------------------------------------------------------------------
  // Guards
  // -------------------------------------------------------------------------

  /** FR-008 — the reconciler owns system templates; an operator edit would be reverted. */
  private assertEditable(template: FeedTemplate): void {
    if (!template.isSystem) return;
    throw refuse(
      409,
      PRODUCT_FEED_ERROR_CODES.TEMPLATE_IS_SYSTEM,
      'This template comes with the platform, so it cannot be changed. Duplicate it to make your own version.',
    );
  }

  /** FR-076 — the editor's fifteen minutes of work must never be clobbered silently. */
  private assertVersion(template: FeedTemplate, expectedVersion: number | null): void {
    if (expectedVersion === null) {
      throw new HttpError(
        428,
        ERROR_CODES.VALIDATION_FAILED,
        'This request needs an If-Match header carrying the template version it was loaded at.',
        { field: 'If-Match' },
      );
    }
    if (expectedVersion !== template.version) {
      throw new HttpError(
        409,
        ERROR_CODES.VERSION_CONFLICT,
        'Someone else saved this template while you were working on it.',
        { currentVersion: template.version },
      );
    }
  }

  private async assertNameFree(name: string, exceptId: string | null): Promise<void> {
    const clash = await this.deps
      .emFactory()
      .findOne(FeedTemplate, { name, deletedAt: null });
    if (clash && clash.id !== exceptId) {
      throw refuse(
        409,
        PRODUCT_FEED_ERROR_CODES.TEMPLATE_NAME_CONFLICT,
        `You already have a template called "${name}".`,
        { name },
      );
    }
  }

  // -------------------------------------------------------------------------
  // Validation (contract admin-templates.md §5)
  // -------------------------------------------------------------------------

  private async validateFields(
    fields: FeedTemplateFieldWrite[],
    context: { itemGranularity: FeedTemplate['itemGranularity']; taxonomyId: string | null },
  ): Promise<TemplateFieldValues[]> {
    const seen = new Set<string>();
    for (const field of fields) {
      const name = normalizeOutputName(field.outputName);
      if (seen.has(name)) {
        throw refuse(
          400,
          PRODUCT_FEED_ERROR_CODES.DUPLICATE_OUTPUT_NAME,
          `Two fields are called "${name}". Give one of them a different name.`,
          { outputName: name },
        );
      }
      seen.add(name);
    }

    const knownKeys = fields.some((f) => KEYED_SOURCE_KINDS.has(f.sourceKind))
      ? await this.deps.listProductFieldKeys()
      : new Set<string>();

    const values: TemplateFieldValues[] = [];
    for (const field of fields) {
      const outputName = normalizeOutputName(field.outputName);
      const sourceKey = field.sourceKey?.trim() ? field.sourceKey.trim() : null;

      if (KEYED_SOURCE_KINDS.has(field.sourceKind)) {
        if (!sourceKey) {
          throw refuse(
            400,
            'source_key_required',
            `"${outputName}" is bound to an attribute, but no attribute was chosen.`,
            { outputName, sourceKey: null },
          );
        }
        if (!knownKeys.has(sourceKey)) {
          // FR-070's other half: the picker only ever offers what exists, so a
          // key that does not resolve arrived from an import or a stale tab.
          throw refuse(
            400,
            'unknown_source_key',
            `There is no attribute or custom field called "${sourceKey}" on this shop.`,
            { outputName, sourceKey },
          );
        }
      }

      if (field.sourceKind === 'provider_category' && context.taxonomyId === null) {
        // FR-082: without a declared taxonomy the field could only ever resolve
        // to nothing, so binding it is a promise the template cannot keep.
        throw refuse(
          400,
          PRODUCT_FEED_ERROR_CODES.TAXONOMY_REQUIRED_FOR_PROVIDER_CATEGORY,
          `"${outputName}" sends a provider category, but this template does not use a provider taxonomy.`,
          { outputName },
        );
      }

      const providerRequired = field.providerRequired ?? false;
      const constantValue = field.constantValue ?? null;
      const fallbackValue = field.fallbackValue ?? null;
      if (
        providerRequired &&
        field.sourceKind === 'constant' &&
        (constantValue ?? '').trim() === '' &&
        (fallbackValue ?? '').trim() === ''
      ) {
        throw refuse(
          400,
          'required_field_has_no_value',
          `"${outputName}" is required, so it needs a value or a fallback.`,
          { outputName },
        );
      }

      values.push({
        outputName,
        sourceKind: field.sourceKind,
        sourceKey,
        constantValue,
        fallbackValue,
        providerRequired,
        transform: field.transform ?? null,
        transformArg: field.transformArg ?? null,
        helpKey: field.helpKey ?? null,
        // A field saved through the editor is bound by construction: the picker
        // only offers what exists, and an unknown key was refused above.
        unbound: false,
      });
    }

    if (context.itemGranularity === 'variant' && !values.some((f) => f.sourceKind === 'grouping_id')) {
      throw refuse(
        400,
        PRODUCT_FEED_ERROR_CODES.GROUPING_FIELD_REQUIRED_FOR_VARIANT_GRANULARITY,
        'A template that sends one row per variant needs a field that ties the variants together.',
      );
    }

    return values;
  }

  /**
   * FR-074 — which provider-required fields this save would take away. Compared
   * by output name against what is persisted, because that is what the operator
   * sees on screen and what the provider will miss.
   */
  private removedRequiredFields(
    before: FeedTemplateField[],
    after: TemplateFieldValues[],
  ): TemplateSaveWarning[] {
    const kept = new Map(after.map((f) => [f.outputName, f]));
    return before
      .filter((field) => field.providerRequired)
      .filter((field) => {
        const survivor = kept.get(field.outputName);
        return survivor === undefined || !survivor.providerRequired;
      })
      .map((field) => ({
        code: 'provider_required_field_removed' as const,
        outputName: field.outputName,
      }));
  }

  /** Resolves the declared taxonomy provider to the currently installed revision. */
  private async resolveTaxonomyId(
    providerCode: TaxonomyProviderCode | null | undefined,
  ): Promise<string | null> {
    if (!providerCode) return null;
    const current = await this.deps
      .emFactory()
      .findOne(FeedTaxonomy, { providerCode, isCurrent: true });
    return current?.id ?? null;
  }

  // -------------------------------------------------------------------------
  // Writes — every one a Command (Principle XIII)
  // -------------------------------------------------------------------------

  async create(request: CreateFeedTemplateRequest): Promise<TemplateView> {
    await this.assertNameFree(request.name, null);
    const taxonomyId = await this.resolveTaxonomyId(request.taxonomyProviderCode);
    const fields = await this.validateFields(request.fields, {
      itemGranularity: request.itemGranularity,
      taxonomyId,
    });
    const values: TemplateWriteValues = {
      name: request.name,
      description: request.description ?? null,
      providerCode: request.providerCode,
      outputFormat: request.outputFormat,
      itemGranularity: request.itemGranularity,
      taxonomyId,
    };
    const saved = await this.deps.commandBus.run(makeCreateTemplateCommand(values, fields));
    return this.decorate(saved.template);
  }

  async update(
    templateId: string,
    request: UpdateFeedTemplateRequest,
    options: { expectedVersion: number | null; acknowledgeWarnings: boolean },
  ): Promise<{ view: TemplateView; warnings: TemplateSaveWarning[] }> {
    const current = await this.getOrFail(templateId);
    this.assertEditable(current);
    this.assertVersion(current, options.expectedVersion);
    if (request.name !== undefined) await this.assertNameFree(request.name, templateId);

    const em = this.deps.emFactory();
    const existingFields = await em.find(
      FeedTemplateField,
      { feedTemplateId: templateId },
      { orderBy: { sortOrder: 'asc' } },
    );

    const itemGranularity = request.itemGranularity ?? current.itemGranularity;
    const taxonomyId =
      request.taxonomyProviderCode === undefined
        ? (current.taxonomyId ?? null)
        : await this.resolveTaxonomyId(request.taxonomyProviderCode);

    let fields: TemplateFieldValues[] | undefined;
    let warnings: TemplateSaveWarning[] = [];
    if (request.fields !== undefined) {
      fields = await this.validateFields(request.fields, { itemGranularity, taxonomyId });
      warnings = this.removedRequiredFields(existingFields, fields);
      if (warnings.length > 0 && !options.acknowledgeWarnings) {
        // Neither silent nor blocked: the operator is told exactly what the
        // provider will miss, and re-sending with the acknowledgement obeys.
        throw new ConfirmationRequiredError(warnings);
      }
    }

    const patch: Partial<TemplateWriteValues> = {};
    if (request.name !== undefined) patch.name = request.name;
    if (request.description !== undefined) patch.description = request.description ?? null;
    if (request.providerCode !== undefined) patch.providerCode = request.providerCode;
    if (request.outputFormat !== undefined) patch.outputFormat = request.outputFormat;
    if (request.itemGranularity !== undefined) patch.itemGranularity = request.itemGranularity;
    if (request.taxonomyProviderCode !== undefined) patch.taxonomyId = taxonomyId;

    const saved = await this.deps.commandBus.run(
      makeUpdateTemplateCommand(templateId, patch, fields),
    );
    return { view: await this.decorate(saved.template), warnings };
  }

  async duplicate(templateId: string, name: string): Promise<TemplateView> {
    await this.getOrFail(templateId);
    await this.assertNameFree(name, null);
    const saved = await this.deps.commandBus.run(makeDuplicateTemplateCommand(templateId, name));
    return this.decorate(saved.template);
  }

  async delete(templateId: string, expectedVersion: number | null): Promise<void> {
    const template = await this.getOrFail(templateId);
    this.assertEditable(template);
    this.assertVersion(template, expectedVersion);

    // FR-010: the operator needs the list of feeds to go and fix, not a verdict.
    const feeds = await this.deps
      .emFactory()
      .find(ProductFeed, { feedTemplateId: templateId }, { orderBy: { name: 'asc' } });
    if (feeds.length > 0) {
      throw refuse(
        409,
        PRODUCT_FEED_ERROR_CODES.TEMPLATE_IN_USE,
        'This template is still used by a feed.',
        { feeds: feeds.map((feed) => ({ id: feed.id, name: feed.name })) },
      );
    }
    await this.deps.commandBus.run(makeDeleteTemplateCommand(templateId));
  }
}

/**
 * Postel on the way in (ux-design §3.6): an output name pasted out of a
 * provider's documentation routinely arrives with a stray newline or a double
 * space. Cleaning it beats rejecting it; the value is written verbatim into the
 * file, so it is cleaned once, here, rather than at every read.
 */
export function normalizeOutputName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}
