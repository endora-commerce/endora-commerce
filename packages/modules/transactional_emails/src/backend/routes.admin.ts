import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  createEmailBlockRequestSchema,
  createEmailTemplateRequestSchema,
  emailScopeQuerySchema,
  patchEmailBlockRequestSchema,
  patchEmailTemplateRequestSchema,
  previewEmailRequestSchema,
  putEmailBrandingRequestSchema,
  putEmailBlockContentRequestSchema,
  putEmailContentQuerySchema,
  putEmailContentRequestSchema,
  setTransactionalEmailActiveRequestSchema,
  transactionalEmailDetailQuerySchema,
} from '@endora-commerce/contracts';
import type { PuckDataTree } from '@endora-commerce/email-components/schema/envelope';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { makeSetTransactionalEmailActiveCommand } from './commands/email-activation.commands.js';
import type { EmailDefaultsRegistry } from './services/email-defaults-registry.js';
import { describeEmailBuilder } from './services/email-builder-registry.js';
import type { TransactionalEmailService } from './services/transactional-email.service.js';
import type { BrandingService } from './services/branding.service.js';
import type { EmailBlockService } from './services/email-block.service.js';
import type { EmailTemplateService } from './services/email-template.service.js';

type RequireAdmin = (permission?: string) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export interface TransactionalEmailsAdminRoutesDeps {
  service: TransactionalEmailService;
  branding: BrandingService;
  blocks: EmailBlockService;
  templates: EmailTemplateService;
  requireAdmin: RequireAdmin;
  resolveAdminUserId: (req: FastifyRequest) => string | null;
  /** The per-email activation flip (issue #89) — Principle XIII. */
  commandBus: CommandBus;
  /** Where the owning modules declared which emails may not be switched off. */
  defaults: EmailDefaultsRegistry;
}

const READ = 'transactional_emails:read';
const WRITE = 'transactional_emails:write';

