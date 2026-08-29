// The package's root export. A published manifest is a plain object: a
// third-party author has no `@endora-commerce/contracts` to import at runtime.
export const manifest = {
  id: 'fixture_widgets',
  name: 'Fixture Widgets',
  version: '1.0.0',
  dependencies: ['catalog'],
};

export default manifest;
