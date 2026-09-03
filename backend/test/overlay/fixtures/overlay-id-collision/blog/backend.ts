// Fixture: composable, so the refusal is reached before anything registers.
import type { ModuleContext } from '../../../../../src/kernel/index.js';

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({ fixtureCollidingBlogMarker: ctx.asValue('collided') });
}
