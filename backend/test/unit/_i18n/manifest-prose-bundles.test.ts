import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SUPPORTED_LANGUAGES } from '@endora-commerce/contracts';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';

/**
 * Issue #1809 — the prose a module's manifest declares, in every shipped
 * language.
 *
 * Platform → Modules names, describes and explains each module, and the
 * transactional-e-mail list names and describes each e-mail, in the language
 * the response is read in: the backend reads the translation from the
 * declaring module's own bundle and keeps the manifest's English when there is
 * none (`specs/conventions/module-i18n.md`, case 1). A silent English fallback
 * is exactly what the issue reported, so this file is what keeps one from
 * coming back: every registered module ships the keys in every language, and
 * the English entry is the manifest's own sentence, so the two cannot drift.
 *
 * Keys: `module.name`, `module.description`, `module.nonDeactivatableReason`
 * (`packages/platform/src/lifecycle/module-text.ts`), and
 * `transactionalEmails.<code>.name` / `.description` (the e-mail's
 * `nonDeactivatable` reason lives in the sending module's registered defaults,
 * so its pair is pinned beside those defaults, in that module).
 */
/**
 * A registered module's bundle in one language, read from where its manifest
 * declares it. Read as plain JSON rather than through `_i18n`'s loader: the
 * subject is every module's files, not the loader, whose own shape test is
 * `registered-bundles-shape.test.ts`.
 */
function bundleOf(entry: (typeof REGISTERED_MANIFESTS)[number], language: string): Record<string, string> | undefined {
  const path = join(dirname(entry.filePath), entry.manifest.i18n!.bundlesDir, `${language}.json`);
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>) : undefined;
}

interface Expected {
  readonly key: string;
  readonly english: string;
}

function expectedOf(entry: (typeof REGISTERED_MANIFESTS)[number]): Expected[] {
  const { manifest } = entry;
  const out: Expected[] = [{ key: 'module.name', english: manifest.name }];
  if (manifest.description) out.push({ key: 'module.description', english: manifest.description });
  const activation = manifest.activation;
  if (activation && 'nonDeactivatable' in activation) {
    out.push({ key: 'module.nonDeactivatableReason', english: activation.reason });
  }
  for (const email of manifest.transactionalEmails ?? []) {
    out.push({ key: `transactionalEmails.${email.code}.name`, english: email.name });
    if (email.description) {
      out.push({ key: `transactionalEmails.${email.code}.description`, english: email.description });
    }
  }
  return out;
}

describe('manifest prose in every shipped language (issue #1809)', () => {
  it('reads every registered module (sanity)', () => {
    expect(REGISTERED_MANIFESTS.length).toBeGreaterThan(60);
  });

  it.each(REGISTERED_MANIFESTS.map((entry) => [entry.manifest.id, entry] as const))(
    'module "%s" ships its manifest prose in English and Polish',
    (_id, entry) => {
      expect(entry.manifest.i18n, 'declares no bundles directory').toBeDefined();
      const problems: string[] = [];
      for (const { key, english } of expectedOf(entry)) {
        const en = bundleOf(entry, 'en')?.[key];
        if (en !== english) problems.push(`en.json ${key}: ${JSON.stringify(en)} is not the manifest's ${JSON.stringify(english)}`);
        for (const language of SUPPORTED_LANGUAGES) {
          if (language === 'en') continue;
          const text = bundleOf(entry, language)?.[key];
          if (!text || text.trim() === '') problems.push(`${language}.json ${key}: missing`);
        }
      }
      expect(problems).toEqual([]);
    },
  );
});
