// Fixture: the shape `loadOverlayModuleEntries` composes.
import type { ModuleContext } from '../../../../../src/kernel/index.js';

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({ fixtureComposedMarker: ctx.asValue('composed') });
}
