// `config: { rateLimit }` is a declaration-merging augmentation of `@fastify/rate-limit`, which the
// host registers globally; the type-only import loads the declarations and emits nothing (the
// `cms` contact-form precedent).
import type {} from '@fastify/rate-limit';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ERROR_CODES, formSubmitBodySchema, publicFormQuerySchema } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { getResolvedChannel } from '@endora-commerce/platform/kernel';
import { formSubmissionTooLarge } from '../services/forms-errors.js';
import type { SubmissionActor } from '../services/submission/attribution.js';
import { isFormId, type PublicFormService, type SubmissionChannel } from '../services/submission/submission-service.js';

export interface PublicFormRoutesDeps {
  readonly publicFormService: PublicFormService;
}

const API = '/api/v1/storefront/forms';

/** The submission body limit (FR-036, research R-15): 256 KiB. */
export const FORMS_SUBMISSION_BODY_LIMIT = 262_144;

/**
 * The submission's own ceiling on top of the host's global one (FR-041, research R-15) — the
 * `cms.ContactForm` approach. Keyed by client address, not by form: a bot rotates forms.
 * `request.ip` is the shopper's only where the deployment trusts the storefront as a proxy
 * (`TRUSTED_PROXY_HOPS` / `TRUSTED_PROXY_ADDRESSES`) and the storefront forwards `x-forwarded-for`.
 */
export const FORMS_SUBMISSION_RATE_LIMIT = {
  max: 10,
  timeWindow: '10 minutes',
  keyGenerator: (request: FastifyRequest): string => `forms-submit:${request.ip}`,
};

/** The request's channel, resolved once by the platform's resolver (FR-035) — never re-parsed. */
function channelOf(request: FastifyRequest): SubmissionChannel {
  const channel = getResolvedChannel(request);
  return { id: channel.id, languages: channel.languages, defaultLanguage: channel.defaultLanguage };
}

function header(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** A malformed form id: the public read answers `200` for every well-formed id, so this is a `400`. */
function assertFormId(formId: string): void {
  if (!isFormId(formId)) {
    throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'A form id is a UUID.', { field: 'formId' });
  }
}

/**
 * The public form API (`specs/170-forms-module/` contracts/public-api.md §1–§2) — the contract a
 * headless client and the reference storefront share (FR-039). No sign-in is needed; the ordinary
 * sales-channel access rule applies, and a `b2b_session` cookie attributes a submission (FR-045).
 */
export async function registerPublicFormRoutes(app: FastifyInstance, deps: PublicFormRoutesDeps): Promise<void> {
  const { publicFormService } = deps;

  /**
   * §1 — always `200` for a well-formed id: a draft, a deleted form and one that never existed are
   * one `unavailable` body (research R-11), so the storefront's cached `200` heals by itself and no
   * answer says which forms exist. Briefly shareable; the storefront's Data Cache is the cache.
   */
  app.get<{ Params: { formId: string } }>(
    `${API}/:formId`,
    { schema: { querystring: publicFormQuerySchema } },
    async (request, reply) => {
      assertFormId(request.params.formId);
      const query = publicFormQuerySchema.parse(request.query);
      const definition = await publicFormService.read(request.params.formId, {
        channel: channelOf(request),
        language: query.language,
        acceptLanguage: header(request.headers['accept-language']),
      });
      reply.header('cache-control', 'public, max-age=0, s-maxage=60');
      return { data: definition };
    },
  );

  /**
   * §2 — a submission. A body over the limit is refused by Fastify's parser before anything runs;
   * the route's own error handler names that refusal `FORM_SUBMISSION_TOO_LARGE` and hands every
   * error to the host's envelope, so the answer is the platform's error shape either way.
   */
  app.post<{ Params: { formId: string } }>(
    `${API}/:formId/entries`,
    {
      bodyLimit: FORMS_SUBMISSION_BODY_LIMIT,
      config: { rateLimit: FORMS_SUBMISSION_RATE_LIMIT },
      schema: { querystring: publicFormQuerySchema, body: formSubmitBodySchema },
      errorHandler: (error: FastifyError, request: FastifyRequest, reply: FastifyReply) =>
        app.errorHandler(error.code === 'FST_ERR_CTP_BODY_TOO_LARGE' ? formSubmissionTooLarge() : error, request, reply),
    },
    async (request, reply) => {
      assertFormId(request.params.formId);
      const query = publicFormQuerySchema.parse(request.query);
      const result = await publicFormService.submit(request.params.formId, formSubmitBodySchema.parse(request.body), {
        channel: channelOf(request),
        language: query.language,
        acceptLanguage: header(request.headers['accept-language']),
        actor: (request as FastifyRequest & { actor?: SubmissionActor }).actor,
        remoteIp: request.ip,
      });
      reply.code(201);
      return { data: result };
    },
  );
}
