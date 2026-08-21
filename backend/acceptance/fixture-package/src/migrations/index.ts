// The package's `./migrations` entry point.
//
// A package hands the host an ordered list of its own migration classes; the
// host slots that chain into its execution order at the module's topological
// position (D-107 / feature 081). Timestamps order a module's own migrations
// and nothing else, so this array is this package's whole ordering statement.

import { Migration20260821T120000AcceptanceProbeInit } from './20260821T120000_acceptance_probe_init.js';

export const migrations = [
  {
    name: 'Migration20260821T120000AcceptanceProbeInit',
    class: Migration20260821T120000AcceptanceProbeInit,
  },
] as const;

export { Migration20260821T120000AcceptanceProbeInit };
