import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { LANGUAGE_FALLBACK, ERROR_CODES, type ErrorCode, type ErrorEnvelope, type ModuleErrorCode, type SupportedLanguage } from '@endora-commerce/contracts';
import { ZodError, type core as zodCore } from 'zod';
import { hasZodFastifySchemaValidationErrors } from '@fastify/type-provider-zod';
import { OrgWriteOutOfScopeError } from '../tenancy/tenant-context.js';

/**
 * Fastify plugin that converts every error — Zod validation failures, MikroORM unique-constraint
 * violations, HttpError throws, or unexpected exceptions — into the project-wide error envelope
 * documented in specs/001-b2b-platform-foundation/contracts/README.md.
 */

export class HttpError extends Error {
  readonly statusCode: number;
  /**
   * The platform's own enumeration, or a code a module declared (feature 090,
   * D-182). `ModuleErrorCode` is branded and is produced only by
   * `defineModuleErrorCodes`, so a bare `'ACME_TYPO'` here is a compile error
   * rather than a code that travels the whole path and renders raw to an
   * operator with nothing reporting it.
   */
  readonly code: ErrorCode | ModuleErrorCode;
  // The legacy shape (an array of {path, issue}) is preserved for Zod-style
  // validation failures. Feature 022 introduced bulk-operation errors that
  // need a free-form object (e.g. `{ maxBatchSize: 200, attribute: "brand" }`).
  // Both shapes are propagated verbatim into the response envelope.
  readonly details?: Array<{ path: string; issue: string }> | Record<string, unknown>;
  /**
   * Response headers this error implies, applied by the error handler below.
   *
   * A status code is sometimes only half the answer: `503 MODULE_DISABLED` is
   * `Retry-After` or it is an outage, and which one the client believes decides
   * whether it backs off or gives up. Before this, the header was set by the
   * one hook that knew it — `defineModuleRoutes` — so the identical error
   * thrown from a service call (`requireModuleEnabled`) or from a port
   * resolution reached the client without it. Carrying it on the error keeps
   * the answer the same wherever the throw happens.
   */
  readonly headers?: Readonly<Record<string, string>>;

  constructor(
    statusCode: number,
    code: ErrorCode | ModuleErrorCode,
    message: string,
    details?: Array<{ path: string; issue: string }> | Record<string, unknown>,
    headers?: Readonly<Record<string, string>>,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
    if (headers !== undefined) {
      this.headers = headers;
    }
    this.name = 'HttpError';
  }
}

/** Which translation bundle owns an error code's message. Injected — see below. */
export interface ErrorTranslationTargets {
  readonly [code: string]: { readonly moduleId: string; readonly key: string } | undefined;
}

