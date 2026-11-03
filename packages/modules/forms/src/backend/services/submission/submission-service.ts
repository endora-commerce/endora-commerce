import {
  DictionaryReferenceError,
  resolveTexts,
  supportedLanguageOf,
  searchTextOf,
  sharedAnswers,
  validateSubmission,
  type AnswerValue,
  type FormConsentRecord,
  type FormDefinition,
  type FormFieldErrorCode,
  type FormSubmitBody,
  type FormSubmitResponse,
  type PublicFormDefinition,
} from '@endora-commerce/contracts';
import type { CommandBus, CommandContext } from '@endora-commerce/platform/commands';
import { Form } from '../../entities/form.entity.js';
import { FormVersion } from '../../entities/form-version.entity.js';
import { confirmationPagePath, publicFormDefinition } from '../form-public-read.js';
import { isCaptchaConfigured } from '../form-warnings.js';
import type { FormsEnvironmentReader } from '../forms-environment.js';
import { formNotAccepting, formSubmissionInvalid } from '../forms-errors.js';
import type { FormsPorts } from '../forms-ports.js';
import { submissionAvailability } from './availability.js';
import type { CaptchaVerifier } from './captcha-verifier.js';
import { isSignedInCustomer, resolveEntryOwner, type SubmissionActor } from './attribution.js';
import { submitEntryCommand } from './entry-commands.js';
import { isHoneypotHit } from './honeypot.js';

/**
 * The public side of a form (`specs/170-forms-module/` contracts/public-api.md §1–§2): its
 * definition as a shopper reads it, and the submission pipeline of research R-12.
 *
 * | Step | Here |
 * | --- | --- |
 * | 1 body limit, rate limit | the route (`routes.public.ts`) |
 * | 2 channel and language | the route resolves the channel (fail closed, FR-035); {@link resolveLanguage} |
 * | 3 form, version, availability | {@link submissionAvailability} → 409 `FORM_NOT_ACCEPTING` |
 * | 4 honeypot | {@link isHoneypotHit} → the accepted answer, nothing stored, sent or published |
 * | 5 validation | `validateSubmission`, countries checked by `dictionaries` → 400 `FORM_SUBMISSION_INVALID` |
 * | 6 CAPTCHA | {@link CaptchaVerifier}, when the version requires it — after validation, so a mistyped answer never burns a token → 400 `FORM_CAPTCHA_FAILED` / 503 `FORM_CAPTCHA_UNAVAILABLE` |
 * | 7 attribution | {@link resolveEntryOwner} |
 * | 8 the write | the Command `forms.entry.submit` |
 * | 9 the answer | `201 { status: 'accepted', confirmation }` |
 *
 * No refused submission stores, sends or publishes anything (FR-034): every refusal is thrown
 * before the Command, or rolls it back.
 */

type Em = CommandContext['em'];

/** The request's resolved sales channel (the platform's resolver — never re-parsed here). */
export interface SubmissionChannel {
  readonly id: string;
  readonly languages: readonly string[];
  readonly defaultLanguage: string;
}

export interface PublicRequest {
  readonly channel: SubmissionChannel;
  /** `?language=`, when the client named one. */
  readonly language?: string | undefined;
  /** The `Accept-Language` header. */
  readonly acceptLanguage?: string | undefined;
}

export interface SubmissionRequest extends PublicRequest {
  /** `request.actor` as the auth hook decorated it. */
  readonly actor: SubmissionActor | undefined;
  /** The client address as the platform resolved it (`request.ip`), sent to the CAPTCHA provider. */
  readonly remoteIp?: string | undefined;
}

export interface PublicFormServiceDeps {
  readonly emFactory: () => Em;
  readonly commandBus: CommandBus;
  readonly ports: FormsPorts;
  readonly environment: FormsEnvironmentReader;
  /** The CAPTCHA check of step 6; it reads the settings itself, per call. */
  readonly captcha: Pick<CaptchaVerifier, 'verify'>;
  /** "Now", for availability; a clock in tests. */
  readonly now?: () => Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether `id` is a well-formed form id (the routes answer `400` otherwise). */
export function isFormId(id: string): boolean {
  return UUID.test(id);
}

/**
 * The language a public read or a submission is in (research R-12 step 2): the one the client
 * named, else the first of `Accept-Language` the channel serves, else the channel's default — never
 * a language the channel does not serve.
 */
export function resolveLanguage(channel: SubmissionChannel, request: Omit<PublicRequest, 'channel'>): string {
  const served = new Map(channel.languages.map((language) => [language.toLowerCase(), language]));
  const candidates = [
    ...(request.language ? [request.language] : []),
    ...(request.acceptLanguage ?? '')
      .split(',')
      .map((part) => part.split(';')[0]!.trim())
      .filter((tag) => tag !== '' && tag !== '*'),
  ];
  for (const candidate of candidates) {
    const match = served.get(candidate.toLowerCase());
    if (match) return match;
  }
  return channel.defaultLanguage;
}

/** A form and the version it serves, read for one request. */
interface Served {
  readonly form: Form;
  readonly version: FormVersion | null;
}

export class PublicFormService {
  constructor(private readonly deps: PublicFormServiceDeps) {}

