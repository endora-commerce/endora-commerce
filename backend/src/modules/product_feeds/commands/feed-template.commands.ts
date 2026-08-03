import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import type { Command, CommandContext } from '../../../commands/command.js';
import { HttpError } from '../../../http/error-envelope.js';
import { FeedTemplate } from '../entities/feed-template.entity.js';
import { FeedTemplateField } from '../entities/feed-template-field.entity.js';

/**
 * Feed Template Commands — feature 067 / FR-001, FR-006, FR-059, FR-068,
 * Principle XIII.
 *
 * The load-bearing decision here is that **the whole field list is one write**.
 * The structure editor lets an operator add, rename, reorder and remove fields
 * in a single session, so saving it as a burst of per-field writes would give
 * an auditor a dozen rows to reconstruct one human action, and would leave the
 * template momentarily invalid in between (two fields sharing an output name
 * mid-reorder, which the database's unique index refuses outright).
 *
 * So: one Command, one transaction, one audit entry, with a before/after pair
 * an operator can actually read — the field list is projected into the audit
 * state as an ordered array of plain objects rather than as entity ids.
 */

function envelope(): { eventId: string; occurredAt: string } {
  return { eventId: randomUUID(), occurredAt: new Date().toISOString() };
}

/** One field as the editor submits it; `sortOrder` is assigned by the caller. */
export interface TemplateFieldValues {
  outputName: string;
  sourceKind: FeedTemplateField['sourceKind'];
  sourceKey: string | null;
  constantValue: string | null;
  fallbackValue: string | null;
  providerRequired: boolean;
  transform: NonNullable<FeedTemplateField['transform']> | null;
  transformArg: string | null;
  helpKey: string | null;
  unbound: boolean;
}

export interface TemplateWriteValues {
  name: string;
  description: string | null;
  providerCode: FeedTemplate['providerCode'];
  outputFormat: FeedTemplate['outputFormat'];
  itemGranularity: FeedTemplate['itemGranularity'];
  taxonomyId: string | null;
}

export interface TemplateWithFields {
  template: FeedTemplate;
  fields: FeedTemplateField[];
}

/** The audit projection: everything an operator would want to compare, nothing else. */
function auditState(template: FeedTemplate, fields: FeedTemplateField[]): Record<string, unknown> {
  return {
    id: template.id,
    name: template.name,
    description: template.description ?? null,
    providerCode: template.providerCode,
    outputFormat: template.outputFormat,
    itemGranularity: template.itemGranularity,
    taxonomyId: template.taxonomyId ?? null,
    version: template.version,
    fields: [...fields]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((field) => ({
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
        unbound: field.unbound,
      })),
  };
}

async function loadFields(
  em: EntityManager,
  templateId: string,
): Promise<FeedTemplateField[]> {
  return em.find(
    FeedTemplateField,
    { feedTemplateId: templateId },
    { orderBy: { sortOrder: 'asc' } },
  );
}

/**
 * Writes the ordered field list, replacing whatever was there.
 *
 * The delete is flushed **before** the inserts: `(feed_template_id,
 * output_name)` is unique, and a rename that swaps two names would otherwise
 * collide against rows that are about to disappear.
 */
async function replaceFields(
  em: EntityManager,
  templateId: string,
  fields: TemplateFieldValues[],
): Promise<FeedTemplateField[]> {
  const existing = await em.find(FeedTemplateField, { feedTemplateId: templateId });
  if (existing.length > 0) {
    for (const row of existing) em.remove(row);
    await em.flush();
  }
  const created = fields.map((field, index) =>
    em.create(FeedTemplateField, {
      feedTemplateId: templateId,
      outputName: field.outputName,
      sourceKind: field.sourceKind,
      sourceKey: field.sourceKey,
      constantValue: field.constantValue,
      fallbackValue: field.fallbackValue,
      providerRequired: field.providerRequired,
      transform: field.transform,
      transformArg: field.transformArg,
      // Normalised server-side to `0..n-1` in submitted order, so the editor
      // never has to manage gaps and the saved order is the file order.
      sortOrder: index,
      helpKey: field.helpKey,
      unbound: field.unbound,
    }),
  );
  for (const row of created) em.persist(row);
  await em.flush();
  return created;
}

