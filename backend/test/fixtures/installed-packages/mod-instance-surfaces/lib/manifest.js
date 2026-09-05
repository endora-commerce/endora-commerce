// The package's root export. A published manifest is a plain object: a
// third-party author has no `@endora-commerce/contracts` to import at runtime,
// which is why the two artefacts an instance generates locate this file through
// the `exports` map rather than by searching for `defineModuleManifest(`.
export const manifest = {
  id: 'fixture_instance_surfaces',
  name: 'Fixture Instance Surfaces',
  version: '1.0.0',
  dependencies: [],
  docs: { dir: 'docs' },
};

export default manifest;
