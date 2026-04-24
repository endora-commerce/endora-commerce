// Backend entry point.
// Real boot wiring (Fastify instance, MikroORM init, event bus, workers) is introduced in
// Phase 2 (Foundational) of tasks.md — see specs/001-b2b-platform-foundation/tasks.md.

import { createLogger } from './http/logger.js';

async function main(): Promise<void> {
  const logger = createLogger();
  logger.info({ phase: 'bootstrap' }, 'backend stub starting');
  logger.warn(
    'backend is scaffolded but not yet functional — Phase 2 tasks T015..T042 wire the HTTP layer, ORM, auth, events, and webhooks.',
  );
}

void main();
