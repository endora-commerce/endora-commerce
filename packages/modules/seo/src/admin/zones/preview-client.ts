import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type {
  AdminCrawlerFile,
  AdminCrawlerFilePreviewResponse,
  SalesChannelListResponse,
} from '@endora-commerce/contracts';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import type { PreviewRequest } from './preview-model.js';

/**
 * What the contributions beside `seo`'s settings ask the backend, and the one
 * place they ask it from.
 *
 * The preview beside *Custom robots.txt instructions* and the notice on the
 * *Default robots* row both need the same answer for the same sales channel,
 * and each answer costs a request from the backend to a storefront. So the
 * answer is held here for both to read: two rows on one screen are one
 * request, not two. The preview beside *Additional llms.txt content* asks
 * about the other file, and its answers are held the same way under their own
 * key.
 *
 * **When the backend is asked** — when what a row previews changes (the
 * channel, or the page going between "all channels" and one channel), when a
 * row asks again, and when any of the three rows stops being dirty, which is a
 * save or a reset — every answer carries the channel's saved default robots,
 * and whether an `llms.txt` exists at all follows from it. **Typing never asks**: the operator's part of the preview comes from
 * the field, in the browser, and is sent nowhere.
 *
 * **What is kept** — the answer for a channel, in this tab's memory, for as
 * long as a row on the screen is showing that channel in that editing mode and
 * no longer. A request that starts drops the answer it replaces, and what
 * nobody is showing is forgotten — so rules, and the fact that a channel has a
 * value of its own, are never shown as current while a newer answer is on its
 * way, after it failed to arrive, or on a later visit (FR-042).
 */

/** How the page is being edited: for one channel, or for all of them. */
export type PreviewMode = 'channel' | 'all-channels';

/**
 * The channel to ask about, when no code is known: the request names none and
 * the backend answers for the system default channel.
 */
export const SYSTEM_DEFAULT_CHANNEL = '';

const LOADING: PreviewRequest = { status: 'loading' };
const FAILED: PreviewRequest = { status: 'failed' };

interface Entry {
  readonly file: AdminCrawlerFile;
  readonly salesChannelCode: string;
  request: PreviewRequest;
  /** How many mounted rows are showing this answer. */
  readers: number;
  /** The backend has been asked at least once for this entry. */
  asked: boolean;
  inFlight: boolean;
  /** A reload was asked for while one was in flight; run one more after it. */
  again: boolean;
}

/**
 * By file, editing mode **and** channel. The mode is part of the key so that going
 * from "all channels" to a channel and back never finds an answer from before:
 * what was saved in between — a channel gaining or losing a value of its own —
 * is exactly what the earlier answer does not know.
 */
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();

const keyOf = (file: AdminCrawlerFile, mode: PreviewMode, salesChannelCode: string): string =>
  `${file}\n${mode}\n${salesChannelCode}`;

/** Bumped on every change; what a reader of several entries subscribes to. */
let version = 0;

