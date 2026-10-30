// `config: { rateLimit }` is a declaration-merging augmentation of `@fastify/rate-limit`, which
// the host registers globally; the type-only import loads the declarations and emits nothing
// (the `analytics` precedent).
import type {} from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ERROR_CODES, contactFormSubmissionSchema } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { getResolvedChannel } from '@endora-commerce/platform/kernel';
import type { StorefrontResolver } from './services/storefront-resolver.js';
import type { CmsBrandTokensService } from './services/brand-tokens-service.js';
import type { ContactFormService } from './services/contact-form/contact-form.service.js';

/**
 * The request's sales channel, resolved once by the canonical resolver
 * middleware (feature 053 / FR-002). Storefront modules read this instead of
 * re-parsing the `x-sales-channel` header.
 */
function resolvedChannel(request: FastifyRequest): {
  id: string;
  code: string;
  defaultLanguage: string;
  languages: readonly string[];
  prefixDefaultLanguage: boolean;
} {
  const ch = getResolvedChannel(request);
  return {
    id: ch.id,
    code: ch.code,
    defaultLanguage: ch.defaultLanguage,
    // Feature 167 — the channel's URL-language facts, for the CMS page URLs answered.
    languages: ch.languages,
    prefixDefaultLanguage: ch.prefixDefaultLanguage,
  };
}

export async function registerCmsStorefrontRoutes(
  app: FastifyInstance,
  deps: { storefrontResolver: StorefrontResolver; brandTokensService: CmsBrandTokensService },
): Promise<void> {
  /**
   * Feature 163 — the brand tokens every storefront page is styled from
   * (`contracts/storefront-and-admin-api.md` §1, research R-3).
   *
   * The channel is the request's resolved one, which always resolves and falls
   * back to the system default; its own set wins, then the global set, then
   * the built-in defaults — so one channel's override is never served on
   * another (Principle XII). Public and briefly cacheable: the storefront also
   * keeps it in its Data Cache under `cms:brand`, revalidated on every write.
   *
   * Reachable whatever the sales-channel access rule decides (feature 154): a
   * store closed to anonymous visitors still styles its sign-in page with its
   * brand. Brand tokens are presentation, not data.
   */
  app.get('/api/v1/storefront/cms/brand-tokens', { config: { salesChannelAccess: 'open' } }, async (request, reply) => {
    const tokens = await deps.brandTokensService.effective(resolvedChannel(request).id);
    reply.header('cache-control', 'public, max-age=60');
    return { data: tokens };
  });

  app.get('/api/v1/cms/pages/by-slug', async (request) => {
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    const slug = query['slug'];
    if (!slug) {
      throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'Missing CMS page slug.');
    }

    const page = await deps.storefrontResolver.resolvePageBySlug({
      slug,
      resolvedChannel: resolvedChannel(request),
      language: query['language'] ?? readHeader(request.headers['accept-language'])?.split(',')[0],
    });
    if (!page) {
      throw new HttpError(404, ERROR_CODES.CMS_PAGE_NOT_FOUND, 'CMS Page not found.');
    }
    return { data: page };
  });

  /**
   * The published pages of this request's sales channel, so the shop can tell a
   * crawler they exist (feature 105, FR-021; `contracts/cms-page-url.md` §4.1).
   *
   * Until this endpoint the storefront advertised **no CMS URL at all**: the
   * sitemap's `SITEMAP_DYNAMIC_ROUTES` names `/[...slug]` as a route *pattern*
   * for the check's reconciliation, and nothing enumerated the rows behind it.
   *
   * The admin listing is not the answer to that and could not be: it is
   * `cms.read`-gated, is not scoped to the request's channel, and returns
   * drafts and archived pages, so a sitemap built from it would advertise
   * unpublished content (`research.md` D-6).
   *
   * It takes no language, unlike the three lookups around it. A sitemap carries
   * addresses, and a page's address is the same in every language it is served
   * in; the language is resolved when the document is fetched, by `by-slug`.
   */
  app.get('/api/v1/cms/pages/by-channel', async (request) => {
    const pages = await deps.storefrontResolver.listPublishedPages({
      resolvedChannel: resolvedChannel(request),
    });
    return { data: { pages } };
  });

  app.get('/api/v1/cms/blocks/by-code', async (request) => {
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    const code = query['code'];
    if (!code) {
      throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'Missing CMS block code.');
    }

    const block = await deps.storefrontResolver.resolveBlockByCode({
      code,
      resolvedChannel: resolvedChannel(request),
      language: query['language'] ?? readHeader(request.headers['accept-language'])?.split(',')[0],
    });
    if (!block) {
      throw new HttpError(404, ERROR_CODES.CMS_BLOCK_NOT_FOUND, 'CMS Block not found.');
    }
    return { data: block };
  });

  app.get('/api/v1/cms/hooks/by-code', async (request) => {
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    const code = query['code'];
    if (!code) {
      throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'Missing CMS hook code.');
    }

    const hook = await deps.storefrontResolver.resolveHookByCode({
      code,
      resolvedChannel: resolvedChannel(request),
      language: query['language'] ?? readHeader(request.headers['accept-language'])?.split(',')[0],
    });
    if (!hook) {
      throw new HttpError(404, ERROR_CODES.CMS_HOOK_NOT_FOUND, 'CMS Hook not found.');
    }
    return { data: hook };
  });
}

/**
 * Feature 169 (research R-9) — the contact form's own ceiling, on top of the host's global one.
 * Keyed by client IP: the form is anonymous. `request.ip` is the shopper's only where the
 * deployment trusts the storefront as a proxy (`TRUSTED_PROXY_HOPS` / `TRUSTED_PROXY_ADDRESSES`);
 * otherwise every shopper of a server-rendered storefront shares the storefront's address.
 */
export const CMS_CONTACT_FORM_RATE_LIMIT = {
  max: 10,
  timeWindow: '10 minutes',
  keyGenerator: (request: FastifyRequest): string => `cms-contact:${request.ip}`,
};

/**
 * Feature 169 (`specs/169-page-builder-contact-form/` contracts/contact-form-api.md §2) — the
 * `cms.ContactForm` block's submission: validated against the shared contract, e-mailed to the
 * request channel's recipients, stored nowhere. Answers `{ data: { status: 'sent' } }`, a
 * filled honeypot included; never echoes the submission or the recipients.
 */
export async function registerCmsContactFormRoute(
  app: FastifyInstance,
  deps: { contactForm: () => ContactFormService },
): Promise<void> {
  app.post(
    '/api/v1/storefront/cms/contact-form',
    { config: { rateLimit: CMS_CONTACT_FORM_RATE_LIMIT } },
    async (request) => {
      const submission = contactFormSubmissionSchema.parse(request.body);
      const channel = getResolvedChannel(request);
      const result = await deps
        .contactForm()
        .submit(submission, { id: channel.id, name: channel.name, defaultLanguage: channel.defaultLanguage });
      return { data: result };
    },
  );
}

function readHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
