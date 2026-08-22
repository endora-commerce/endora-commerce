/**
 * `_i18n coverage` — the translation-coverage snapshot (feature 021), as a
 * host-run command (feature 080, T042b / D-160.9).
 *
 * Prints the same payload the admin route returns. Useful for developers and
 * for CI; in `--strict` mode it exits non-zero when any module in the filtered
 * set has `missingCount > 0`.
 *
 * Flags:
 *   --json                Emit JSON (default: human-readable table)
 *   --strict              Exit 1 when any missingCount > 0 for the filtered set
 *   --modules a,b,c       Filter by module id (repeatable as CSV)
 *   --languages pl,en     Filter by supported admin language code (repeatable as CSV)
 *   --include-keys all    Match the route's includeKeys=all
 */
import { SUPPORTED_LANGUAGES, type SupportedAdminLanguage } from '@endora-commerce/contracts';
import type { ModuleCliCommandContext } from '@endora-commerce/contracts';
import { lazyPort, type ModuleContext } from '../../../kernel/index.js';
import type { I18nService } from '../services/i18n-service.js';

interface ParsedArgs {
  json: boolean;
  strict: boolean;
  modules?: string[];
  languages?: SupportedAdminLanguage[];
  includeKeys?: 'all' | 'missing';
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = { json: false, strict: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] as string;
    if (a === '--json') out.json = true;
    else if (a === '--strict') out.strict = true;
    else if (a === '--modules' || a === '--module') {
      out.modules = (argv[i + 1] ?? '').split(',').filter(Boolean);
      i += 1;
    } else if (a === '--languages' || a === '--language') {
      const supported = new Set<string>(SUPPORTED_LANGUAGES);
      out.languages = (argv[i + 1] ?? '')
        .split(',')
        .filter((v) => supported.has(v)) as SupportedAdminLanguage[];
      i += 1;
    } else if (a === '--include-keys') {
      const v = argv[i + 1];
      if (v === 'all' || v === 'missing') out.includeKeys = v;
      i += 1;
    }
  }
  return out;
}

interface CoverageSnapshot {
  capturedAt: string;
  modules: ReadonlyArray<{
    moduleId: string;
    languages: ReadonlyArray<{
      languageCode: string;
      missingCount: number;
      fellBackToEnCount: number;
    }>;
  }>;
}

function printTable(snapshot: CoverageSnapshot, out: (line: string) => void): void {
  out(`Coverage snapshot @ ${snapshot.capturedAt}`);
  if (snapshot.modules.length === 0) {
    out('  (no modules in the filtered set)');
    return;
  }
  for (const m of snapshot.modules) {
    out(`  ${m.moduleId}`);
    for (const l of m.languages) {
      out(
        `    ${l.languageCode}  missing=${String(l.missingCount).padStart(3, ' ')}  ` +
          `fellBackToEn=${String(l.fellBackToEnCount).padStart(3, ' ')}`,
      );
    }
  }
}

export async function coverage({
  ctx,
  argv,
  out,
  err,
}: ModuleCliCommandContext<ModuleContext>): Promise<number> {
  const args = parseArgs(argv);
  // This module's own port, resolved exactly as `backend.ts` resolves it — one
  // `I18nService` for the composition rather than a second one built here.
  const i18nService = lazyPort<I18nService>(ctx, 'adminI18nService');

  const snapshot = await i18nService.getCoverageSnapshot({
    ...(args.modules ? { moduleIds: args.modules } : {}),
    ...(args.languages ? { languageCodes: args.languages } : {}),
    ...(args.includeKeys ? { includeKeys: args.includeKeys } : {}),
  });

  if (args.json) out(JSON.stringify({ data: snapshot }, null, 2));
  else printTable(snapshot, out);

  if (args.strict) {
    const violators = snapshot.modules.flatMap((m) =>
      m.languages.filter((l) => l.missingCount > 0).map((l) => ({ m, l })),
    );
    if (violators.length > 0) {
      err(
        `[i18n coverage] strict mode: ${violators.length} (module, language) pair(s) are ` +
          `missing entries.`,
      );
      return 1;
    }
  }
  return 0;
}
