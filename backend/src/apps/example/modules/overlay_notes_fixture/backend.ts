import type { EntityManager } from '@mikro-orm/postgresql';
import type { ModuleContext, RequireAdminFactory } from '@endora-commerce/platform/kernel';

import { OverlayFixtureNote } from './entities/overlay-fixture-note.entity.js';

/**
 * Every entity this overlay module owns — what the platform's ORM configuration
 * registers for it (`overlay-schema-discovery.md` §1). A class under
 * `entities/` that is not here is refused at discovery.
 */
export const entities = [OverlayFixtureNote];

/** The one route — the API surface its off-state test proves absent (FR-046). */
export const OVERLAY_NOTES_FIXTURE_NOTES_ROUTE = '/api/v1/admin/overlay-notes-fixture/notes';

interface OverlayNotesFixtureCradle {
  readonly requireAdmin: RequireAdminFactory;
  readonly emFactory: () => EntityManager;
}

/**
 * One gated read over the module's own table (`specs/190-overlay-full-modules/`
 * FR-046, T092). It counts the notes the caller's tenant context can see, so
 * the off-state test reads the rows the module keeps while off through the
 * module's own surface once it is back on. Registered through `ctx.routes`,
 * which applies the lifecycle gate at the seam.
 */
export function registerModule(ctx: ModuleContext): void {
  ctx.routes(async (app) => {
    app.get(
      OVERLAY_NOTES_FIXTURE_NOTES_ROUTE,
      { preHandler: ctx.cradle<OverlayNotesFixtureCradle>().requireAdmin('overlay_notes_fixture:read') },
      async () => ({
        notes: await ctx.cradle<OverlayNotesFixtureCradle>().emFactory().count(OverlayFixtureNote, {}),
      }),
    );
  });
}
