import { createHash } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, isUuidShape } from '@endora-commerce/contracts';
import type { AuditState, Command, CommandContext } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { DocumentTemplate } from '../entities/document-template.entity.js';

/**
 * The six writes of the document-template facility, each a Command run by
 * `CommandBus.run` (`specs/152-compare-pdf-template/data-model.md` §1 *Write
 * rules*, research R-13; Constitution XIII). One audit row per successful run,
 * none for a refusal: every check below throws before the first write, and a
 * throw rolls the transaction — and the audit row with it — back.
 *
 * The validation of *what* is written — whether the type is available, whether
 * the layout is valid for it, whether the channel exists — is the service's,
 * before a Command is built; what a Command checks is what only the row under
 * the transaction can answer: that it exists and is the version the operator
 * loaded (FR-006).
 *
 * The undo affordance is deliberately not offered (owner Q6: no version
 * history). Six Commands: the seventh of the first design, the invoice
 * template import, was withdrawn by owner answer P2.
 */

const OBJECT_TYPE = 'document_template';

type Content = DocumentTemplate['content'];

/** SHA-256 of a value's canonical JSON — keys sorted at every depth. */
function digest(value: unknown): string {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical);
    if (input !== null && typeof input === 'object') {
      return Object.fromEntries(
        Object.keys(input as Record<string, unknown>)
          .sort()
          .map((key) => [key, canonical((input as Record<string, unknown>)[key])]),
      );
    }
    return input;
  };
  return createHash('sha256').update(JSON.stringify(canonical(value)) ?? '').digest('hex');
}

/** The audit snapshot of a template (R-13): identity, scope, flags and per-language digests. */
export function auditStateOf(row: DocumentTemplate): AuditState {
  return {
    documentType: row.documentType,
    name: row.name,
    salesChannelId: row.salesChannelId ?? null,
    isDefault: row.isDefault,
    version: row.version,
    languages: Object.keys(row.content.languages),
    contentDigest: Object.fromEntries(
      Object.entries(row.content.languages).map(([language, tree]) => [language, digest(tree)]),
    ),
  };
}

function notFound(id: string): HttpError {
  return new HttpError(404, ERROR_CODES.DOCUMENT_TEMPLATE_NOT_FOUND, 'Document template not found.', { id });
}

async function loadVersioned(ctx: CommandContext, id: string, expectedVersion: number): Promise<DocumentTemplate> {
  if (!isUuidShape(id)) throw notFound(id);
  const row = await ctx.em.findOne(DocumentTemplate, { id });
  if (!row) throw notFound(id);
  if (row.version !== expectedVersion) {
    throw new HttpError(
      409,
      ERROR_CODES.VERSION_CONFLICT,
      'The template was changed by someone else since you opened it.',
      { id, expectedVersion, currentVersion: row.version },
    );
  }
  return row;
}

/**
 * Serialise every default change of one (type, scope) — two concurrent
 * set-defaults end with exactly one default rather than a unique-index error
 * for the second (FR-005). Transaction-scoped: released at commit or rollback.
 */
async function lockScope(em: EntityManager, documentType: string, salesChannelId: string | null): Promise<void> {
  await em.execute('select pg_advisory_xact_lock(hashtext(?))', [
    `document_templates:${documentType}:${salesChannelId ?? 'global'}`,
  ]);
}

/** Clear the scope's current default (other than `keepId`), flushed before anything is set. */
async function clearScopeDefault(
  em: EntityManager,
  documentType: string,
  salesChannelId: string | null,
  keepId: string | null,
): Promise<string | null> {
  const current = await em.findOne(DocumentTemplate, { documentType, salesChannelId, isDefault: true });
  if (!current || current.id === keepId) return null;
  current.isDefault = false;
  current.version += 1;
  // Flushed now: the unique index is not deferrable, so the old default must
  // be gone before the new one is written in this same transaction.
  await em.flush();
  return current.id;
}

export interface TemplateSummaryResult {
  readonly row: DocumentTemplate;
}

