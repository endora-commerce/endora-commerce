import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from '@fastify/type-provider-zod';

import { registerErrorEnvelope } from './error-envelope.js';
import {
  attachOpenApiAutoRegistration,
  registerOpenApiRoutes,
  type OpenApiMetadata,
} from './openapi.js';
import type { ErrorEnvelopeOptions } from './error-envelope.js';

/**
 * Module registration hook — each backend module exposes a plugin that takes
 * the composed Fastify app and wires its own routes. Modules receive the
 * composition root's dependency container via a separate mechanism (services
 * are constructed once at boot and passed in explicitly). This keeps the
 * server.ts bootstrap decoupled from any specific module.
 */
export type ModulePlugin = (app: FastifyInstance) => Promise<void> | void;

/**
 * Fastify bootstrap — the single entry point used by `src/index.ts` (production) and by
 * test/helpers/test-server.ts (contract tests). All cross-cutting concerns (helmet, cookie
 * parsing, rate limiting, Zod validation, error envelope, request id, OpenAPI) are wired
 * here so individual module routes only deal with domain logic.
 */

export interface BuildServerOptions {
  /** Secret used to sign session cookies (required in production). */
  sessionCookieSecret: string;
  /** Visible in the generated OpenAPI document. */
  openApi: OpenApiMetadata;
  /** Test overrides — bypass rate limits so contract tests are not flaky. */
  disableRateLimit?: boolean;
  /**
   * Optional per-IP request budget (requests per minute). When omitted, the
   * default is 1000/min — high enough that local SSR dev (which can fire
   * 10+ backend calls per page render across layout hooks, cart, /me,
   * upsells, etc.) does not trip the limiter on every navigation.
   * Production composition can pass a tighter ceiling via env.
   */
  rateLimitMax?: number;
  /** Business-module route registrations, invoked after cross-cutting hooks are installed. */
  modules?: ModulePlugin[];
  /** Optional i18n bridge for translating standardized error envelopes. */
  errorEnvelope?: ErrorEnvelopeOptions;
}

export async function buildServer(options: BuildServerOptions): Promise<FastifyInstance> {
  // Fastify configures pino internally from these options. We don't pass a pre-built
  // Logger instance because pino 10's `msgPrefix: string | undefined` conflicts with
  // Fastify's stricter `FastifyBaseLogger` under exactOptionalPropertyTypes.
  const isDev = process.env['NODE_ENV'] !== 'production';
  const app = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] ?? 'info',
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.passwordHash', '*.secret'],
        censor: '[REDACTED]',
      },
      ...(isDev
        ? {
            transport: {
              target: 'pino-pretty',
              options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
            },
          }
        : {}),
    },
    genReqId: () => `req_${randomHex(16)}`,
    requestIdHeader: 'x-request-id',
    trustProxy: false,
    disableRequestLogging: false,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet, { contentSecurityPolicy: false });
  // Allow the storefront (Next.js) and admin panel (Vite) to call the API
  // cross-origin in dev. CORS_ALLOWED_ORIGINS is a comma-separated allow-list;
  // the default covers the local dev ports for both apps. `credentials: true`
  // pairs with the api-client's `credentials: 'include'` so b2b_session
  // cookies survive the round-trip.
  const corsOrigins = (
    process.env['CORS_ALLOWED_ORIGINS'] ?? 'http://localhost:3000,http://localhost:3002'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  await app.register(cors, {
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'Authorization', 'X-Sales-Channel', 'Accept-Language', 'If-Match', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'ETag'],
  });
  await app.register(cookie, { secret: options.sessionCookieSecret });

  if (options.disableRateLimit !== true) {
    await app.register(rateLimit, {
      max: options.rateLimitMax ?? 1000,
      timeWindow: '1 minute',
    });
  }

  // Stamp X-Request-Id on every response so clients and the audit log can correlate.
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  registerErrorEnvelope(app, options.errorEnvelope);
  attachOpenApiAutoRegistration(app);
  registerOpenApiRoutes(app, options.openApi);

  for (const modulePlugin of options.modules ?? []) {
    await modulePlugin(app);
  }

  return app.withTypeProvider<ZodTypeProvider>();
}

function randomHex(len: number): string {
  const bytes = new Uint8Array(len);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
