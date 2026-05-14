import { initOrm, closeOrm } from '../../../db/index.js';
import { I18nService } from '../services/i18n-service.js';
import {
  SUPPORTED_ADMIN_LANGUAGES,
  type SupportedAdminLanguage,
} from '@b2b/contracts';

/**
 * `pnpm --filter backend run i18n:coverage [flags]` — feature 021.
 *
 * Prints the same coverage payload the admin route returns. Useful for
 * developers + CI; in `--strict` mode exits non-zero when any module in
 * the filtered set has `missingCount > 0`.
 *
 * Flags:
 *   --json                Emit JSON (default: human-readable table)
 *   --strict              Exit 1 when any missingCount > 0 for the filtered set
 *   --modules a,b,c       Filter by module id (repeatable as CSV)
 *   --languages pl,en     Filter by supported admin language code (repeatable as CSV)
 *   --include-keys all    Match the route's includeKeys=all
 */

interface ParsedArgs {
  json: boolean;
  strict: boolean;
  modules?: string[];
  languages?: SupportedAdminLanguage[];
  includeKeys?: 'all' | 'missing';
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = { json: false, strict: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a === '--json') out.json = true;
    else if (a === '--strict') out.strict = true;
    else if (a === '--modules' || a === '--module') {
      out.modules = (argv[i + 1] ?? '').split(',').filter(Boolean);
      i += 1;
    } else if (a === '--languages' || a === '--language') {
      const supported = new Set<string>(SUPPORTED_ADMIN_LANGUAGES);
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

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  const orm = await initOrm();
  try {
    const i18nService = new I18nService({ em: () => orm.em.fork() });
    const snapshot = await i18nService.getCoverageSnapshot({
      ...(args.modules ? { moduleIds: args.modules } : {}),
      ...(args.languages ? { languageCodes: args.languages } : {}),
      ...(args.includeKeys ? { includeKeys: args.includeKeys } : {}),
    });

    if (args.json) {
      process.stdout.write(`${JSON.stringify({ data: snapshot }, null, 2)}\n`);
    } else {
      printTable(snapshot);
    }

    if (args.strict) {
      const violators = snapshot.modules.flatMap((m) =>
        m.languages
          .filter((l) => l.missingCount > 0)
          .map((l) => ({ moduleId: m.moduleId, languageCode: l.languageCode, count: l.missingCount })),
      );
      if (violators.length > 0) {
        process.stderr.write(`\n[i18n:coverage] strict mode: ${violators.length} (module, language) pair(s) are missing entries.\n`);
        process.exitCode = 1;
      }
    }
  } finally {
    await closeOrm();
  }
}

function printTable(snapshot: { capturedAt: string; modules: ReadonlyArray<{ moduleId: string; languages: ReadonlyArray<{ languageCode: string; missingCount: number; fellBackToEnCount: number }> }> }): void {
  process.stdout.write(`Coverage snapshot @ ${snapshot.capturedAt}\n`);
  if (snapshot.modules.length === 0) {
    process.stdout.write('  (no modules in the filtered set)\n');
    return;
  }
  for (const m of snapshot.modules) {
    process.stdout.write(`  ${m.moduleId}\n`);
    for (const l of m.languages) {
      process.stdout.write(
        `    ${l.languageCode}  missing=${String(l.missingCount).padStart(3, ' ')}  fellBackToEn=${String(l.fellBackToEnCount).padStart(3, ' ')}\n`,
      );
    }
  }
}

void main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(2);
});