  #now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  async #served(formId: string): Promise<Served | null> {
    const em = this.deps.emFactory();
    const form = await em.findOne(Form, { id: formId });
    if (!form) return null;
    const version = form.publishedVersionId ? await em.findOne(FormVersion, { id: form.publishedVersionId }) : null;
    return { form, version };
  }

  /**
   * `GET /api/v1/storefront/forms/:formId` — the public read (§1). Uncached here: every API
   * instance reads the database, and the storefront's Data Cache holds it by tag (research R-21).
   */
  async read(formId: string, request: PublicRequest): Promise<PublicFormDefinition> {
    const served = await this.#served(formId);
    const language = resolveLanguage(request.channel, request);
    const environment = await this.deps.environment();
    const captcha = environment.captcha;
    const version = served?.version ?? null;
    const confirmationPath =
      served && version && served.form.status !== 'draft'
        ? await confirmationPagePath(
            version.definition.behaviour.confirmation,
            { salesChannelId: request.channel.id, language },
            this.deps.ports,
          )
        : null;
    return publicFormDefinition(
      served
        ? {
            formId: served.form.id,
            key: served.form.key,
            status: served.form.status,
            version: version
              ? { number: version.number, definition: version.definition, defaultLanguage: version.defaultLanguage }
              : null,
            acceptedEntryCount: served.form.acceptedEntryCount,
          }
        : null,
      formId,
      {
        language,
        now: this.#now(),
        captcha:
          isCaptchaConfigured(captcha) && (captcha.provider === 'turnstile' || captcha.provider === 'hcaptcha')
            ? { provider: captcha.provider, siteKey: captcha.siteKey }
            : null,
        confirmationPagePath: confirmationPath,
      },
    );
  }

  /** `POST /api/v1/storefront/forms/:formId/entries` — the pipeline of the class comment (§2). */
  async submit(formId: string, body: FormSubmitBody, request: SubmissionRequest): Promise<FormSubmitResponse> {
    // Step 2 — the channel is the route's; the language is constrained to it.
    const language = resolveLanguage(request.channel, request);

    // Step 3 — the form, its served version and whether it takes a submission now.
    const served = await this.#served(formId);
    const version = served?.version ?? null;
    const availability = submissionAvailability(
      served && version
        ? {
            status: served.form.status,
            hasPublishedVersion: true,
            restrictions: version.definition.restrictions,
            acceptedEntryCount: served.form.acceptedEntryCount,
            signedIn: isSignedInCustomer(request.actor),
            now: this.#now(),
          }
        : null,
    );
    if (!availability.accepting) throw formNotAccepting(availability.reason);
    const { form } = served!;
    const definition = version!.definition;
    const text = resolveTexts(definition, language, version!.defaultLanguage);
    const answer = async (): Promise<FormSubmitResponse> => ({
      status: 'accepted',
      confirmation: await this.#confirmation(definition, text, { salesChannelId: request.channel.id, language }),
    });

    // Step 4 — a bot filled the honeypot: answered as accepted, and nothing else happens (FR-040).
    if (isHoneypotHit(body)) return answer();

    // Step 5 — the values against the served version (FR-034): hidden and unknown values dropped,
    // every rule of the version applied, a country checked against the dictionary.
    const countries = await this.#knownCountries(definition, body.values);
    const validated = validateSubmission(definition, body.values, { isKnownCountry: (code) => countries.has(code) });
    if (!validated.ok) throw formSubmissionInvalid(await this.#fieldMessages(definition, validated.errors, text, language));

    // Step 6 — CAPTCHA, only after the answers passed (R-12): a single-use token is spent on a
    // submission that can be taken. Unconfigured, the form is taken unchecked (US6-4, warned).
    if (definition.behaviour.captchaRequired) {
      await this.deps.captcha.verify({ token: body.captchaToken, remoteIp: request.remoteIp });
    }

    // Step 7 — the owner, from the session only (FR-045).
    const owner = await resolveEntryOwner(request.actor, this.deps.ports.customerAccounts);

    // Step 8 — the write, its audit row and its event.
    await this.deps.commandBus.run(
      submitEntryCommand({
        formId: form.id,
        formKey: form.key,
        versionId: version!.id,
        versionNumber: version!.number,
        maxEntries: definition.restrictions.maxEntries,
        salesChannelId: request.channel.id,
        language,
        pageUrl: body.pageUrl ?? null,
        answers: validated.answers,
        consents: consentRecords(definition, validated.consents, text),
        submitterEmail: submitterEmailOf(definition, validated.answers),
        searchText: searchTextOf(definition, validated.answers),
        // FR-064: the event carries the visible answers of the fields this version shares.
        sharedAnswers: sharedAnswers(definition, validated.answers),
        owner,
      }),
    );

    // Step 9.
    return answer();
  }

  /**
   * The posted country codes the dictionary knows and takes for a new record (FR-028). Asked once
   * per distinct code before the synchronous evaluator runs; a code it refuses is simply unknown,
   * and any other failure of the port propagates — a submission is never accepted unchecked.
   */
  async #knownCountries(
    definition: FormDefinition,
    values: FormSubmitBody['values'],
  ): Promise<ReadonlySet<string>> {
    const candidates = new Set<string>();
    for (const section of definition.sections) {
      for (const field of section.fields) {
        const posted =
          field.type === 'country' ? values[field.key] : field.type === 'address' ? values[`${field.key}.country`] : undefined;
        const first = (Array.isArray(posted) ? posted[0] : posted) as string | undefined;
        const code = (first ?? '').trim().toUpperCase();
        if (/^[A-Z]{2}$/.test(code)) candidates.add(code);
      }
    }
    const known = new Set<string>();
    await Promise.all(
      [...candidates].map(async (code) => {
        try {
          await this.deps.ports.dictionary.validateCountryCode(code, 'create-or-change');
          known.add(code);
        } catch (error) {
          if (!(error instanceof DictionaryReferenceError)) throw error;
        }
      }),
    );
    return known;
  }