export function makeCreateTemplateCommand(
  values: TemplateWriteValues,
  fields: TemplateFieldValues[],
): Command<TemplateWithFields> {
  return {
    action: 'product_feeds.template.create',
    objectType: 'feed_template',
    objectId: 'pending',
    run: async ({ em }) => {
      const template = em.create(FeedTemplate, {
        name: values.name,
        description: values.description,
        providerCode: values.providerCode,
        outputFormat: values.outputFormat,
        itemGranularity: values.itemGranularity,
        taxonomyId: values.taxonomyId,
        isSystem: false,
      });
      // The parent row has to exist before its fields: the field table's
      // foreign key is checked per statement, and MikroORM batches inserts by
      // entity type in an order it chooses, not in persist order.
      await em.persistAndFlush(template);
      const saved = await replaceFields(em, template.id, fields);
      return {
        result: { template, fields: saved },
        after: auditState(template, saved),
      };
    },
    event: (result) => ({
      eventName: 'product_feeds.template_changed',
      payload: { ...envelope(), feedTemplateId: result.template.id },
    }),
  };
}

export function makeUpdateTemplateCommand(
  templateId: string,
  patch: Partial<TemplateWriteValues>,
  /** Omitted ⇒ the field list is left exactly as it is (a rename-only save). */
  fields: TemplateFieldValues[] | undefined,
): Command<TemplateWithFields> {
  return {
    action: 'product_feeds.template.update',
    objectType: 'feed_template',
    objectId: templateId,
    capture: async ({ em }) => {
      const template = await em.findOne(FeedTemplate, { id: templateId });
      return template ? auditState(template, await loadFields(em, templateId)) : null;
    },
    run: async ({ em }) => {
      const template = await em.findOne(FeedTemplate, { id: templateId, deletedAt: null });
      if (!template) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Feed template not found.');
      Object.assign(template, patch);
      template.version += 1;
      await em.persistAndFlush(template);
      const saved =
        fields === undefined
          ? await loadFields(em, templateId)
          : await replaceFields(em, templateId, fields);
      return { result: { template, fields: saved }, after: auditState(template, saved) };
    },
    event: (result) => ({
      eventName: 'product_feeds.template_changed',
      payload: { ...envelope(), feedTemplateId: result.template.id },
    }),
  };
}

/**
 * An independent, editable copy (FR-006). It deliberately copies the source's
 * fields **verbatim**, glosses included: a duplicate of a system template is
 * the common way into the editor, and re-validating it here would refuse a copy
 * of something the platform itself shipped.
 */
export function makeDuplicateTemplateCommand(
  sourceId: string,
  name: string,
): Command<TemplateWithFields> {
  return {
    action: 'product_feeds.template.duplicate',
    objectType: 'feed_template',
    objectId: sourceId,
    run: async ({ em }) => {
      const source = await em.findOne(FeedTemplate, { id: sourceId, deletedAt: null });
      if (!source) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Feed template not found.');
      const sourceFields = await loadFields(em, sourceId);

      const copy = em.create(FeedTemplate, {
        name,
        description: source.description ?? null,
        providerCode: source.providerCode,
        outputFormat: source.outputFormat,
        itemGranularity: source.itemGranularity,
        taxonomyId: source.taxonomyId ?? null,
        // A copy is never a system template, whatever it was copied from —
        // that is exactly what makes it editable (FR-008).
        isSystem: false,
        systemCode: null,
      });
      await em.persistAndFlush(copy);
      const saved = await replaceFields(
        em,
        copy.id,
        sourceFields.map((field) => ({
          outputName: field.outputName,
          sourceKind: field.sourceKind,
          sourceKey: field.sourceKey ?? null,
          constantValue: field.constantValue ?? null,
          fallbackValue: field.fallbackValue ?? null,
          providerRequired: field.providerRequired,
          transform: field.transform ?? null,
          transformArg: field.transformArg ?? null,
          helpKey: field.helpKey ?? null,
          unbound: field.unbound,
        })),
      );
      return { result: { template: copy, fields: saved }, after: auditState(copy, saved) };
    },
    event: (result) => ({
      eventName: 'product_feeds.template_changed',
      payload: { ...envelope(), feedTemplateId: result.template.id },
    }),
  };
}

