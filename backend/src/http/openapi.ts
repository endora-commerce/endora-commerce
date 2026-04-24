import type { FastifyInstance } from 'fastify';
import { OpenApiGeneratorV31, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import type { OpenAPIV3_1 } from 'openapi-types';

/**
 * Shared OpenAPI registry. Modules call `openApiRegistry.register(...)` during bootstrap
 * so the live OpenAPI document served at /api/v1/_openapi.json is always generated from
 * the same Zod schemas the Fastify routes validate against (R-05, Principle V).
 */
export const openApiRegistry = new OpenAPIRegistry();

export interface OpenApiMetadata {
  title: string;
  version: string;
  serverUrl: string;
}

function buildDocument(meta: OpenApiMetadata): OpenAPIV3_1.Document {
  const generator = new OpenApiGeneratorV31(openApiRegistry.definitions);
  const doc = generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: meta.title,
      version: meta.version,
      description:
        'B2B Platform API. Generated at runtime from the Zod schemas in @b2b/contracts. ' +
        'Source of truth: specs/001-b2b-platform-foundation/contracts/.',
    },
    servers: [{ url: meta.serverUrl }],
  });
  return doc as unknown as OpenAPIV3_1.Document;
}

export function registerOpenApiRoutes(app: FastifyInstance, meta: OpenApiMetadata): void {
  // Lazily build the document on first request; registry may still receive registrations
  // during route-registration time.
  let cached: OpenAPIV3_1.Document | undefined;
  const getDoc = (): OpenAPIV3_1.Document => {
    if (!cached) {
      cached = buildDocument(meta);
    }
    return cached;
  };

  app.get('/api/v1/_openapi.json', async (_req, reply) => {
    reply.header('Content-Type', 'application/json').send(getDoc());
  });

  app.get('/api/v1/_docs', async (_req, reply) => {
    // Minimal HTML shell rendering the spec via Swagger UI hosted on a CDN.
    // Intentionally not adding a swagger-ui dependency (Principle IV) since this is dev-only.
    reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .send(
        `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>B2B Platform API</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist/swagger-ui.css"/>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => SwaggerUIBundle({ url: '/api/v1/_openapi.json', dom_id: '#swagger-ui' });
  </script>
</body>
</html>`,
      );
  });
}
