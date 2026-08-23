import type {
  FastifyReply,
  FastifyRequest,
  RouteOptions,
  preHandlerHookHandler,
} from 'fastify';
import { HttpError } from '../error-envelope.js';
import type { ApiInterceptorRegistry } from './registry.js';
import type {
  InterceptorRequestInfo,
  PostInterceptorHandler,
  PreInterceptorHandler,
  ResolvedRegistration,
} from './types.js';

/**
 * Runtime dispatch for API interceptors (feature 060).
 *
 * Pre phase: an `onRoute` hook appends a dispatch function to the END of each
 * route's `preHandler` chain, so pre-interceptors run after the route's own
 * auth/authz guards and after Zod validation, immediately before the handler.
 * (An app-level `preHandler` hook would run BEFORE route-level guards — that
 * ordering would let interceptors run on unauthorized requests.)
 *
 * Post phase: a global `preSerialization` hook reshapes successful (<400)
 * object payloads. Streaming/Buffer/string payloads bypass Fastify
 * serialization entirely, so post-interceptors never touch them.
 */

function requestIdentity(request: FastifyRequest): string {
  return `${request.method.toUpperCase()} ${request.routeOptions.url ?? request.url}`;
}

function requestInfo(
  request: FastifyRequest,
  identity: string,
  reg: ResolvedRegistration,
): InterceptorRequestInfo {
  return {
    method: request.method.toUpperCase(),
    url: request.url,
    identity,
    headers: request.headers,
    log: request.log.child({
      interceptorModule: reg.module,
      interceptorId: reg.id,
      phase: reg.phase,
      interceptorTarget: identity,
    }),
    raw: request,
  };
}

/**
 * `onRoute` listener that appends the pre-phase dispatcher to every route.
 * Endpoints with no registered pre-interceptors pay one Map lookup.
 */
export function makePreDispatchOnRoute(
  registry: ApiInterceptorRegistry,
): (route: RouteOptions) => void {
  const dispatchPre: preHandlerHookHandler = async function dispatchApiInterceptorsPre(
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> {
    const identity = requestIdentity(request);
    const entries = registry.preFor(identity);
    if (entries.length === 0) return;
    for (const reg of entries) {
      if (!registry.isModuleEnabled(reg.module)) continue;
      const info = requestInfo(request, identity, reg);
      try {
        const outcome = await (reg.handler as PreInterceptorHandler)({
          request: info,
          body: request.body,
          query: request.query,
          params: request.params,
        });
        if (outcome && typeof outcome === 'object' && 'body' in outcome) {
          request.body = outcome.body;
        }
        info.log.debug('api interceptor (pre) applied');
      } catch (err) {
        if (err instanceof HttpError) {
          // A veto is a normal business outcome, not a failure (FR-003/FR-009).
          info.log.info({ code: err.code, statusCode: err.statusCode }, 'api interceptor vetoed request');
          throw err;
        }
        info.log.error({ err }, 'api interceptor (pre) failed');
        throw err;
      }
    }
  };

  return (route: RouteOptions): void => {
    const existing = route.preHandler;
    const chain = existing === undefined ? [] : Array.isArray(existing) ? [...existing] : [existing];
    chain.push(dispatchPre);
    route.preHandler = chain;
  };
}

/**
 * Global `preSerialization` hook running post-interceptors over successful
 * object payloads. Error responses (>= 400) — including envelopes produced by
 * the error handler — pass through untouched.
 */
export function makePostDispatchPreSerialization(registry: ApiInterceptorRegistry) {
  return async function dispatchApiInterceptorsPost(
    request: FastifyRequest,
    reply: FastifyReply,
    payload: unknown,
  ): Promise<unknown> {
    if (reply.statusCode >= 400) return payload;
    const identity = requestIdentity(request);
    const entries = registry.postFor(identity);
    if (entries.length === 0) return payload;
    let current = payload;
    for (const reg of entries) {
      if (!registry.isModuleEnabled(reg.module)) continue;
      const info = requestInfo(request, identity, reg);
      try {
        const outcome = await (reg.handler as PostInterceptorHandler)({
          request: info,
          statusCode: reply.statusCode,
          payload: current,
        });
        if (outcome !== undefined) current = outcome;
        info.log.debug('api interceptor (post) applied');
      } catch (err) {
        info.log.error({ err }, 'api interceptor (post) failed');
        throw err;
      }
    }
    return current;
  };
}
