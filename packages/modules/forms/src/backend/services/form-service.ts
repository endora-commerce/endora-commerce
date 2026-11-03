import { UniqueConstraintViolationException } from '@mikro-orm/core';
import {
  ERROR_CODES,
  type FormCreateBody,
  type FormDetail,
  type FormLanguagesResponse,
  type FormNotificationsBody,
  type FormStatus,
  type FormSummary,
  type FormUpdateBody,
} from '@endora-commerce/contracts';
import type { CommandBus, CommandContext } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { Form } from '../entities/form.entity.js';
import { FormEntry } from '../entities/form-entry.entity.js';
import { FormVersion } from '../entities/form-version.entity.js';
import {
  createFormCommand,
  deleteFormCommand,
  duplicateFormCommand,
  moveFormCommand,
  publishFormCommand,
  updateFormCommand,
  updateRecipientsCommand,
  updateRetentionCommand,
} from './form-commands.js';
import { publicFormDefinition } from './form-public-read.js';
import { formWarnings, isCaptchaConfigured, storefrontLanguages } from './form-warnings.js';
import { formKeyTaken, formNotFound } from './forms-errors.js';
import type { FormsEnvironment, FormsEnvironmentReader } from './forms-environment.js';
import type { RetentionService } from './retention-service.js';

type Em = CommandContext['em'];

export interface FormServiceDeps {
  readonly emFactory: () => Em;
  readonly commandBus: CommandBus;
  readonly environment: FormsEnvironmentReader;
  /** How many entries a retention period would delete (User Story 9). */
  readonly retention: Pick<RetentionService, 'impact'>;
  /** "Now", for availability; a clock in tests. */
  readonly now?: () => Date;
}

export interface FormListQuery {
  readonly status?: FormStatus | undefined;
  readonly q?: string | undefined;
  readonly page: number;
  readonly pageSize: number;
}