export function createTemplateCommand(input: {
  readonly id: string;
  readonly documentType: string;
  readonly name: string;
  readonly salesChannelId: string | null;
  readonly content: Content;
  readonly setDefault: boolean;
  readonly sourceTemplateId: string | null;
}): Command<TemplateSummaryResult> {
  return {
    action: 'document_template.create',
    objectType: OBJECT_TYPE,
    objectId: input.id,
    async run(ctx) {
      let previousDefault: string | null = null;
      if (input.setDefault) {
        await lockScope(ctx.em, input.documentType, input.salesChannelId);
        previousDefault = await clearScopeDefault(ctx.em, input.documentType, input.salesChannelId, null);
      }
      const now = new Date();
      const row = ctx.em.create(DocumentTemplate, {
        id: input.id,
        documentType: input.documentType,
        name: input.name,
        salesChannelId: input.salesChannelId,
        content: input.content,
        isDefault: input.setDefault,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
      ctx.em.persist(row);
      await ctx.em.flush();
      return {
        result: { row },
        after: {
          ...auditStateOf(row),
          sourceTemplateId: input.sourceTemplateId,
          ...(previousDefault ? { previousDefaultId: previousDefault } : {}),
        },
      };
    },
  };
}

export function renameTemplateCommand(input: {
  readonly id: string;
  readonly name: string;
  readonly expectedVersion: number;
}): Command<TemplateSummaryResult> {
  return {
    action: 'document_template.rename',
    objectType: OBJECT_TYPE,
    objectId: input.id,
    async run(ctx) {
      const row = await loadVersioned(ctx, input.id, input.expectedVersion);
      const before = auditStateOf(row);
      row.name = input.name;
      row.version += 1;
      await ctx.em.flush();
      return { result: { row }, before, after: auditStateOf(row) };
    },
  };
}

export function saveContentCommand(input: {
  readonly id: string;
  readonly language: string;
  readonly tree: unknown;
  readonly expectedVersion: number;
  /** Envelope limits, checked against the row under the transaction. */
  readonly assertEnvelope: (languages: Readonly<Record<string, unknown>>) => void;
}): Command<TemplateSummaryResult> {
  return {
    action: 'document_template.save_content',
    objectType: OBJECT_TYPE,
    objectId: input.id,
    async run(ctx) {
      const row = await loadVersioned(ctx, input.id, input.expectedVersion);
      const before = auditStateOf(row);
      const languages = { ...row.content.languages, [input.language]: input.tree };
      input.assertEnvelope(languages);
      row.content = { schemaVersion: 1, languages };
      row.version += 1;
      await ctx.em.flush();
      return { result: { row }, before, after: { ...auditStateOf(row), language: input.language } };
    },
  };
}

export function setDefaultCommand(input: {
  readonly id: string;
  readonly expectedVersion: number;
}): Command<TemplateSummaryResult> {
  return {
    action: 'document_template.set_default',
    objectType: OBJECT_TYPE,
    objectId: input.id,
    async run(ctx) {
      if (!isUuidShape(input.id)) throw notFound(input.id);
      const probe = await ctx.em.findOne(DocumentTemplate, { id: input.id });
      if (!probe) throw notFound(input.id);
      await lockScope(ctx.em, probe.documentType, probe.salesChannelId ?? null);
      // Re-read under the lock: a concurrent set-default may have committed.
      await ctx.em.refresh(probe);
      const row = await loadVersioned(ctx, input.id, input.expectedVersion);
      const before = auditStateOf(row);
      if (row.isDefault) return { result: { row }, skipAudit: true };
      const previousDefault = await clearScopeDefault(ctx.em, row.documentType, row.salesChannelId ?? null, row.id);
      row.isDefault = true;
      row.version += 1;
      await ctx.em.flush();
      return {
        result: { row },
        before,
        after: { ...auditStateOf(row), ...(previousDefault ? { previousDefaultId: previousDefault } : {}) },
      };
    },
  };
}

export function clearDefaultCommand(input: {
  readonly id: string;
  readonly expectedVersion: number;
}): Command<TemplateSummaryResult> {
  return {
    action: 'document_template.clear_default',
    objectType: OBJECT_TYPE,
    objectId: input.id,
    async run(ctx) {
      const row = await loadVersioned(ctx, input.id, input.expectedVersion);
      const before = auditStateOf(row);
      if (!row.isDefault) return { result: { row }, skipAudit: true };
      row.isDefault = false;
      row.version += 1;
      await ctx.em.flush();
      return { result: { row }, before, after: auditStateOf(row) };
    },
  };
}

export function deleteTemplateCommand(input: {
  readonly id: string;
  readonly expectedVersion: number;
  readonly confirmDefault: boolean;
}): Command<{ readonly id: string }> {
  return {
    action: 'document_template.delete',
    objectType: OBJECT_TYPE,
    objectId: input.id,
    async run(ctx) {
      const row = await loadVersioned(ctx, input.id, input.expectedVersion);
      if (row.isDefault && !input.confirmDefault) {
        throw new HttpError(
          409,
          ERROR_CODES.DOCUMENT_TEMPLATE_IS_DEFAULT,
          'This template is the default of its scope; confirm to delete it.',
          { id: input.id },
        );
      }
      const before = auditStateOf(row);
      ctx.em.remove(row);
      await ctx.em.flush();
      return { result: { id: input.id }, before, after: null };
    },
  };
}
