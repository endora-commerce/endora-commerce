import { OverlayFixtureNote } from './entities/overlay-fixture-note.entity.js';

/**
 * Every entity this overlay module owns — what the platform's ORM configuration
 * registers for it (`overlay-schema-discovery.md` §1). A class under
 * `entities/` that is not here is refused at discovery.
 */
export const entities = [OverlayFixtureNote];

/** Composes nothing: the table is the whole of this fixture (see `manifest.ts`). */
export function registerModule(): void {}