export interface FormPreviewQuery {
  readonly language?: string | undefined;
  readonly source: 'working' | 'published';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A malformed id is answered as a missing form: 404 `FORM_NOT_FOUND`, the same body. */
function assertUuid(id: string): void {
  if (!UUID.test(id)) throw formNotFound();
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * The forms of the admin API (`specs/170-forms-module/` contracts/admin-api.md §1): reads answer
 * the contracts' shapes, every write is a Command of `form-commands.ts` (Constitution XIII) and
 * answers the form as it is afterwards.
 *
 * `entryCount` is counted through the tenancy guard, so a scoped administrator sees how many of the
 * form's entries are theirs to see (FR-046); `warnings` are derived per read (FR-018).
 */
export class FormService {
  constructor(private readonly deps: FormServiceDeps) {}

  #now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** `GET /forms/languages` — the storefront languages and the system default's. */
  async languages(): Promise<FormLanguagesResponse> {
    return languagesOf(await this.deps.environment());
  }

  /** `GET /forms` — newest change first, filtered by status and by name or key. */
  async list(query: FormListQuery): Promise<{ items: FormSummary[]; total: number }> {
    const em = this.deps.emFactory();
    const where: Record<string, unknown> = {};
    if (query.status) where['status'] = query.status;
    if (query.q) {
      const pattern = `%${escapeLike(query.q)}%`;
      where['$or'] = [{ name: { $ilike: pattern } }, { key: { $ilike: pattern } }];
    }
    const [forms, total] = await em.findAndCount(Form, where, {
      orderBy: { updatedAt: 'desc', id: 'asc' },
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    });
    const environment = await this.deps.environment();
    const versionIds = forms.map((form) => form.publishedVersionId).filter((id): id is string => id !== null);
    const versions = versionIds.length > 0 ? await em.find(FormVersion, { id: { $in: versionIds } }) : [];
    const versionById = new Map(versions.map((version) => [version.id, version]));
    const items = await Promise.all(
      forms.map(async (form) =>
        this.#summary(
          form,
          await em.count(FormEntry, { formId: form.id }),
          form.publishedVersionId ? (versionById.get(form.publishedVersionId) ?? null) : null,
          environment,
        ),
      ),
    );
    return { items, total };
  }

  /** `GET /forms/:id`. */
  async get(id: string): Promise<FormDetail> {
    assertUuid(id);
    const em = this.deps.emFactory();
    const form = await em.findOne(Form, { id });
    if (!form) throw formNotFound();
    const version = form.publishedVersionId ? await em.findOne(FormVersion, { id: form.publishedVersionId }) : null;
    const entryCount = await em.count(FormEntry, { formId: id });
    const summary = this.#summary(form, entryCount, version, await this.deps.environment());
    return {
      ...summary,
      definition: form.definition,
      recipients: [...form.recipients],
      channelRecipients: structuredClone(form.channelRecipients),
      retentionDays: form.retentionDays ?? null,
      revision: form.revision,
      publishedDefinition: version?.definition ?? null,
    };
  }

  /** `POST /forms` — a draft (US1-1). */
  async create(body: FormCreateBody): Promise<FormDetail> {
    await this.#assertStorefrontLanguage(body.defaultLanguage);
    const id = await this.#keyed(body.key ?? '', () => this.deps.commandBus.run(createFormCommand(body)));
    return this.get(id);
  }

  /** `PUT /forms/:id` — the working copy and the live identity, shape-validated only (FR-011). */
  async update(id: string, body: FormUpdateBody): Promise<FormDetail> {
    assertUuid(id);
    if (body.defaultLanguage !== undefined) await this.#assertStorefrontLanguage(body.defaultLanguage);
    const { expectedRevision, ...changes } = body;
    await this.#keyed(body.key ?? '', () => this.deps.commandBus.run(updateFormCommand(id, expectedRevision, changes)));
    return this.get(id);
  }

  /** `PUT /forms/:id/notifications` — the recipients, live (FR-056). */
  async updateNotifications(id: string, body: FormNotificationsBody): Promise<FormDetail> {
    assertUuid(id);
    const { expectedRevision, ...recipients } = body;
    await this.deps.commandBus.run(updateRecipientsCommand(id, expectedRevision, recipients));
    return this.get(id);
  }

  /** `PUT /forms/:id/retention` — the period, live (FR-054); unrestricted administrators only. */
  async updateRetention(id: string, expectedRevision: number, retentionDays: number | null): Promise<FormDetail> {
    assertUuid(id);
    await this.deps.commandBus.run(updateRetentionCommand(id, expectedRevision, retentionDays));
    return this.get(id);
  }

  /** `GET /forms/:id/retention-impact?days=` — counted in the caller's scope. */
  async retentionImpact(id: string, days: number): Promise<{ entriesToDelete: number }> {
    await this.#existing(id);
    return { entriesToDelete: await this.deps.retention.impact(id, days, this.#now()) };
  }

  /** `POST /forms/:id/publish` — the next version, or 400 `FORM_DEFINITION_INVALID`. */
  async publish(id: string, expectedRevision: number): Promise<FormDetail> {
    assertUuid(id);
    await this.deps.commandBus.run(publishFormCommand(id, expectedRevision));
    return this.get(id);
  }

  /** `POST /forms/:id/close` and `/reopen` (US1-7). */
  async move(id: string, expectedRevision: number, to: 'closed' | 'published'): Promise<FormDetail> {
    assertUuid(id);
    await this.deps.commandBus.run(moveFormCommand(id, expectedRevision, to));
    return this.get(id);
  }

  /** `POST /forms/:id/duplicate` — a new draft (FR-014). */
  async duplicate(id: string, name: string | undefined): Promise<FormDetail> {
    assertUuid(id);
    const copyId = await this.#keyed('', () => this.deps.commandBus.run(duplicateFormCommand(id, name)));
    return this.get(copyId);
  }

  /** `DELETE /forms/:id` (FR-013): with entries only when confirmed, and only by an unrestricted admin. */
  async delete(id: string, expectedRevision: number, confirmEntriesDeletion = false): Promise<void> {
    assertUuid(id);
    await this.deps.commandBus.run(deleteFormCommand(id, expectedRevision, confirmEntriesDeletion));
  }

  /** `GET /forms/:id/versions` — newest first. */
  async versions(id: string): Promise<{ items: { number: number; publishedAt: string; publishedByAdminUserId: string | null }[] }> {
    await this.#existing(id);
    const versions = await this.deps.emFactory().find(FormVersion, { formId: id }, { orderBy: { number: 'desc' } });
    return {
      items: versions.map((version) => ({
        number: version.number,
        publishedAt: version.publishedAt.toISOString(),
        publishedByAdminUserId: version.publishedByAdminUserId ?? null,
      })),
    };
  }

  /** `GET /forms/:id/versions/:number` — 404 `FORM_NOT_FOUND` for a number never published. */
  async version(
    id: string,
    number: number,
  ): Promise<{ number: number; definition: FormVersion['definition']; defaultLanguage: string; publishedAt: string }> {
    await this.#existing(id);
    const version = await this.deps.emFactory().findOne(FormVersion, { formId: id, number });
    if (!version) throw formNotFound();
    return {
      number: version.number,
      definition: version.definition,
      defaultLanguage: version.defaultLanguage,
      publishedAt: version.publishedAt.toISOString(),
    };
  }

  /**
   * `GET /forms/:id/preview` — the public read of the working copy or of the served version, with
   * the form's status (FR-017). The working copy of a draft is laid out as if it were published.
   */
  async preview(id: string, query: FormPreviewQuery) {
    assertUuid(id);
    const em = this.deps.emFactory();
    const form = await em.findOne(Form, { id });
    if (!form) throw formNotFound();
    const environment = await this.deps.environment();
    let version: { number: number; definition: Form['definition']; defaultLanguage: string } | null;
    if (query.source === 'working') {
      version = { number: form.publishedVersionNumber + 1, definition: form.definition, defaultLanguage: form.defaultLanguage };
    } else {
      const served = form.publishedVersionId ? await em.findOne(FormVersion, { id: form.publishedVersionId }) : null;
      version = served ? { number: served.number, definition: served.definition, defaultLanguage: served.defaultLanguage } : null;
    }
    const captcha = environment.captcha;
    const read = publicFormDefinition(
      { formId: form.id, key: form.key, status: form.status, version, acceptedEntryCount: form.acceptedEntryCount },
      form.id,
      {
        language: query.language ?? version?.defaultLanguage ?? form.defaultLanguage,
        now: this.#now(),
        captcha:
          isCaptchaConfigured(captcha) && (captcha.provider === 'turnstile' || captcha.provider === 'hcaptcha')
            ? { provider: captcha.provider, siteKey: captcha.siteKey }
            : null,
        preview: query.source === 'working',
      },
    );
    return { ...read, status: form.status };
  }

  #summary(form: Form, entryCount: number, version: FormVersion | null, environment: FormsEnvironment): FormSummary {
    return {
      id: form.id,
      key: form.key,
      name: form.name,
      status: form.status,
      defaultLanguage: form.defaultLanguage,
      publishedVersionNumber: form.publishedVersionNumber,
      entryCount,
      updatedAt: form.updatedAt.toISOString(),
      warnings: formWarnings(
        {
          definition: form.definition,
          publishedDefinition: version?.definition ?? null,
          defaultLanguage: form.defaultLanguage,
          recipients: form.recipients,
          channelRecipients: form.channelRecipients,
        },
        { channels: environment.channels, captchaConfigured: isCaptchaConfigured(environment.captcha) },
      ),
    };
  }

  async #existing(id: string): Promise<void> {
    assertUuid(id);
    const found = await this.deps.emFactory().count(Form, { id });
    if (found === 0) throw formNotFound();
  }

  /** A default language must be one a storefront serves (data-model §1). */
  async #assertStorefrontLanguage(language: string): Promise<void> {
    const { languages } = languagesOf(await this.deps.environment());
    if (!languages.includes(language)) {
      throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, `No active storefront serves the language "${language}".`, {
        field: 'defaultLanguage',
        languages,
      });
    }
  }

  /** Two writers of one key: the unique index refused the second — the contract's 409. */
  async #keyed<T>(key: string, write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (error instanceof UniqueConstraintViolationException) throw formKeyTaken(key);
      throw error;
    }
  }
}

/** The storefront languages; the system default's default language first in mind. */
export function languagesOf(environment: FormsEnvironment): FormLanguagesResponse {
  const languages = storefrontLanguages(environment.channels);
  const systemDefault = environment.channels.find((channel) => channel.systemDefault) ?? environment.channels[0];
  const defaultLanguage =
    systemDefault && languages.includes(systemDefault.defaultLanguage) ? systemDefault.defaultLanguage : languages[0];
  if (defaultLanguage === undefined) {
    // No active channel: nothing is served, and a form needs a language a storefront serves.
    throw new HttpError(409, ERROR_CODES.VALIDATION_FAILED, 'No active sales channel serves a language.');
  }
  return { languages, defaultLanguage };
}
