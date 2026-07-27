import type { FastifyBaseLogger, FastifyRequest } from 'fastify';

/**
 * API Interceptor mechanism (feature 060).
 *
 * Modules register pre/post interceptors against HTTP endpoints owned by
 * other modules, identified by the stable `"<METHOD> <route pattern>"`
 * endpoint identity (the same key the OpenAPI auto-registration dedupes on).
 *
 * Contract: specs/060-api-interceptor/contracts/interceptor-registry.md
 * Docs:     docs/docs/architecture/api-interceptor.md
 */

export type InterceptorPhase = 'pre' | 'post';

/** Read-only view of the intercepted request, shared by both phases. */
export interface InterceptorRequestInfo {
  /** Concrete HTTP method of this request (uppercase). */
  readonly method: string;
  /** Concrete request URL (with real params, query string included). */
  readonly url: string;
  /** The endpoint identity that matched, e.g. `POST /api/v1/orders`. */
  readonly identity: string;
  readonly headers: FastifyRequest['headers'];
  /** Child logger pre-bound with `{interceptorModule, interceptorId, phase}` attribution. */
  readonly log: FastifyBaseLogger;
  /**
   * The underlying Fastify request — exposes `request.actor`,
   * `request.salesChannel`, etc. where the composition decorates them.
   * Treat as read-only: interceptors adjust request data ONLY through the
   * pre-phase `body` mechanism, never by mutating the raw request.
   */
  readonly raw: FastifyRequest;
}

export interface PreInterceptorContext {
  readonly request: InterceptorRequestInfo;
  /** The VALIDATED request body (post-Zod). Mutate it or return a replacement. */
  body: unknown;
  readonly query: unknown;
  readonly params: unknown;
}

export interface PostInterceptorContext {
  readonly request: InterceptorRequestInfo;
  /** Always < 400 — post interceptors never run on error responses. */
  readonly statusCode: number;
  /** The un-serialized response payload produced by the endpoint (or a previous interceptor). */
  readonly payload: unknown;
}

/**
 * Pre-phase handler. Runs after the route's own preHandler guards
 * (auth/authz) and after schema validation, immediately before the handler.
 * Veto by throwing `HttpError` with a registered `ErrorCode`; any other
 * throw is a failure and yields 500 INTERNAL (fail-closed).
 */
export type PreInterceptorHandler = (
  ctx: PreInterceptorContext,
) => void | { body?: unknown } | Promise<void | { body?: unknown }>;

/**
 * Post-phase handler. Runs at preSerialization for successful responses.
 * Return the replacement payload, or `undefined` to leave it unchanged.
 * MUST be side-effect-free with respect to persistence — the endpoint's
 * own write may already be committed when a post interceptor runs.
 */
export type PostInterceptorHandler = (ctx: PostInterceptorContext) => unknown | Promise<unknown>;

interface InterceptorRegistrationBase {
  /** Owning module id — execution is lifecycle-gated on this module's enabled state. */
  module: string;
  /** Unique within the module (kebab-case by convention). */
  id: string;
  /** One or more endpoint identities, `"<METHOD> <route pattern>"`. */
  target: string | string[];
  /** Ascending execution order; default 0. Ties break on (module, id) lexicographic. */
  order?: number;
}

export type InterceptorRegistration =
  | (InterceptorRegistrationBase & { phase: 'pre'; handler: PreInterceptorHandler })
  | (InterceptorRegistrationBase & { phase: 'post'; handler: PostInterceptorHandler });

/** A registration normalized by the registry (targets resolved, order defaulted). */
export interface ResolvedRegistration {
  readonly module: string;
  readonly id: string;
  readonly phase: InterceptorPhase;
  readonly order: number;
  readonly targets: readonly string[];
  readonly handler: PreInterceptorHandler | PostInterceptorHandler;
}

/** One row of the execution plan exposed by `ApiInterceptorRegistry.list()`. */
export interface InterceptorListItem {
  readonly target: string;
  readonly phase: InterceptorPhase;
  readonly order: number;
  readonly module: string;
  readonly id: string;
}
