// Content schema upgrader — feature 014 / R5 / T026.
//
// Walks a content envelope and upgrades it in place to the current schema
// version. Each upgrade step is keyed by the version number it produces;
// the upgrader chains steps until `schema_version === CURRENT_SCHEMA_VERSION`.
//
// v1 → v2: migrate legacy Puck DropZone `zones` maps into slot props on
// Row/Columns (Puck 0.20+).

import {
  CURRENT_SCHEMA_VERSION,
  type ContentEnvelope,
  type PuckDataTree,
} from '@b2b/cms-components/schema/envelope';
import { migratePuckTreeZonesToSlots } from '@b2b/cms-components/schema/migrate-slots';

export class CmsSchemaUpgradeFailedError extends Error {
  override readonly name = 'CmsSchemaUpgradeFailedError';
  constructor(public readonly fromVersion: number, public readonly currentVersion: number) {
    super(
      `Cannot upgrade content envelope from schema_version=${fromVersion} ` +
        `(current is ${currentVersion}); the deploy is older than the data on disk.`,
    );
  }
}

type UpgradeStep = (input: ContentEnvelope) => ContentEnvelope;

function upgradeLanguagesToSlots(languages: ContentEnvelope['languages']): ContentEnvelope['languages'] {
  const next: ContentEnvelope['languages'] = {};
  for (const [lang, tree] of Object.entries(languages)) {
    next[lang] = migratePuckTreeZonesToSlots(tree as PuckDataTree);
  }
  return next;
}

const UPGRADERS: Record<number, UpgradeStep | undefined> = {
  // 0 → 1: introduce the schema_version field. The envelope shape is the
  // same; we just stamp the version.
  0: (env) => ({ schema_version: 1, languages: env.languages }),
  // 1 → 2: migrate legacy DropZone zones into slot props.
  1: (env) => ({
    schema_version: 2,
    languages: upgradeLanguagesToSlots(env.languages),
  }),
};

/**
 * Upgrade a possibly-stale content envelope to the current version. Throws
 * `CmsSchemaUpgradeFailedError` when the envelope is from a *future* version
 * (i.e., the deploy is older than the data).
 */
export function upgrade(envInput: unknown): ContentEnvelope {
  const env = normalize(envInput);
  let cur = env;
  while (cur.schema_version < CURRENT_SCHEMA_VERSION) {
    const step = UPGRADERS[cur.schema_version];
    if (!step) {
      throw new CmsSchemaUpgradeFailedError(cur.schema_version, CURRENT_SCHEMA_VERSION);
    }
    cur = step(cur);
  }
  if (cur.schema_version > CURRENT_SCHEMA_VERSION) {
    throw new CmsSchemaUpgradeFailedError(cur.schema_version, CURRENT_SCHEMA_VERSION);
  }
  return cur;
}

function normalize(input: unknown): ContentEnvelope {
  if (input === null || input === undefined) {
    return { schema_version: 0, languages: {} };
  }
  if (typeof input !== 'object') {
    return { schema_version: 0, languages: {} };
  }
  const obj = input as Record<string, unknown>;
  const schemaVersion =
    typeof obj['schema_version'] === 'number' ? (obj['schema_version'] as number) : 0;
  const languages =
    obj['languages'] && typeof obj['languages'] === 'object'
      ? (obj['languages'] as Record<string, unknown>)
      : {};
  return { schema_version: schemaVersion, languages: languages as ContentEnvelope['languages'] };
}
