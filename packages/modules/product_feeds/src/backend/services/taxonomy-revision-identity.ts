import { createHash } from 'node:crypto';
import type { TaxonomyProviderCode } from '@endora-commerce/contracts';
import type { TaxonomyNodeDraft } from './taxonomy-file-parser.js';

/**
 * Revision identity — feature 067 / FR-088, research §R20.
 *
 * Three stages, in cost order, because the overwhelmingly common outcome of a
 * weekly check is "nothing changed" (51 weeks out of 52):
 *
 *  1. **Content hash** — `sha256` per language over BOM/newline-normalised
 *     bytes, combined as `sha256("<en>:<pl>")` and uniquely indexed per
 *     provider. Equal hash ⇒ unchanged, stop. One pass over ~1.5 MB.
 *  2. **Label rule** — Google's own stamped label where there is one; a derived
 *     `YYYY-MM-DD-<hash8>` where there is none (Meta publishes nothing). The
 *     date keeps the list readable, the hash prefix keeps two fetches on the
 *     same day distinguishable. The prefix is a **disambiguator, never the
 *     identity**: identity is stage 1 and stage 3.
 *  3. **Node-set equality** against the newest installed revision — the
 *     authoritative comparison. A provider re-serving the same taxonomy through
 *     a different CDN edge, with a trailing newline added or a BOM re-encoded,
 *     produces a different hash and an identical taxonomy; installing that puts
 *     a row in front of the operator whose impact preview reads "0 changes",
 *     which is noise that trains people to promote without reading. Stage 3
 *     makes *changed* mean what the operator thinks it means: the tree differs.
 *
 * `ETag` / `Last-Modified` are used as a bandwidth optimisation only, never as
 * identity: both endpoints sit behind CDNs that rewrite validators, and a `304`
 * says nothing about whether the tree changed.
 */

/** The `revision` column is `varchar(32)`; a label must fit it. */
const MAX_REVISION_LENGTH = 32;

/** Strip a UTF-8 BOM and normalise CRLF → LF, then nothing else. */
export function normaliseTaxonomyContent(content: string): string {
  return content.replace(/^﻿/, '').replace(/\r\n/g, '\n');
}

export function taxonomyContentHash(content: string): string {
  return createHash('sha256').update(normaliseTaxonomyContent(content), 'utf8').digest('hex');
}

/** `sha256("<en-hash>:<pl-hash>")` — the per-revision content identity. */
export function combineContentHashes(...perLanguageHashes: string[]): string {
  return createHash('sha256').update(perLanguageHashes.join(':'), 'utf8').digest('hex');
}

/** `YYYY-MM-DD` in UTC, matching how the bundled Meta revision was labelled. */
function isoDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export function deriveRevisionLabel(input: {
  providerCode: TaxonomyProviderCode;
  /** Google's `# Google_Product_Taxonomy_Version:` value, or null. */
  headerLabel: string | null;
  contentHash: string;
  fetchedAt: Date;
}): string {
  const stamped = input.headerLabel?.trim();
  // Where the provider publishes a label, use it: an operator debugging a
  // Merchant Center rejection needs to say "we are on Google's 2021-09-21", not
  // "we are on our revision 4".
  if (stamped) return stamped.slice(0, MAX_REVISION_LENGTH);
  return `${isoDate(input.fetchedAt)}-${input.contentHash.slice(0, 8)}`.slice(
    0,
    MAX_REVISION_LENGTH,
  );
}

/**
 * An installed revision is **immutable** — mappings, checks and audit entries
 * reference it — so republished content under a label already installed is
 * never written in place. It installs as `<label>-r2`, `-r3`, … instead.
 */
export function withCollisionSuffix(label: string, taken: ReadonlySet<string>): string {
  if (!taken.has(label)) return label;
  for (let revision = 2; revision < 100; revision += 1) {
    const suffix = `-r${revision}`;
    const candidate = `${label.slice(0, MAX_REVISION_LENGTH - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  // 98 republications under one label is not a case worth a fourth strategy;
  // the caller records this as a rejected check rather than guessing.
  throw new Error(`No free revision label remains for "${label}".`);
}

export interface InstalledNodeIdentity {
  externalId: string;
  parentExternalId: string | null;
  /** The authoritative language's full path — a rename must count as a change. */
  fullPath: string;
}

/**
 * `unchanged` iff the candidate's `(externalId, parentExternalId, fullPath)` set
 * equals the newest installed revision's. Nothing installed to compare against
 * ⇒ `changed`, because there is nothing this could be a duplicate of.
 */
export function compareToInstalledNodeSet(
  candidate: readonly TaxonomyNodeDraft[],
  installed: readonly InstalledNodeIdentity[],
  authoritativeLanguage = 'en',
): 'unchanged' | 'changed' {
  if (installed.length === 0) return 'changed';
  if (installed.length !== candidate.length) return 'changed';

  const key = (id: string, parent: string | null, path: string): string =>
    `${id}\0${parent ?? ''}\0${path}`;

  const installedKeys = new Set(
    installed.map((node) => key(node.externalId, node.parentExternalId, node.fullPath)),
  );
  for (const node of candidate) {
    const path =
      node.fullPath[authoritativeLanguage] ??
      Object.values(node.fullPath).find((value) => value !== '') ??
      '';
    if (!installedKeys.has(key(node.externalId, node.parentExternalId, path))) return 'changed';
  }
  return 'unchanged';
}
