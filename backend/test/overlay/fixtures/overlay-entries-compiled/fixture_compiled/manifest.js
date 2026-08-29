// A compiled overlay module — the shape `backend/dist/apps/<deployment>/modules/<id>/`
// holds after `pnpm --filter backend run build`.
//
// Deliberately committed as JavaScript rather than emitted by the test: the
// defect it stands for is the loader spelling `manifest.ts` / `backend.ts` into
// an `existsSync`, so a fixture shipping `.ts` files cannot reach it (issue
// #130 — a fixture has to enter above the thing under test).
export const manifest = {
  id: 'fixture_compiled',
  name: 'Compiled overlay fixture',
  version: '4.5.6',
  dependencies: [],
};