function notify(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function getVersion(): number {
  return version;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A fixed path and fixed parameter names; the channel is a code the server validates. */
function previewPath(file: AdminCrawlerFile, salesChannelCode: string): string {
  const query = new URLSearchParams({ file });
  if (salesChannelCode !== SYSTEM_DEFAULT_CHANNEL) query.set('salesChannelCode', salesChannelCode);
  return `/api/v1/admin/seo/crawler-files/preview?${query.toString()}`;
}

/** A row starts showing an answer. Returns what to call when it stops. */
function watch(key: string, file: AdminCrawlerFile, salesChannelCode: string): () => void {
  let entry = entries.get(key);
  if (entry === undefined) {
    entry = {
      file,
      salesChannelCode,
      request: LOADING,
      readers: 0,
      asked: false,
      inFlight: false,
      again: false,
    };
    entries.set(key, entry);
  }
  entry.readers += 1;
  const watched = entry;
  return () => {
    watched.readers -= 1;
    if (watched.readers === 0 && entries.get(key) === watched) entries.delete(key);
  };
}

/** Ask the backend for the entry at `key`, unless it is being asked already. */
function load(key: string): void {
  const entry = entries.get(key);
  // Nobody is showing it any more.
  if (entry === undefined) return;
  if (entry.inFlight) {
    entry.again = true;
    return;
  }
  entry.asked = true;
  entry.inFlight = true;
  entry.again = false;
  // The answer being replaced is dropped now, not when the new one arrives.
  entry.request = LOADING;
  notify();
  // Fire-and-forget: a failure is mapped to FAILED by the first `then`.
  void apiClient
    .get<AdminCrawlerFilePreviewResponse>(previewPath(entry.file, entry.salesChannelCode))
    .then(
      (response): PreviewRequest => ({ status: 'ready', data: response.data }),
      (): PreviewRequest => FAILED,
    )
    .then((request) => {
      entry.inFlight = false;
      // The rows that asked have gone; the answer is nobody's.
      if (entries.get(key) !== entry) return;
      entry.request = request;
      notify();
      if (entry.again) load(key);
    });
}

let reloadScheduled = false;

/**
 * Ask again about everything a mounted row is showing, of either file.
 *
 * Coalesced: saving several rows at once makes each of them call this in the
 * same tick, and that is one round of requests, not one per row.
 */
export function reloadCrawlerPreviews(): void {
  if (reloadScheduled) return;
  reloadScheduled = true;
  queueMicrotask(() => {
    reloadScheduled = false;
    for (const key of [...entries.keys()]) load(key);
  });
}

function requestAt(key: string | null): PreviewRequest {
  if (key === null) return LOADING;
  return entries.get(key)?.request ?? LOADING;
}

/**
 * How long a newly previewed channel waits before the backend is asked, so
 * that moving through the channel list does not ask about every channel passed
 * on the way.
 */
const CHANNEL_CHANGE_DELAY_MS = 250;

/** Watch `file` for the channels in `mode`, and ask about the ones nobody has asked about yet. */
function useWatched(
  file: AdminCrawlerFile,
  mode: PreviewMode,
  salesChannelCodes: readonly string[] | null,
): void {
  // `null` — nothing to watch yet. A list is joined so the effect depends on a value.
  const joined = salesChannelCodes === null ? null : salesChannelCodes.join('\n');
  useEffect(() => {
    if (joined === null) return undefined;
    const codes = joined.split('\n');
    const keys = codes.map((code) => keyOf(file, mode, code));
    const stops = keys.map((key, index) => watch(key, file, codes[index] as string));
    const timer = setTimeout(() => {
      for (const key of keys) {
        if (entries.get(key)?.asked === false) load(key);
      }
    }, CHANNEL_CHANGE_DELAY_MS);
    return (): void => {
      clearTimeout(timer);
      for (const stop of stops) stop();
    };
  }, [file, mode, joined]);
}

/**
 * The preview answer for one file of one channel in one editing mode.
 *
 * `salesChannelCode`: a code, {@link SYSTEM_DEFAULT_CHANNEL} for "whichever
 * channel is the default", or `null` to ask nothing yet (reads as loading).
 */
export function useCrawlerFilePreview(
  file: AdminCrawlerFile,
  mode: PreviewMode,
  salesChannelCode: string | null,
): {
  readonly request: PreviewRequest;
  readonly reload: () => void;
} {
  const key = salesChannelCode === null ? null : keyOf(file, mode, salesChannelCode);
  const request = useSyncExternalStore(
    subscribe,
    () => requestAt(key),
    () => LOADING,
  );
  useWatched(file, mode, salesChannelCode === null ? null : [salesChannelCode]);
  const reload = useCallback((): void => {
    if (key !== null) load(key);
  }, [key]);
  return { request, reload };
}

/**
 * The `robots.txt` answers for several channels at once, for the *Default
 * robots* row. That file and no other: it is the one every storefront has, so
 * its answer is the one that shows whether a storefront supports the feature.
 */
export function useRobotsPreviews(
  mode: PreviewMode,
  salesChannelCodes: readonly string[] | null,
): readonly { readonly request: PreviewRequest }[] {
  // Several entries have no single stable snapshot, so this subscribes to the
  // store's version and reads the entries afresh on each render.
  useSyncExternalStore(subscribe, getVersion, getVersion);
  useWatched('robots', mode, salesChannelCodes);
  return (salesChannelCodes ?? []).map((code) => ({
    request: requestAt(keyOf('robots', mode, code)),
  }));
}

// ---------------------------------------------------------------------------
// The sales channels, for the all-channels row
// ---------------------------------------------------------------------------

export interface PreviewChannel {
  readonly code: string;
  readonly systemDefault: boolean;
}

export type PreviewChannels =
  | { readonly status: 'loading'; readonly items: readonly PreviewChannel[] }
  | { readonly status: 'ready'; readonly items: readonly PreviewChannel[] };

const CHANNELS_LOADING: PreviewChannels = { status: 'loading', items: [] };
let channels: PreviewChannels = CHANNELS_LOADING;
let channelsAsked = false;

const CHANNELS_PAGE_SIZE = 100;
/** A bound on the walk, not on the instance: 2 000 channels. */
const CHANNELS_MAX_PAGES = 20;

/**
 * Every sales channel the Settings screen offers, the system default first.
 *
 * The same population as the screen's own channel selector — active or not —
 * so the preview never offers fewer channels than the page it sits on, and
 * every page of the list is read rather than the first one.
 *
 * `GET /api/v1/admin/sales-channels` and its response type are an HTTP path
 * and a `@endora-commerce/contracts` type — the exit the Settings screen takes
 * for that selector, and no dependency on another module's code. An
 * administrator who may not list channels gets an empty list, and the preview
 * then asks about the system default channel without naming it.
 */
async function fetchChannels(): Promise<readonly PreviewChannel[]> {
  const found: PreviewChannel[] = [];
  for (let page = 0; page < CHANNELS_MAX_PAGES; page += 1) {
    const response = await apiClient.get<SalesChannelListResponse>(
      `/api/v1/admin/sales-channels?activeOnly=false&pageSize=${CHANNELS_PAGE_SIZE}&page=${page}`,
    );
    for (const item of response.items) {
      found.push({ code: item.code, systemDefault: item.systemDefault });
    }
    if (response.items.length === 0 || found.length >= response.total) break;
  }
  return found.sort(
    (left, right) =>
      Number(right.systemDefault) - Number(left.systemDefault) ||
      left.code.localeCompare(right.code),
  );
}

/** How many mounted rows want the list. */
let channelReaders = 0;
/** Told apart from an answer to an earlier round of readers. */
let channelsRound = 0;

/**
 * A row starts wanting the list. Returns what to call when it stops.
 *
 * The list is kept while a row on the screen wants it and forgotten when the
 * last one goes, on the terms the answers above are kept: coming back to the
 * Settings screen asks again, so a channel created meanwhile is offered.
 */
function watchChannels(): () => void {
  channelReaders += 1;
  if (!channelsAsked) {
    channelsAsked = true;
    const round = channelsRound;
    // Fire-and-forget: the rejection is answered by the `catch` below.
    void fetchChannels()
      // Somebody who may not list channels: an empty list, and the preview
      // asks about the system default channel without naming it.
      .catch((): readonly PreviewChannel[] => [])
      .then((items) => {
        if (round !== channelsRound) return;
        channels = { status: 'ready', items };
        notify();
      });
  }
  return () => {
    channelReaders -= 1;
    if (channelReaders > 0) return;
    channelsRound += 1;
    channelsAsked = false;
    channels = CHANNELS_LOADING;
  };
}

/** The channels to offer, asked for only when `wanted`. */
export function usePreviewChannels(wanted: boolean): PreviewChannels {
  const value = useSyncExternalStore(
    subscribe,
    () => channels,
    () => CHANNELS_LOADING,
  );
  useEffect(() => (wanted ? watchChannels() : undefined), [wanted]);
  return wanted ? value : CHANNELS_LOADING;
}