  /**
   * One sentence per refused field, in the submission language (research R-24): the version's
   * `fields.<id>.errors.<code>` when the operator wrote one (default-language fallback included),
   * else the built-in `validation.<code>` of this module's bundle. An address part's key is
   * `<key>.<part>`; its override is the address field's.
   */
  async #fieldMessages(
    definition: FormDefinition,
    errors: readonly { fieldKey: string; code: FormFieldErrorCode }[],
    text: (textId: string) => string | undefined,
    language: string,
  ): Promise<{ fieldKey: string; code: FormFieldErrorCode; message: string }[]> {
    const idByKey = new Map<string, string>();
    for (const section of definition.sections) {
      for (const field of section.fields) if ('key' in field) idByKey.set(field.key, field.id);
    }
    const bundleLanguage = supportedLanguageOf(language);
    return Promise.all(
      errors.map(async (error) => {
        const fieldId = idByKey.get(error.fieldKey) ?? idByKey.get(error.fieldKey.split('.')[0]!);
        const override = fieldId === undefined ? undefined : text(`fields.${fieldId}.errors.${error.code}`);
        const message = override ?? (await this.deps.ports.i18n.translate('forms', `validation.${error.code}`, bundleLanguage));
        return { fieldKey: error.fieldKey, code: error.code, message };
      }),
    );
  }

  /** The confirmation of an accepted submission (FR-038): a CMS page falls back to the message. */
  async #confirmation(
    definition: FormDefinition,
    text: (textId: string) => string | undefined,
    scope: { salesChannelId: string; language: string },
  ): Promise<FormSubmitResponse['confirmation']> {
    const confirmation = definition.behaviour.confirmation;
    if (confirmation.type === 'redirect') return { type: 'redirect', url: confirmation.url };
    const path = await confirmationPagePath(confirmation, scope, this.deps.ports);
    if (path !== null) return { type: 'page', path };
    // The operator's message in the submission language; empty when they wrote none, and the
    // storefront shows its own built-in thanks (research R-24).
    return { type: 'message', message: text('messages.success') ?? '' };
  }
}

/** The consents as shown (FR-029): the text of each in the submission language. */
function consentRecords(
  definition: FormDefinition,
  consents: readonly { fieldKey: string; kind: FormConsentRecord['kind']; given: boolean }[],
  text: (textId: string) => string | undefined,
): FormConsentRecord[] {
  const idByKey = new Map<string, string>();
  for (const section of definition.sections) {
    for (const field of section.fields) if ('key' in field) idByKey.set(field.key, field.id);
  }
  return consents.map((consent) => ({
    fieldKey: consent.fieldKey,
    kind: consent.kind,
    given: consent.given,
    text: text(`fields.${idByKey.get(consent.fieldKey) ?? ''}.content`) ?? '',
  }));
}

/** The answer of the e-mail field marked as the submitter's, lower-cased; `null` when hidden or empty. */
function submitterEmailOf(definition: FormDefinition, answers: Readonly<Record<string, AnswerValue>>): string | null {
  for (const section of definition.sections) {
    for (const field of section.fields) {
      if (field.type === 'email' && field.submitterEmail) {
        const value = answers[field.key];
        return typeof value === 'string' && value !== '' ? value.toLowerCase() : null;
      }
    }
  }
  return null;
}