/**
 * The whole import — template row, every field row and the collision
 * resolution — as **one** Command (FR-018).
 *
 * One Command means one transaction and one audit entry, so a malformed or
 * half-resolvable document leaves nothing behind, and an auditor reading the
 * trail sees "a file was imported" rather than a create followed by fifteen
 * field writes they have to reassemble.
 *
 * `replace` keeps the existing row's id on purpose: feeds reference a template
 * by id, so replacing in place is what lets an integrator ship a corrected
 * template without every feed having to be re-pointed by hand (FR-017).
 */
export type TemplateImportTarget =
  | { mode: 'create' }
  | { mode: 'replace'; templateId: string };

export function makeImportTemplateCommand(
  target: TemplateImportTarget,
  values: TemplateWriteValues,
  fields: TemplateFieldValues[],
): Command<TemplateWithFields> {
  // The audit row's `objectId` is fixed when the Command is constructed, so a
  // create has to know its id up front — otherwise the trail records a template
  // nobody can look up.
  const createdId = randomUUID();
  return {
    action: 'product_feeds.template.import',
    objectType: 'feed_template',
    objectId: target.mode === 'replace' ? target.templateId : createdId,
    // A create has no pre-state to capture; declaring the hook anyway would put
    // an always-null `stateBefore` on every imported template.
    ...(target.mode === 'replace'
      ? {
          capture: async ({ em }: CommandContext): Promise<Record<string, unknown> | null> => {
            const existing = await em.findOne(FeedTemplate, { id: target.templateId });
            return existing ? auditState(existing, await loadFields(em, target.templateId)) : null;
          },
        }
      : {}),
    run: async ({ em }) => {
      if (target.mode === 'replace') {
        const existing = await em.findOne(FeedTemplate, {
          id: target.templateId,
          deletedAt: null,
        });
        if (!existing) {
          throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Feed template not found.');
        }
        Object.assign(existing, values);
        existing.version += 1;
        await em.persistAndFlush(existing);
        const saved = await replaceFields(em, existing.id, fields);
        return { result: { template: existing, fields: saved }, after: auditState(existing, saved) };
      }

      const template = em.create(FeedTemplate, {
        id: createdId,
        name: values.name,
        description: values.description,
        providerCode: values.providerCode,
        outputFormat: values.outputFormat,
        itemGranularity: values.itemGranularity,
        taxonomyId: values.taxonomyId,
        // An imported template is an ordinary, editable one whatever it was on
        // the source installation: the reconciler owns `isSystem` rows here,
        // and an import must never plant one it would then fight over.
        isSystem: false,
        systemCode: null,
      });
      await em.persistAndFlush(template);
      const saved = await replaceFields(em, template.id, fields);
      return { result: { template, fields: saved }, after: auditState(template, saved) };
    },
    event: (result) => ({
      eventName: 'product_feeds.template_changed',
      payload: { ...envelope(), feedTemplateId: result.template.id },
    }),
  };
}

export function makeDeleteTemplateCommand(templateId: string): Command<{ id: string }> {
  return {
    action: 'product_feeds.template.delete',
    objectType: 'feed_template',
    objectId: templateId,
    capture: async ({ em }) => {
      const template = await em.findOne(FeedTemplate, { id: templateId });
      return template ? auditState(template, await loadFields(em, templateId)) : null;
    },
    run: async ({ em }) => {
      const template = await em.findOne(FeedTemplate, { id: templateId, deletedAt: null });
      if (!template) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Feed template not found.');
      // Soft delete: run history references the template by id, and an audit
      // trail that points at a vanished row explains nothing.
      template.deletedAt = new Date();
      await em.persistAndFlush(template);
      return { result: { id: templateId }, after: null };
    },
    event: () => ({
      eventName: 'product_feeds.template_changed',
      payload: { ...envelope(), feedTemplateId: templateId },
    }),
  };
}
