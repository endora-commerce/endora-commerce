// A compiled deployment declaration — the shape `backend/dist/apps/<deployment>/`
// holds after `pnpm --filter backend run build`, and the shape an instance holds
// whenever it compiles its own `apps/` tree.
//
// Deliberately committed as JavaScript rather than emitted by the test: what is
// under test is the *file name* the loader looks for, so a `.ts` fixture cannot
// reach it (issue #130 — a fixture has to enter above the thing under test).
export const divergence = {
  omittedModules: [],
  decorationOrder: {},
  reasons: { 'compiled-fixture': 'The declaration this fixture exists to be read from.' },
};
