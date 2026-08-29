// The package's `./backend` entry point, in the shape a compiler emits: the
// entity decorator is applied as an ordinary call, so the decorated source text
// that `generate-composer.ts` and every source-text probe look for appears
// nowhere in the published artefact. This comment does not spell it either —
// the test asserts its absence over the whole file.
import { Entity } from '@mikro-orm/core';

export class FixtureWidget {}

Entity({ tableName: 'fixture_widgets' })(FixtureWidget);

/** Every entity this package owns — what a package-aware ORM config merges. */
export const entities = [FixtureWidget];

export function registerModule(ctx) {
  ctx.di.providePort('fixtureWidgetReadPort', ctx.asFunction(() => ({})).singleton());
  ctx.di.register({ fixtureWidgetRenderers: ctx.asValue([]) });
}