export interface ErrorEnvelopeOptions {
  /**
   * `ErrorCode → {moduleId, key}`, injected by the composition root (D-54).
   *
   * The map lives in `_i18n` and used to be imported here directly — the one
   * thing in this plugin that was not injected, while the two functions below
   * already were. `src/http` is a kernel-obeying platform peer (D-52): the
   * kernel cannot compile without it, so a peer permitted to import a module is
   * a kernel importing modules with one extra hop, and in package terms it is
   * the cycle `kernel → http → mod-i18n → kernel`. Nothing was broken at
   * runtime — `_i18n` is `nonDeactivatable` and the map was then a static table
   * — but F4's precondition is that packages are not cyclic.
   *
   * **It stays injected rather than moving into `@endora-commerce/contracts`**, for symmetry
   * with the two functions below and because a routing table frozen into a
   * contracts release is a routing table a module cannot re-point when it takes
   * ownership of a code family.
   *
   * It is *not*, however, a per-deployment override, and this comment used to
   * say it was (issue #106). Translation values are shipped as module JSON,
   * reconciled into `translation_bundles` at boot and re-read on reload, and no
   * admin route edits one — so a deployment genuinely cannot change a sentence
   * by configuration. But re-routing a family through this map does not help:
   * both composition roots pass the same derivation, and a deployment cannot
   * substitute it without editing a core file, which is the thing the overlay
   * pattern exists to avoid. **A deployment's own overlay module can now change
   * the answer honestly** (feature 090): the map is
   * `buildErrorTranslationTargets` over the resolved manifest set, so an overlay
   * module that declares a code owns it — and one that declares a code a core
   * module already declares collides with it, and the code routes to neither.
   * What a deployment *can* already
   * do, with no new machinery, is decorate the `adminI18nService` registration
   * from its own overlay module (`ctx.di.decorate`, D-103) and answer
   * differently for the keys it cares about — a lever that reaches every string
   * rather than only an error family. Whether that is the answer #106 wants is a product
   * question, not a technical one, and nothing here assumes an answer: this hook
   * chooses the **key** and the **params**, never the value, so a value-level
   * override built later slots underneath both it and issue #65's token rule
   * without touching either.
   *
   * Absent, no message is translated; the envelope keeps the original text.
   */
  errorTranslationTargets?: ErrorTranslationTargets;
  translateErrorMessage?: (args: {
    moduleId: string;
    key: string;
    language: SupportedLanguage;
    originalMessage: string;
    /**
     * Values for the `{placeholder}`s in the sentence, read off the error's
     * `details` (issue #161).
     *
     * Substitution stays in `_i18n` — it already interpolates `{name}` for
     * every other backend-side lookup, and two implementations of one template
     * syntax is one too many. What this plugin decides is *which* values, and
     * the answer is the error's own structured metadata: `details` is already
     * on the wire, already survives the message replacement, and is already
     * where issue #65 put the discriminator this hook reads.
     */
    params?: Record<string, string | number>;
    request: FastifyRequest;
  }) => Promise<string>;
  /**
   * Which language this response is written in, decided per audience.
   *
   * Injected for the same reason the two functions above are: the *policy* —
   * the buyer's q-weighted header, the channel backstop, the admin's stored
   * preference — lives in `src/kernel/i18n/request-language.ts`, and
   * `src/http` may not import `src/kernel` (the kernel already imports
   * `HttpError` from here, so an edge back is the package cycle D-52 refuses).
   * Both composition roots may import both, and that is what joins them
   * (feature 083, D-137).
   *
   * Absent, or answering nothing, the envelope falls back to
   * `LANGUAGE_FALLBACK`. That fallback used to be reached by **every** buyer,
   * because both roots' closures returned `null` for a non-admin actor — issue
   * #234, and the reason the constant is no longer called "admin".
   */
  resolvePreferredLanguage?: (request: FastifyRequest) => Promise<SupportedLanguage | null | undefined>;
}

