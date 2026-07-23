import type { RouteOptions } from 'fastify';

declare module 'fastify' {
  interface FastifyContextConfig {
    /**
     * Marks a route whose payload is a binary/file stream (PDF, CSV, image,
     * XML download). Post-phase interceptors targeting such routes are
     * rejected at boot validation (feature 060).
     */
    streamingResponse?: boolean;
  }
}

/** What boot validation and dispatch need to know about one mounted route. */
export interface RouteTableEntry {
  readonly identity: string;
  readonly streamingResponse: boolean;
}

/** Routes whose payload is not interceptable and that never appear in the table. */
const EXCLUDED_URLS = new Set(['/api/v1/_openapi.json', '/api/v1/_docs']);

/**
 * Collects every mounted route's endpoint identity via a Fastify `onRoute`
 * hook (feature 060). `onRoute` hooks are inherited by encapsulated child
 * contexts, so routes mounted inside `defineModuleRoutes` wrappers are
 * covered uniformly. The identity key — `"<METHOD> <pattern>"` — matches
 * both the OpenAPI auto-registration dedupe key and what
 * `request.routeOptions` yields at dispatch time.
 */
export class RouteTable {
  #map = new Map<string, RouteTableEntry>();

  /** Bound listener — pass directly to `app.addHook('onRoute', ...)`. */
  readonly onRouteListener = (route: RouteOptions): void => {
    if (EXCLUDED_URLS.has(route.url)) return;
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    const streamingResponse =
      (route.config as { streamingResponse?: unknown } | undefined)?.streamingResponse === true;
    for (const m of methods) {
      const method = String(m).toUpperCase();
      // Fastify auto-registers a HEAD mirror for every GET; it is not an
      // interceptable endpoint identity of its own.
      if (method === 'HEAD') continue;
      const identity = `${method} ${route.url}`;
      this.#map.set(identity, { identity, streamingResponse });
    }
  };

  has(identity: string): boolean {
    return this.#map.has(identity);
  }

  get(identity: string): RouteTableEntry | undefined {
    return this.#map.get(identity);
  }

  entries(): readonly RouteTableEntry[] {
    return [...this.#map.values()];
  }
}
