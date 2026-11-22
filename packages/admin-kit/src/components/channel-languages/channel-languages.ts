import { useEffect, useState } from 'react';
import { fetchScopeSalesChannel, listScopeSalesChannels } from '../scope-picker/sales-channels-api.js';

/**
 * The content languages the shop's sales channels offer, and how a screen
 * that names something per language turns them into fields (issue #1507, UX
 * audit CAT-05; architect ruling Q3 of 2026-11-21).
 *
 * **The offer is the union of the active sales channels' languages.** A
 * category, a product content document or a newsletter campaign is not bound
 * to one channel where it is edited, so every channel's languages together are
 * what the storefront can show it in (Tesler: the operator does not keep a
 * second, hard-coded list in step with the channels). The hook moved here from
 * `newsletter`'s admin (issue #1463) so `catalog` reads the same list without
 * reaching into another module's code (constitution I).
 *
 * **A stored translation in a language no channel offers stays visible,
 * read-only and flagged** (`outside`): deleting it would lose data the
 * operator may still want once a channel offers the language again, and
 * editing it would author text no storefront shows.
 */

/** Every active channel's languages together, de-duplicated and sorted. Rejects when the list cannot be read. */
export async function loadChannelLanguages(): Promise<string[]> {
  const res = await listScopeSalesChannels();
  const perChannel = await Promise.all(
    res.items.map((channel) =>
      fetchScopeSalesChannel(channel.code)
        // A channel whose detail cannot be read still offers its default language.
        .then((detail) => (detail.languages?.length ? detail.languages : [channel.defaultLanguage]))
        .catch(() => [channel.defaultLanguage]),
    ),
  );
  return Array.from(new Set(perChannel.flat().filter((code): code is string => Boolean(code)))).sort();
}

export interface ChannelLanguagesState {
  /** The channels' languages (plus `current`, when given), sorted. */
  languages: string[];
  /** `loading` until the channels have been read; `failed` when their list could not be. */
  status: 'loading' | 'ready' | 'failed';
}

/**
 * The channels' content languages for a picker or a per-language form.
 *
 * `current` is always included, so a stored language no channel offers any
 * more still shows as what it is rather than being replaced by the first
 * option (the newsletter campaign's language select). A list that cannot be
 * read at all offers `current` alone, with `status: 'failed'`.
 */
export function useChannelLanguages(current?: string): ChannelLanguagesState {
  const [state, setState] = useState<{ languages: string[]; status: ChannelLanguagesState['status'] }>({
    languages: [],
    status: 'loading',
  });

  useEffect(() => {
    let live = true;
    loadChannelLanguages()
      .then((languages) => {
        if (live) setState({ languages, status: 'ready' });
      })
      .catch(() => {
        if (live) setState({ languages: [], status: 'failed' });
      });
    return () => {
      live = false;
    };
  }, []);

  const languages = Array.from(new Set([...state.languages, ...(current ? [current] : [])])).sort();
  return { languages, status: state.status };
}

/** Why an offer could not follow the channels, or `null` when it does. */
export type ContentLanguageOfferDegraded = 'loading' | 'failed' | 'noChannels' | null;

export interface ContentLanguageOffer {
  /** The languages a value may be written in, in display order. */
  editable: string[];
  /** Stored languages no channel offers: shown read-only and flagged, never dropped. */
  outside: string[];
  /** Set when the offer fell back to the stored languages (plus the fallback). */
  degraded: ContentLanguageOfferDegraded;
}

/**
 * Splits what a record stores against what the channels offer.
 *
 * - The channels' languages are `editable`, in their order; a stored key that
 *   differs from one only in case is used as stored, so an edit writes the key
 *   the record already has.
 * - A stored key no channel offers is `outside`.
 * - While the channels are not known (`loading` / `failed`) or offer nothing
 *   (`noChannels`), the stored languages plus `fallback` (typically the
 *   admin's own locale) are editable and nothing is flagged: the screen says
 *   why instead of leaving the operator with no field at all.
 */
export function offerContentLanguages(
  channels: Pick<ChannelLanguagesState, 'languages' | 'status'>,
  stored: readonly string[],
  fallback: readonly string[] = [],
): ContentLanguageOffer {
  const unique = (codes: readonly string[]): string[] => Array.from(new Set(codes.filter(Boolean)));
  if (channels.status !== 'ready' || channels.languages.length === 0) {
    return {
      editable: unique([...stored, ...fallback]),
      outside: [],
      degraded: channels.status === 'ready' ? 'noChannels' : channels.status,
    };
  }
  const storedByLower = new Map(stored.map((code) => [code.toLowerCase(), code]));
  const editable = unique(channels.languages.map((code) => storedByLower.get(code.toLowerCase()) ?? code));
  const offered = new Set(editable.map((code) => code.toLowerCase()));
  const outside = unique(stored.filter((code) => !offered.has(code.toLowerCase())));
  return { editable, outside, degraded: null };
}

/** A language code by name in the admin's language (`en-US` → "English (United States)"), else the code. */
export function contentLanguageName(code: string, adminLanguage: string): string {
  try {
    return new Intl.DisplayNames([adminLanguage], { type: 'language', languageDisplay: 'standard' }).of(code) ?? code;
  } catch {
    return code;
  }
}