export function registerErrorEnvelope(app: FastifyInstance, options: ErrorEnvelopeOptions = {}): void {
  app.addHook('preSerialization', async (request, reply, payload) => {
    if (!options.translateErrorMessage || !isErrorEnvelope(payload)) return payload;
    const target = options.errorTranslationTargets?.[payload.error.code];
    if (!target) return payload;
    try {
      return await localizeErrorEnvelope(options, target, payload, request, reply);
    } catch (error) {
      // **Localising an error may never replace the error.**
      //
      // Every other way out of the decoration below already returns `payload`
      // unchanged — no target, a `VALIDATION_FAILED` carrying a machine token,
      // a sentence with a placeholder nothing filled — on the ruling that
      // untranslated prose which is true beats a rendered sentence that is
      // not. A throw was the one path that did neither, and it is the worst of
      // them: this hook runs during the serialisation of a reply Fastify is
      // already treating as an error, so Fastify cannot route the throw back
      // through `setErrorHandler`. It falls back to its own serialiser, and
      // the response stops being an `ErrorEnvelope` at all —
      // `{ statusCode, code, error, message }`, where `error` is the status
      // phrase and `error.code` is `undefined`.
      // The admin's API client (`@endora-commerce/admin-kit/lib`) sees
      // `'error' in body`, builds an `ApiError` out of it and reports
      // `undefined: undefined`.
      //
      // Both injected callbacks can throw and one of them measurably did:
      // feature 080's T052 turned the root's `adminPreferredLanguage` closure
      // into a read of the gated `adminUserReadPort`, so while `admin_users`
      // was platform-absent every error answered to a signed-in admin lost its
      // envelope — the `MODULE_DISABLED` refusal included, which is the one
      // whose job is to name the module an operator has to restore (issue
      // #161). `RequestLanguageDeps.adminPreferredLanguage` had said in
      // writing that a gated port here would do exactly that.
      //
      // So the guarantee is stated once, at the renderer, rather than at each
      // callback a root injects: an absent owner, a bundle store that cannot be
      // reached, and whatever the next callback turns out to be all degrade to
      // the untranslated envelope. This is deliberately **not** a
      // `catch` that hides a capability's absence from a caller — the caller
      // still gets the refusal, in full, in `LANGUAGE_FALLBACK`.
      request.log.warn(
        { err: error, code: payload.error.code, moduleId: target.moduleId },
        'error-envelope localisation failed; answering with the untranslated envelope',
      );
      return payload;
    }
  });

  app.setErrorHandler((error, request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.id;

    // Fastify wraps Zod validation errors from the Zod type provider — detect them via
    // the helper exposed by @fastify/type-provider-zod, then fall back to a plain ZodError.
    if (hasZodFastifySchemaValidationErrors(error)) {
      const envelope: ErrorEnvelope = {
        error: {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Request failed validation.',
          details: error.validation.map((issue) => ({
            path: issue.instancePath.replace(/^\//, '').replace(/\//g, '.'),
            issue: issue.message ?? 'invalid',
          })),
          requestId,
        },
      };
      reply.status(400).send(envelope);
      return;
    }

    if (error instanceof ZodError) {
      const envelope: ErrorEnvelope = {
        error: {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Request failed validation.',
          details: error.issues.map((issue: zodCore.$ZodIssue) => ({
            path: issue.path.map(String).join('.'),
            issue: issue.message,
          })),
          requestId,
        },
      };
      reply.status(400).send(envelope);
      return;
    }

    if (error instanceof HttpError) {
      // A **server fault** is logged whether or not somebody wrapped it, and the
      // status code is what decides — not the class, and not the code.
      //
      // The 5xx branch used to return in silence, and that silence is what let
      // an instance answer `500 INTERNAL` to every request for months with
      // nothing to read: `NoSystemDefaultChannel` is an `HttpError`, so it never
      // reached the `request.log.error` at the bottom of this handler, and the
      // envelope's `requestId` was the entire trace. Diagnosing it needed a
      // `console.error` patched into an installed package.
      //
      // A 4xx stays silent, deliberately: it is the client saying something
      // wrong, its own envelope already says what, and logging it turns a
      // mistyped URL into log volume.
      if (error.statusCode >= 500) {
        request.log.error({ err: error, statusCode: error.statusCode, code: error.code }, 'server fault');
      }
      const envelope: ErrorEnvelope = {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
          requestId,
        },
      };
      for (const [name, value] of Object.entries(error.headers ?? {})) {
        reply.header(name, value);
      }
      reply.status(error.statusCode).send(envelope);
      return;
    }

    // The tenant write guard's refusal (D-260/A). Raised by
    // `tenancy/org-write-guard.ts` from inside `em.flush()`, so it arrives here
    // having rolled the whole transaction back — including the audit row.
    //
    // **403 and not 404, and this is deliberate** — a future reader will
    // otherwise "fix" it to a 404 by citing FR-008. FR-008 is about not
    // disclosing whether a *record* exists, and this is not that answer: it is a
    // **backstop** behind the surface's own gate (D-260/B), reached only when a
    // route accepted an organization id it never authorised. The caller supplied
    // the id, so "outside your scope" tells it nothing it did not already know,
    // and the error carries no organization and no set — see
    // `OrgWriteOutOfScopeError`. A 404 here would also be a lie about the one
    // thing the operator needs: that the request was refused rather than lost.
    // The indistinguishable-from-not-found answer is the *surface's* to give,
    // upstream, before the command runs.
    if (error instanceof OrgWriteOutOfScopeError) {
      const envelope: ErrorEnvelope = {
        error: {
          code: ERROR_CODES.FORBIDDEN,
          message: 'This write is outside your organization scope.',
          requestId,
        },
      };
      reply.status(403).send(envelope);
      return;
    }

    // MikroORM unique-constraint violation: `UniqueConstraintViolationException` has a
    // stable class name we can test without importing the full ORM type.
    //
    // **A 409 arriving from a tenant-keyed unique constraint is a missing scope
    // gate upstream, not a lost race** (D-260, corollary 1). The mapping is
    // right and stays: for a genuine duplicate, 409 and *"the resource was
    // changed by another process"* are the correct answer. What used to arrive
    // through it was a *refusal* — a scoped actor inserting a row for an
    // organization whose existing row its own narrowed read could not see, so
    // the composite primary key collided. Measured twice on the same shape, in
    // `quick_order` (087 §2.2) and in the five payment gateways. Both authors
    // delete it at its cause — the branch above refuses before the insert, and
    // the surface's own gate answers before the command runs — so a 409 on such
    // a path today means one of those two is missing, and the repair is
    // upstream rather than here.
    if ((error as { constructor?: { name?: string } }).constructor?.name === 'UniqueConstraintViolationException') {
      const envelope: ErrorEnvelope = {
        error: {
          code: ERROR_CODES.VERSION_CONFLICT,
          message: 'Unique constraint violated.',
          requestId,
        },
      };
      reply.status(409).send(envelope);
      return;
    }

    // Fallback — 500. Log the full error; do not leak details to the client.
    request.log.error({ err: error }, 'unhandled error');
    const envelope: ErrorEnvelope = {
      error: {
        code: ERROR_CODES.INTERNAL,
        message: 'Internal server error.',
        requestId,
      },
    };
    reply.status(500).send(envelope);
  });

  // 404 fallback (Fastify's default is a plain text; we want the envelope).
  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    const envelope: ErrorEnvelope = {
      error: {
        code: ERROR_CODES.NOT_FOUND,
        message: `Route ${request.method} ${request.url} not found.`,
        requestId: request.id,
      },
    };
    reply.status(404).send(envelope);
  });
}

