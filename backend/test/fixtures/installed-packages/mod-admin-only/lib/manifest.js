// An admin-only module: no `./backend`, no `./migrations`, nothing to own. Its
// `exports` map is the package's own statement that it declares no schema and
// no registration, which is why the loader reads it as *readable and empty*
// rather than as a package it failed to read.
export const manifest = {
  id: 'fixture_admin_only',
  name: 'Fixture Admin Only',
  version: '1.0.0',
};

export default manifest;