export async function registerTransactionalEmailsAdminRoutes(
  app: FastifyInstance,
  deps: TransactionalEmailsAdminRoutesDeps,
): Promise<void> {
  const { service, branding, blocks, templates, requireAdmin, resolveAdminUserId, commandBus, defaults } =
    deps;
  const base = '/api/v1/admin/transactional-emails';

  // --- Page-builder descriptor (email-safe palette) ----------------------
  app.get(`${base}/page-builder/config`, { preHandler: requireAdmin(READ) }, async () => ({
    data: describeEmailBuilder(),
  }));

  // --- Reusable blocks ----------------------------------------------------
  app.get(`${base}/blocks`, { preHandler: requireAdmin(READ) }, async (request) => {
    const q = emailScopeQuerySchema.parse(request.query);
    return { data: { items: await blocks.list(q.salesChannelId) } };
  });
  app.post(`${base}/blocks`, { preHandler: requireAdmin(WRITE) }, async (request) => {
    const body = createEmailBlockRequestSchema.parse(request.body);
    return { data: await blocks.create(body) };
  });
  app.get(`${base}/blocks/:id`, { preHandler: requireAdmin(READ) }, async (request) => {
    const { id } = request.params as { id: string };
    return { data: await blocks.get(id) };
  });
  app.patch(`${base}/blocks/:id`, { preHandler: requireAdmin(WRITE) }, async (request) => {
    const { id } = request.params as { id: string };
    const body = patchEmailBlockRequestSchema.parse(request.body);
    return { data: await blocks.patch(id, body) };
  });
  app.put(`${base}/blocks/:id/content/:language`, { preHandler: requireAdmin(WRITE) }, async (request) => {
    const { id, language } = request.params as { id: string; language: string };
    const body = putEmailBlockContentRequestSchema.parse(request.body);
    return { data: await blocks.setContent(id, language, body) };
  });
  app.delete(`${base}/blocks/:id`, { preHandler: requireAdmin(WRITE) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await blocks.delete(id);
    return reply.code(204).send();
  });

  // --- Reusable templates -------------------------------------------------
  app.get(`${base}/templates`, { preHandler: requireAdmin(READ) }, async (request) => {
    const q = emailScopeQuerySchema.parse(request.query);
    return { data: { items: await templates.list(q.salesChannelId) } };
  });
  app.post(`${base}/templates`, { preHandler: requireAdmin(WRITE) }, async (request) => {
    const body = createEmailTemplateRequestSchema.parse(request.body);
    return { data: await templates.create(body) };
  });
  app.get(`${base}/templates/:id`, { preHandler: requireAdmin(READ) }, async (request) => {
    const { id } = request.params as { id: string };
    return { data: await templates.get(id) };
  });
  app.patch(`${base}/templates/:id`, { preHandler: requireAdmin(WRITE) }, async (request) => {
    const { id } = request.params as { id: string };
    const body = patchEmailTemplateRequestSchema.parse(request.body);
    return { data: await templates.patch(id, body) };
  });
  app.put(`${base}/templates/:id/content/:language`, { preHandler: requireAdmin(WRITE) }, async (request) => {
    const { id, language } = request.params as { id: string; language: string };
    const body = putEmailBlockContentRequestSchema.parse(request.body);
    return { data: await templates.setContent(id, language, body) };
  });
  app.delete(`${base}/templates/:id`, { preHandler: requireAdmin(WRITE) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await templates.delete(id);
    return reply.code(204).send();
  });

  // --- Branding (read + write) -------------------------------------------
  app.get(`${base}/branding`, { preHandler: requireAdmin(READ) }, async (request) => {
    const q = emailScopeQuerySchema.parse(request.query);
    return { data: await branding.resolve(q.salesChannelId ?? null) };
  });
  app.put(`${base}/branding`, { preHandler: requireAdmin(WRITE) }, async (request) => {
    const q = emailScopeQuerySchema.parse(request.query);
    const body = putEmailBrandingRequestSchema.parse(request.body);
    const data = await branding.update(q.salesChannelId ?? null, body, {
      actorAdminUserId: resolveAdminUserId(request),
    });
    return { data };
  });

  // --- Email definitions --------------------------------------------------
  app.get(base, { preHandler: requireAdmin(READ) }, async () => ({
    data: { items: await service.list() },
  }));

  app.get(`${base}/:code`, { preHandler: requireAdmin(READ) }, async (request) => {
    const { code } = request.params as { code: string };
    const q = transactionalEmailDetailQuerySchema.parse(request.query);
    return { data: await service.getDetail(code, q.salesChannelId ?? null, q.language) };
  });

  app.put(`${base}/:code/content`, { preHandler: requireAdmin(WRITE) }, async (request) => {
    const { code } = request.params as { code: string };
    const q = putEmailContentQuerySchema.parse(request.query);
    const body = putEmailContentRequestSchema.parse(request.body);
    const data = await service.saveContent(
      code,
      { salesChannelId: q.salesChannelId ?? null, language: q.language },
      { subject: body.subject, content: body.content as PuckDataTree, ...(body.expectedVersion !== undefined ? { expectedVersion: body.expectedVersion } : {}) },
      { adminUserId: resolveAdminUserId(request) },
    );
    return { data };
  });

  app.delete(`${base}/:code/content`, { preHandler: requireAdmin(WRITE) }, async (request) => {
    const { code } = request.params as { code: string };
    const q = putEmailContentQuerySchema.parse(request.query);
    const data = await service.resetContent(
      code,
      { salesChannelId: q.salesChannelId ?? null, language: q.language },
      { adminUserId: resolveAdminUserId(request) },
    );
    return { data };
  });

  /**
   * Issue #89 — switch one email on or off.
   *
   * `WRITE` rather than a new permission code: it is the same "manage
   * transactional emails" authority that already lets an operator rewrite the
   * body of this very email, and silencing it is the lesser of the two.
   *
   * The refusal for a protected code happens in the Command factory, before a
   * transaction opens, so a refused flip leaves no audit row — matching the
   * module-level door exactly.
   */
  app.post(`${base}/:code/activation`, { preHandler: requireAdmin(WRITE) }, async (request) => {
    const { code } = request.params as { code: string };
    const body = setTransactionalEmailActiveRequestSchema.parse(request.body);
    const result = await commandBus.run(
      makeSetTransactionalEmailActiveCommand({ code, active: body.active }, defaults),
    );
    return { data: await service.summary(result.code) };
  });

  app.post(`${base}/:code/preview`, { preHandler: requireAdmin(READ) }, async (request) => {
    const { code } = request.params as { code: string };
    const body = previewEmailRequestSchema.parse(request.body);
    const data = await service.preview(code, {
      salesChannelId: body.salesChannelId ?? null,
      ...(body.language !== undefined ? { language: body.language } : {}),
      ...(body.draftSubject !== undefined ? { draftSubject: body.draftSubject } : {}),
      ...(body.draftContent !== undefined ? { draftContent: body.draftContent as PuckDataTree } : {}),
    });
    return { data };
  });
}