/**
 * The decoration itself: the written message replaced by the registered
 * sentence for its code, in the language this response is being answered in.
 *
 * Split out of the hook so the guard above wraps the whole of it and nothing
 * else — a `try` opened around the early returns too would be a blanket catch
 * over a payload that never entered the decoration.
 */
async function localizeErrorEnvelope(
  options: ErrorEnvelopeOptions,
  target: { moduleId: string; key: string },
  payload: ErrorEnvelope,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<ErrorEnvelope> {
  // Narrowing only: the hook already refused a composition that injects no
  // translator, and this is the same `options` object.
  if (!options.translateErrorMessage) return payload;
  // VALIDATION_FAILED is overloaded: besides generic Zod failures it is the
  // code several services reuse while putting a specific, machine-readable
  // token in the message (e.g. `sku_in_use`, `attribute_not_found`,
  // `language_not_in_channel`). Unlike other registered codes — whose
  // message is human prose safe to localize wholesale — replacing this one
  // with the generic localized string would destroy the token that API
  // consumers (and contract tests) depend on. Leave its message verbatim.
  if (payload.error.code === ERROR_CODES.VALIDATION_FAILED) return payload;
  // The same phenomenon one code lower, written down somewhere else (issue
  // #65). A code such as `FORBIDDEN` is shared by every permission failure in
  // the tree, so its sentence has to be generic — "You do not have permission
  // to perform this action." A refusal that is *not* about permission carries
  // a machine-readable token in `details.code` to say so, and the four
  // transact gates (`orders`, its external intake, `carts`, `quote_requests`)
  // all publish `organization_cannot_transact` there. Replacing their written
  // message with the family sentence told a buyer whose Organization was
  // blocked for a business reason that they lack permission: wrong, and
  // unactionable — they contact support about access rather than about the
  // block.
  //
  // So the token keys the sentence: `errors.<CODE>.<token>` when the bundle
  // has one, `errors.<CODE>` when the error carries no token. A token with no
  // sentence yet resolves to nothing, and both roots' translators answer a
  // missing key with the original message — which is the right fallback here,
  // because untranslated prose that is true beats a translated sentence that
  // is false. Re-routing the family to another module's bundle keeps working:
  // the module is still chosen by the injected map, and only the key inside it
  // changes. (That routing is not the per-deployment override this comment
  // once called it — see `errorTranslationTargets` above, issue #106.)
  //
  // The same reasoning one step further along (issue #161). `MODULE_DISABLED`
  // is one code for every gated port in the platform, so its sentence is
  // generic for the same reason `FORBIDDEN`'s is — but the specific part is
  // not a token choosing a different sentence, it is a *value* the one
  // sentence is missing. An operator refused a refund because a payment
  // gateway is switched off read "Module Disabled." and was not told which
  // module to switch back on, while `ModuleDisabledError` had carried the id
  // on the error object all along.
  //
  // So the error's structured metadata fills the sentence: `details`' scalar
  // members become the interpolation parameters. It is the same `details` the
  // token above is read from — already on the wire, already surviving this
  // replacement — so a thrower that wants its refusal named says so once, in
  // the place a client can branch on too.
  const params = messageParams(payload.error.details);
  const token = refusalToken(payload.error.details);
  const language = (await options.resolvePreferredLanguage?.(request)) ?? LANGUAGE_FALLBACK;
  const translated = await options.translateErrorMessage({
    moduleId: target.moduleId,
    key: token === null ? target.key : `${target.key}.${token}`,
    language,
    originalMessage: payload.error.message,
    ...(params ? { params } : {}),
    request,
  });
  // A sentence with a placeholder nothing filled is worse than the prose the
  // thrower wrote: `The "{module}" module is off` tells the operator less than
  // the original message and looks broken doing it. Same ruling as the missing
  // token key above — untranslated prose that is true beats a rendered
  // sentence that is not.
  if (hasUnfilledPlaceholder(translated)) return payload;
  // Say which language was chosen, and that the body varies with the header
  // that chose it (D-139 § 8.2). The sales-channel resolver already echoes
  // `X-Sales-Channel` on every response for exactly this reason, and the
  // precedent is the right one: a resolution nobody can see is a resolution
  // nobody audits. Had this header existed, issue #234 — every buyer
  // answered in English — would have been visible in a browser's network tab
  // from the first day.
  //
  // `Vary` is set only here, on a response whose body genuinely varies:
  // `catalog`, `search` and `cms` vary content on the same header and carry
  // no `Vary` either, which is a pre-existing cache-key gap this feature does
  // not widen and does not fix (T024).
  reply.header('Content-Language', language);
  varyBy(reply, 'Accept-Language');
  return {
    ...payload,
    error: {
      ...payload.error,
      message: translated,
    },
  };
}

/**
 * The refusal token an error carries, or `null`.
 *
 * `details` has two shapes (see `errorEnvelopeSchema`): the Zod-style array of
 * `{path, issue}` pairs, which carries no token, and the free-form object a
 * domain error uses for structured metadata. Only the second can name one, and
 * only a non-empty string counts.
 */
function refusalToken(details: ErrorEnvelope['error']['details']): string | null {
  if (!details || Array.isArray(details)) return null;
  const code = (details as Record<string, unknown>)['code'];
  return typeof code === 'string' && code.length > 0 ? code : null;
}

/**
 * The values a sentence's `{placeholder}`s may be filled from, or `undefined`.
 *
 * Same two shapes as {@link refusalToken}: the Zod-style array carries
 * `{path, issue}` pairs and nothing a sentence names, so it contributes
 * nothing. From the free-form object only **scalars** are taken — an array or a
 * nested object has no defensible rendering inside prose, and one that
 * stringified to `[object Object]` in front of an operator would be a worse
 * message than the one it replaced.
 */
function messageParams(
  details: ErrorEnvelope['error']['details'],
): Record<string, string | number> | undefined {
  if (!details || Array.isArray(details)) return undefined;
  const params: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(details as Record<string, unknown>)) {
    if (typeof value === 'string' || typeof value === 'number') params[name] = value;
  }
  return Object.keys(params).length > 0 ? params : undefined;
}

/**
 * Add one field name to the response's `Vary`, keeping whatever is already
 * there.
 *
 * `reply.header('Vary', …)` replaces, and `@fastify/cors` writes `Vary: Origin`
 * on a cross-origin response — so a plain set would trade one cache-key defect
 * for another: every buyer's language, or every allowed origin, collapsing onto
 * one cached entry.
 */
function varyBy(reply: FastifyReply, field: string): void {
  const existing = reply.getHeader('Vary');
  const current = Array.isArray(existing) ? existing.join(', ') : (existing ?? '');
  const fields = String(current)
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (fields.some((part) => part.toLowerCase() === field.toLowerCase())) return;
  reply.header('Vary', [...fields, field].join(', '));
}

/** `{name}` left standing after interpolation — see the call site. */
function hasUnfilledPlaceholder(message: string): boolean {
  return /\{\w+\}/.test(message);
}

function isErrorEnvelope(payload: unknown): payload is ErrorEnvelope {
  if (!payload || typeof payload !== 'object') return false;
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return typeof candidate.code === 'string' && typeof candidate.message === 'string';
}
