import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findRepoRoot } from './module-roots.js';

/** Locale list for the documentation site — `docs/locales.config.json` (FR-025). */
export interface DocsLocalesConfig {
  readonly defaultLocale: string;
  readonly locales: readonly string[];
  readonly translateLocales: readonly string[];
}

function defaultConfigPath(): string {
  const repoRoot = findRepoRoot(fileURLToPath(new URL('.', import.meta.url)));
  if (repoRoot === null) {
    throw new Error('[docs-locales] could not locate repository root from pnpm-workspace.yaml.');
  }
  return join(repoRoot, 'docs/locales.config.json');
}

/** Read and parse the documentation locale configuration. */
export function loadDocsLocales(configPath: string = defaultConfigPath()): DocsLocalesConfig {
  const raw = JSON.parse(readFileSync(configPath, 'utf8')) as DocsLocalesConfig;
  if (
    typeof raw.defaultLocale !== 'string' ||
    !Array.isArray(raw.locales) ||
    !Array.isArray(raw.translateLocales)
  ) {
    throw new Error(
      `[docs-locales] ${configPath} must declare defaultLocale, locales and translateLocales.`,
    );
  }
  return raw;
}
