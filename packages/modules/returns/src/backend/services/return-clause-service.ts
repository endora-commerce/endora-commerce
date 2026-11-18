import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  LANGUAGE_FALLBACK,
  isUuidShape,
  type CreateReturnCaseClauseRequest,
  type ReturnCaseClauseDto,
  type ReturnFormClause,
  type ShownClause,
  type UpdateReturnCaseClauseRequest,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { ReturnCaseClause } from '../entities/return-case-clause.entity.js';
import type { CaseClauseCheck } from './return-case-service.js';

/**
 * The clauses of the returns form (`specs/180-off-platform-complaints/` FR-B30 – FR-B32,
 * D-1, research R-14).
 *
 * One selection, {@link selectClauses}, answers both the form (`form-config`) and the
 * acceptance check at filing, so the two cannot disagree: the active clauses of the
 * channel and the channel-less ones whose `appliesTo` matches the kind, by weight — and
 * **never a `must_accept` clause on a consumer's withdrawal** (D-1). A submission sends
 * the `(id, revision)` of every clause it rendered and of the `must_accept` ones ticked;
 * anything else is refused, so what the case stores is provably what was shown. Every
 * configuration write is a Command, audited without the text or the link (D-288).
 */

export type ClauseRow = Pick<
  ReturnCaseClause,
  'id' | 'label' | 'text' | 'linkUrl' | 'appliesTo' | 'mode' | 'salesChannelId' | 'weight' | 'isActive' | 'revision'
>;

export interface ClauseSelection {
  readonly salesChannelId: string;
  readonly kind: 'return' | 'complaint';
  /** A consumer's withdrawal is never gated by a clause (D-1). */
  readonly consumerWithdrawal: boolean;
}

export function selectClauses<T extends ClauseRow>(rows: readonly T[], input: ClauseSelection): T[] {
  return rows
    .filter((c) => c.isActive)
    .filter((c) => c.salesChannelId == null || c.salesChannelId === input.salesChannelId)
    .filter((c) => c.appliesTo === 'both' || c.appliesTo === input.kind)
    .filter((c) => !(input.consumerWithdrawal && c.mode === 'must_accept'))
    .sort((a, b) => a.weight - b.weight || a.id.localeCompare(b.id));
}

/** A per-language value in `language`, else the default language, else the first. */
function pick(values: Record<string, string> | null | undefined, language: string): string | null {
  if (!values) return null;
  return values[language] ?? values[LANGUAGE_FALLBACK] ?? Object.values(values)[0] ?? null;
}

/** A clause as shown in `language` — the copy a case stores (FR-B31). */
export function clauseIn(row: ClauseRow, language: string): ShownClause {
  return {
    clauseId: row.id,
    revision: row.revision,
    mode: row.mode,
    language,
    label: pick(row.label, language) ?? '',
    text: pick(row.text, language) ?? '',
    linkUrl: pick(row.linkUrl, language),
  };
}

export interface ReturnClauseServiceDeps {
  emFactory: () => EntityManager;
  commandBus: Pick<CommandBus, 'run'>;
}

export class ReturnClauseService implements CaseClauseCheck {
  constructor(private readonly deps: ReturnClauseServiceDeps) {}

  async list(): Promise<ReturnCaseClauseDto[]> {
    const rows = await this.deps.emFactory().find(ReturnCaseClause, {}, { orderBy: { weight: 'asc', createdAt: 'asc' } });
    return rows.map(toDto);
  }

  /** The clauses a submission shows (D-1). */
  async clausesFor(input: ClauseSelection): Promise<ReturnCaseClause[]> {
    const rows = await this.deps.emFactory().find(ReturnCaseClause, { isActive: true });
    return selectClauses(rows, input);
  }

  /** The form's clauses, in the request language (customer-api.md §C1). */
  async forForm(input: ClauseSelection & { language: string }): Promise<ReturnFormClause[]> {
    return (await this.clausesFor(input)).map((row) => {
      const shown = clauseIn(row, input.language);
      return { id: row.id, revision: row.revision, mode: row.mode, label: shown.label, text: shown.text, linkUrl: shown.linkUrl };
    });
  }

  /**
   * The acceptance check of a filing (FR-B31, research R-14): the clauses shown must be
   * exactly {@link clausesFor}'s, and the ones accepted exactly its `must_accept` ones.
   * Answers the copy the case stores.
   */
  async verify(input: {
    salesChannelId: string;
    kind: 'return' | 'complaint';
    consumerWithdrawal: boolean;
    shown: ReadonlyArray<{ id: string; revision: number }> | undefined;
    accepted: ReadonlyArray<{ id: string; revision: number }> | undefined;
    language: string;
  }): Promise<ShownClause[]> {
    const expected = await this.clausesFor(input);
    const key = (c: { id: string; revision: number }): string => `${c.id}@${c.revision}`;
    const expectedKeys = new Set(expected.map(key));
    const shown = new Set((input.shown ?? []).map(key));
    const changed = [...new Set([...expectedKeys].filter((k) => !shown.has(k)).concat([...shown].filter((k) => !expectedKeys.has(k))))];
    if (changed.length > 0) throw notAccepted('clauses_changed', changed);
    const mustAccept = new Set(expected.filter((c) => c.mode === 'must_accept').map(key));
    const accepted = new Set((input.accepted ?? []).map(key));
    const extra = [...accepted].filter((k) => !mustAccept.has(k));
    if (extra.length > 0) throw notAccepted('clauses_changed', extra);
    const missing = [...mustAccept].filter((k) => !accepted.has(k));
    if (missing.length > 0) throw notAccepted('clause_not_accepted', missing);
    return expected.map((row) => clauseIn(row, input.language));
  }

