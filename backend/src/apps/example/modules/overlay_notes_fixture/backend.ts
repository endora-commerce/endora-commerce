import type { EntityManager } from '@mikro-orm/postgresql';
import type { MergeParticipant, MergeStepInput } from '@endora-commerce/contracts';
import type { Command, CommandBus } from '@endora-commerce/platform/commands';
import type { ModuleContext, RequireAdminFactory } from '@endora-commerce/platform/kernel';

import { overlayNotesFixtureOrganizationColumns } from './columns.js';
import { OverlayFixtureNote } from './entities/overlay-fixture-note.entity.js';

/**
 * Every entity this overlay module owns — what the platform's ORM configuration
 * registers for it (`overlay-schema-discovery.md` §1). A class under
 * `entities/` that is not here is refused at discovery.
 */
export const entities = [OverlayFixtureNote];

/**
 * The columns this module declares on another module's table, read and held to
 * V9 – V11 by the platform as an installed package's are (FR-065).
 */
export const schemaExtensions = [overlayNotesFixtureOrganizationColumns];

/** The one route — the API surface its off-state test proves absent (FR-046). */
export const OVERLAY_NOTES_FIXTURE_NOTES_ROUTE = '/api/v1/admin/overlay-notes-fixture/notes';

interface OverlayNotesFixtureCradle {
  readonly requireAdmin: RequireAdminFactory;
  readonly emFactory: () => EntityManager;
  readonly commandBus: Pick<CommandBus, 'run'>;
}

/** One batch of the Organization merge: the loser's notes, re-pointed to the survivor (`specs/192-organization-merge/` FR-045). */
function makeNotesMergeReassignCommand(input: MergeStepInput): Command<{ moved: number }> {
  return {
    action: 'overlay_notes_fixture.merge_reassign',
    objectType: input.hostType,
    objectId: input.survivorId,
    run: async ({ em }) => {
      const rows = await em.find(
        OverlayFixtureNote,
        { organizationId: input.loserId },
        { orderBy: { id: 'asc' }, limit: Math.max(1, input.batchSize) },
      );
      if (rows.length === 0) return { result: { moved: 0 }, skipAudit: true };
      for (const row of rows) row.organizationId = input.survivorId;
      await em.flush();
      const ids = rows.map((row) => row.id);
      return { result: { moved: ids.length }, before: null, after: { mergeId: input.mergeId, loserId: input.loserId, moved: ids.length, ids } };
    },
  };
}

/**
 * One gated read over the module's own table (`specs/190-overlay-full-modules/`
 * FR-046, T092). It counts the notes the caller's tenant context can see, so
 * the off-state test reads the rows the module keeps while off through the
 * module's own surface once it is back on. Registered through `ctx.routes`,
 * which applies the lifecycle gate at the seam.
 */
export function registerModule(ctx: ModuleContext): void {
  const cradle = (): OverlayNotesFixtureCradle => ctx.cradle<OverlayNotesFixtureCradle>();
  const notesParticipant: MergeParticipant<'organization'> = {
    host: 'organization',
    preview: async (input) => ({
      counts: {
        'OverlayFixtureNote.organizationId': await cradle().emFactory().fork({ clear: true }).count(OverlayFixtureNote, { organizationId: input.loserId }),
      },
      conflicts: [],
      warnings: [],
      refusals: [],
    }),
    applyBatch: async (input) => cradle().commandBus.run(makeNotesMergeReassignCommand(input)),
  };
  ctx.merge.participate('organization', 'notes', notesParticipant);

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