  async create(body: CreateReturnCaseClauseRequest): Promise<ReturnCaseClauseDto> {
    assertDefaultLanguage(body.label, body.text);
    // Built before the Command so its id is the audit entry's object.
    const draft = Object.assign(new ReturnCaseClause(), {
      label: body.label,
      text: body.text,
      linkUrl: body.linkUrl ?? null,
      appliesTo: body.appliesTo ?? 'both',
      mode: body.mode ?? 'must_accept',
      salesChannelId: body.salesChannelId ?? null,
      weight: body.weight ?? 100,
      isActive: body.isActive ?? true,
    });
    return this.deps.commandBus.run<ReturnCaseClauseDto>({
      action: 'return_case_clause.create',
      objectType: 'return_case_clause',
      objectId: draft.id,
      run: async ({ em }) => {
        em.persist(draft);
        await em.flush();
        return { result: toDto(draft), before: null, after: auditOf(draft) };
      },
    });
  }

  async update(id: string, body: UpdateReturnCaseClauseRequest): Promise<ReturnCaseClauseDto> {
    if (!isUuidShape(id)) throw notFound();
    return this.deps.commandBus.run<ReturnCaseClauseDto>({
      action: 'return_case_clause.update',
      objectType: 'return_case_clause',
      objectId: id,
      run: async ({ em }) => {
        const row = await em.findOne(ReturnCaseClause, { id });
        if (!row) throw notFound();
        const before = auditOf(row);
        const label = body.label ?? row.label;
        const text = body.text ?? row.text;
        assertDefaultLanguage(label, text);
        // What a customer reads changed: a new revision (research R-14).
        const read =
          (body.label !== undefined && JSON.stringify(body.label) !== JSON.stringify(row.label)) ||
          (body.text !== undefined && JSON.stringify(body.text) !== JSON.stringify(row.text)) ||
          (body.linkUrl !== undefined && JSON.stringify(body.linkUrl) !== JSON.stringify(row.linkUrl ?? null)) ||
          (body.appliesTo !== undefined && body.appliesTo !== row.appliesTo) ||
          (body.mode !== undefined && body.mode !== row.mode);
        row.label = label;
        row.text = text;
        if (body.linkUrl !== undefined) row.linkUrl = body.linkUrl;
        if (body.appliesTo !== undefined) row.appliesTo = body.appliesTo;
        if (body.mode !== undefined) row.mode = body.mode;
        if (body.salesChannelId !== undefined) row.salesChannelId = body.salesChannelId;
        if (body.weight !== undefined) row.weight = body.weight;
        if (body.isActive !== undefined) row.isActive = body.isActive;
        if (read) row.revision += 1;
        await em.flush();
        return { result: toDto(row), before, after: auditOf(row) };
      },
    });
  }

  async remove(id: string): Promise<void> {
    if (!isUuidShape(id)) throw notFound();
    await this.deps.commandBus.run<void>({
      action: 'return_case_clause.delete',
      objectType: 'return_case_clause',
      objectId: id,
      run: async ({ em }) => {
        const row = await em.findOne(ReturnCaseClause, { id });
        if (!row) throw notFound();
        const before = auditOf(row);
        // A case keeps its own copy: deleting the clause changes no case (FR-B32).
        await em.remove(row).flush();
        return { result: undefined, before, after: null };
      },
    });
  }
}

function toDto(row: ReturnCaseClause): ReturnCaseClauseDto {
  return {
    id: row.id,
    label: row.label,
    text: row.text,
    linkUrl: row.linkUrl ?? null,
    appliesTo: row.appliesTo,
    mode: row.mode,
    salesChannelId: row.salesChannelId ?? null,
    weight: row.weight,
    isActive: row.isActive,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** What a clause's audit entry records: never the text or the link (D-288). */
function auditOf(row: ReturnCaseClause): Record<string, unknown> {
  return {
    salesChannelId: row.salesChannelId ?? null,
    appliesTo: row.appliesTo,
    mode: row.mode,
    hasLink: Boolean(row.linkUrl && Object.keys(row.linkUrl).length > 0),
    weight: row.weight,
    isActive: row.isActive,
    revision: row.revision,
    languages: Object.keys(row.text).sort(),
  };
}

function assertDefaultLanguage(label: Record<string, string>, text: Record<string, string>): void {
  if (!label[LANGUAGE_FALLBACK] || !text[LANGUAGE_FALLBACK]) {
    throw new HttpError(
      422,
      ERROR_CODES.VALIDATION_FAILED,
      `A clause needs its label and text in the default language (${LANGUAGE_FALLBACK}).`,
      { code: 'default_language_required', language: LANGUAGE_FALLBACK },
    );
  }
}

function notFound(): HttpError {
  return new HttpError(404, ERROR_CODES.NOT_FOUND, 'Clause not found.');
}

function notAccepted(reason: 'clause_not_accepted' | 'clauses_changed', keys: string[]): HttpError {
  return new HttpError(
    422,
    ERROR_CODES.RETURN_CLAUSES_NOT_ACCEPTED,
    reason === 'clause_not_accepted'
      ? 'Accept the terms shown before submitting.'
      : 'The terms changed while you were filling in the form. Review them and submit again.',
    { reason, clauseIds: keys.map((k) => k.split('@')[0]!) },
  );
}
