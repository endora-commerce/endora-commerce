import {
  composeCrawlerFile,
  type AdminCrawlerFile,
  type AdminCrawlerFilePreview,
} from '@endora-commerce/contracts';

/**
 * What the preview of a crawler file — `robots.txt` or `llms.txt` — shows, as
 * a function of what it was given
 * (`specs/144-seo-search-engine-robots/contracts/admin-surfaces.md` §4).
 *
 * No React and no I/O: the row's props, the answer of the preview endpoint and
 * the channel being previewed go in, and a description of the screen comes out
 * — which blocks, which notices, in which order. The component
 * (`CrawlerFilePreview.tsx`) draws it and decides nothing.
 *
 * ## One model for both files
 *
 * The two previews are the same screen: one block that is the served file, the
 * operator's lines marked inside it. They differ in two places, both below.
 * `robots.txt` is always served, and on a channel kept out of search the
 * preview explains why it stays open. `llms.txt` is withdrawn on such a
 * channel, and the preview then says so **in place of** a file nobody is
 * served.
 *
 * ## One rule for the join, and it is not written here
 *
 * The file is `composeCrawlerFile(base, operatorPart)` — the function the
 * storefront serves with. The screen shows that file as one block, and the
 * stretches it marks inside the block are **cut out of that function's own
 * output** rather than assembled beside it, so the preview cannot come to
 * disagree with the served file about a line break, a byte order mark or a
 * trailing blank line.
 */

/** The setting the `robots.txt` preview sits beside. */
export const ROBOTS_TXT_CUSTOM_SETTING_CODE = 'seo.robots_txt_custom';
/** The setting the `llms.txt` preview sits beside. */
export const LLMS_TXT_ADDITIONAL_SETTING_CODE = 'seo.llms_txt_additional';
/** The setting whose row carries the outdated-storefront notice. */
export const DEFAULT_ROBOTS_SETTING_CODE = 'seo.default_robots';

/** What the row editor hands a contribution. */
export interface PreviewRowProps {
  /** The sales channel being edited, or `null` for the all-channels value. */
  readonly channelCode: string | null;
  /** The text in the field, saved or not. */
  readonly draftText: string | null;
  /** Whether that text differs from what is stored. */
  readonly dirty: boolean;
}

/** Where the request for the storefront's part stands. */
export type PreviewRequest =
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  | { readonly status: 'ready'; readonly data: AdminCrawlerFilePreview };

export type PreviewNoticeKind =
  /** The storefront did not confirm that it joins the operator's text to its rules. */
  | 'storefront-outdated'
  | 'storefront-unreachable'
  | 'address-unknown'
  /** The preview endpoint itself did not answer. */
  | 'preview-failed'
  /** `NOINDEX` channel: the file stays open on purpose. */
  | 'stays-open'
  /** `NOINDEX` channel, and the operator's text closes the site to every crawler. */
  | 'site-wide-disallow'
  /** `llms.txt`: none is served, because the channel's default robots forbids indexing. */
  | 'llms-not-served-noindex'
  /** `llms.txt`: the storefront serves none, though the saved default robots allows indexing. */
  | 'llms-not-served'
  /** The address is the deployment-wide one, shared by every channel. */
  | 'shared-address'
  /** All-channels mode: these channels have a value of their own. */
  | 'channels-with-own-value'
  /** All-channels mode: the previewed channel has a value of its own. */
  | 'previewed-channel-has-own-value';

export interface PreviewNotice {
  readonly kind: PreviewNoticeKind;
  /**
   * `warning` — something will not happen the way the operator may expect;
   * `info` — context. Never carried by colour alone: every notice is a
   * sentence, and the component gives each tone an icon.
   */
  readonly tone: 'info' | 'warning';
  /** The channel codes a notice names, when it names any. */
  readonly channels?: readonly string[];
}

/**
 * One stretch of the file. `system` is what the storefront generates,
 * `operator` what the operator wrote, `separator` the blank line the join puts
 * between them.
 */
export interface PreviewFileSegment {
  readonly kind: 'system' | 'separator' | 'operator';
  readonly text: string;
}

/** The file, whole, and the same file cut into the stretches it is made of. */
export interface PreviewFile {
  /** Exactly what the storefront serves, or will once the field is saved. */
  readonly text: string;
  /** In order; their texts joined are {@link PreviewFile.text}, to the byte. */
  readonly segments: readonly PreviewFileSegment[];
}

export interface PreviewModel {
  /** `channel` — the row is edited for one channel; `all-channels` — for all. */
  readonly mode: 'channel' | 'all-channels';
  /** The channel whose file is shown, once known. */
  readonly previewedChannel: string | null;
  /** The storefront's part is still being asked for. */
  readonly loading: boolean;
  /**
   * What the shown file is: `after-saving` — it includes text that is not
   * saved yet; `served-now` — it is what the storefront serves at this moment;
   * `unknown` — there is no file to show; `not-served` — there is no file,
   * because the storefront serves none for the channel (`llms.txt` only).
   */
  readonly shows: 'after-saving' | 'served-now' | 'unknown' | 'not-served';
  /**
   * The file, or `null` when the storefront's rules were not obtained — never
   * a remembered or example text (FR-042).
   */
  readonly file: PreviewFile | null;
  /**
   * The operator's text as it would be served, shown **apart** from a file:
   * when there is no file to put it in, or when the storefront did not confirm
   * that it serves it. `null` when it is inside {@link PreviewModel.file}.
   */
  readonly detachedOperatorPart: string | null;
  /** The operator's text adds nothing to the file. */
  readonly operatorPartEmpty: boolean;
  /** Whose text the operator's part is. */
  readonly operatorPartOrigin: 'field' | 'saved';
  /** The operator's part is text the storefront does not serve yet. */
  readonly operatorPartUnsaved: boolean;
  /** Address the file is served at, when known. */
  readonly storefrontUrl: string | null;
  readonly notices: readonly PreviewNotice[];
}

/**
 * The preview for one row, from the row's props and the backend's answer.
 *
 * `file` is which file the row's setting shapes. It is the caller's, not read
 * off the answer: the row knows what it is beside before any answer arrives.
 */
export function buildPreviewModel(
  row: PreviewRowProps,
  request: PreviewRequest,
  file: AdminCrawlerFile = 'robots',
): PreviewModel {
  const mode = row.channelCode === null ? 'all-channels' : 'channel';
  const data = request.status === 'ready' ? request.data : null;
  const fieldText = row.draftText ?? '';
  const previewedChannel = data?.salesChannelCode ?? row.channelCode;

  // An all-channels value reaches a channel only while that channel has no
  // value of its own; one that has is shown what it serves, not the field.
  const previewedHasOwnValue =
    mode === 'all-channels' &&
    data !== null &&
    data.channelsWithOwnValue.includes(data.salesChannelCode);
  const operatorPartOrigin = previewedHasOwnValue ? 'saved' : 'field';
  const operatorText = previewedHasOwnValue ? (data?.savedExtra ?? '') : fieldText;
  const operatorPart = servedOperatorPart(operatorText);
  const operatorPartUnsaved = operatorPartOrigin === 'field' && row.dirty;

  // `ok`: the storefront joins the two, so the file is the join. Otherwise, if
  // it answered at all, the file is its answer alone — that is what it serves.
  let previewed: PreviewFile | null = null;
  let detachedOperatorPart: string | null = operatorPart === '' ? null : operatorPart;
  if (data !== null && data.base !== null) {
    if (data.state === 'ok') {
      previewed = previewFile(data.base, operatorText);
      detachedOperatorPart = null;
    } else {
      previewed = previewFile(data.base, '');
    }
  }

  // `llms.txt` is withdrawn on a channel that asks not to be indexed. Either
  // the storefront said it serves none, or the saved policy says it will stop
  // within the minute — in both cases there is no file to promise, and the
  // sentence stands in place of one. The operator's text is not drawn apart
  // either: it is in the field, and here it would read as part of something
  // served.
  const notServed =
    file === 'llms' && data !== null && (data.state === 'not-served' || !data.policy.index);
  if (notServed) {
    previewed = null;
    detachedOperatorPart = null;
  }
  const shows: PreviewModel['shows'] = notServed
    ? 'not-served'
    : previewed === null
      ? 'unknown'
      : data?.state === 'ok' && operatorPartUnsaved
        ? 'after-saving'
        : 'served-now';

  const notices: PreviewNotice[] = [];
  if (request.status === 'failed') notices.push({ kind: 'preview-failed', tone: 'warning' });
  if (data !== null) {
    if (data.state === 'storefront-outdated') {
      notices.push({ kind: 'storefront-outdated', tone: 'warning' });
    }
    if (data.state === 'storefront-unreachable') {
      notices.push({ kind: 'storefront-unreachable', tone: 'warning' });
    }
    if (data.state === 'address-unknown') {
      notices.push({ kind: 'address-unknown', tone: 'warning' });
    }
  }
  if (previewedHasOwnValue) {
    notices.push({ kind: 'previewed-channel-has-own-value', tone: 'info' });
  }
  if (mode === 'all-channels' && data !== null && data.channelsWithOwnValue.length > 0) {
    notices.push({
      kind: 'channels-with-own-value',
      tone: 'info',
      channels: [...data.channelsWithOwnValue],
    });
  }
  if (notServed && data !== null) {
    // Which sentence depends on whether the saved setting explains it. When it
    // does not — the storefront has not caught up with a change, or sees no
    // `seo` — the setting is not blamed for it.
    notices.push({
      kind: data.policy.index ? 'llms-not-served' : 'llms-not-served-noindex',
      tone: 'info',
    });
  }
  if (file === 'robots' && data !== null && !data.policy.index) {
    notices.push({ kind: 'stays-open', tone: 'info' });
    if (closesSiteToEveryCrawler(operatorText)) {
      notices.push({ kind: 'site-wide-disallow', tone: 'warning' });
    }
  }
  if (data !== null && data.storefront.source === 'env' && data.state !== 'address-unknown') {
    notices.push({ kind: 'shared-address', tone: 'info' });
  }

  return {
    mode,
    previewedChannel,
    loading: request.status === 'loading',
    shows,
    file: previewed,
    detachedOperatorPart,
    operatorPartEmpty: operatorPart === '',
    operatorPartOrigin,
    operatorPartUnsaved,
    storefrontUrl:
      data !== null && data.storefront.source !== 'fallback' ? data.storefront.url : null,
    notices,
  };
}

/**
 * The file `composeCrawlerFile(base, operatorText)` answers, and the stretches
 * it is made of.
 *
 * The stretches are cut out of that function's own output, so joining them
 * gives the file back to the byte — which is what lets the screen draw the two
 * parts differently inside one block without ever drawing a different file.
 */
export function previewFile(base: string, operatorText: string): PreviewFile {
  const text = composeCrawlerFile(base, operatorText);
  const operator = servedOperatorPart(operatorText);
  if (operator === '') return { text, segments: [{ kind: 'system', text }] };
  const system = servedSystemPart(base, operatorText);
  // system, the join, operator, the closing line break — nothing else.
  return {
    text,
    segments: [
      { kind: 'system', text: `${system}\n` },
      { kind: 'separator', text: '\n' },
      { kind: 'operator', text: `${operator}\n` },
    ],
  };
}

/**
 * The operator's text as the file carries it: line breaks as line feeds, one
 * leading byte order mark dropped, no line break at the end — or `''` when the
 * text adds nothing.
 *
 * Read off `composeCrawlerFile`'s output. Composed onto an empty base, the
 * function answers the base unchanged when the text adds nothing, and
 * otherwise a blank line, the text and one closing line break — so what is
 * between those is the text exactly as served.
 */
export function servedOperatorPart(operatorText: string): string {
  const tail = composeCrawlerFile('', operatorText);
  return tail === '' ? '' : tail.slice(JOIN.length, tail.length - 1);
}

/**
 * The storefront's rules as the file carries them beside `operatorText`: the
 * base itself when the text adds nothing, and the base without the line
 * breaks it ends with when the text follows it.
 */
export function servedSystemPart(base: string, operatorText: string): string {
  const composed = composeCrawlerFile(base, operatorText);
  const tail = composeCrawlerFile('', operatorText);
  return tail === '' ? composed : composed.slice(0, composed.length - tail.length);
}

/** What `composeCrawlerFile` puts between the two parts. */
const JOIN = '\n\n';

/**
 * Whether the text tells **every** crawler to fetch nothing: a `Disallow: /`
 * (or `Disallow: /*`) in a group that names `*`.
 *
 * This is a caution, not a parser of record, so it leans towards speaking up:
 * rules written before any `User-agent` line are counted as well, because in
 * the served file they follow the storefront's own `User-agent: *` group.
 * A `Disallow: /` for one named crawler is that operator's business and is
 * not flagged.
 */
export function closesSiteToEveryCrawler(operatorText: string): boolean {
  // Before the first `User-agent` line the rules attach to the group above,
  // which names `*`. Whether the current group names `*` is all that is kept:
  // a list of its agents, copied per line and searched per rule, made a long
  // group quadratic (issue #612).
  let groupNamesEveryCrawler = true;
  let lastWasAgent = false;
  for (const rawLine of operatorText.split(/\r\n?|\n/)) {
    const line = stripComment(rawLine).trim();
    if (line === '') continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === 'user-agent') {
      // Consecutive `User-agent` lines name one group.
      groupNamesEveryCrawler = (lastWasAgent && groupNamesEveryCrawler) || value === '*';
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    // `/*` is the same ban spelled with a wildcard.
    if (field === 'disallow' && (value === '/' || value === '/*') && groupNamesEveryCrawler) {
      return true;
    }
  }
  return false;
}

function stripComment(line: string): string {
  const hash = line.indexOf('#');
  return hash < 0 ? line : line.slice(0, hash);
}

// ---------------------------------------------------------------------------
// The notice on the *Default robots* row
// ---------------------------------------------------------------------------

/** One channel's answer, for the *Default robots* row. */
export interface ChannelPreviewRequest {
  readonly request: PreviewRequest;
}

/**
 * The channels whose storefront did not confirm that it supports the `seo`
 * crawler settings — and may therefore not apply *Default robots*.
 *
 * The row shows a notice for these and nothing otherwise — not while loading,
 * not when a storefront cannot be reached, not when the endpoint fails: the
 * notice says one thing, and says it only on evidence. The channel is named
 * from the answer, which is what knows which channel a request without a code
 * was about.
 */
export function outdatedStorefrontChannels(
  requests: readonly ChannelPreviewRequest[],
): readonly string[] {
  const codes: string[] = [];
  for (const { request } of requests) {
    if (request.status !== 'ready' || request.data.state !== 'storefront-outdated') continue;
    if (!codes.includes(request.data.salesChannelCode)) codes.push(request.data.salesChannelCode);
  }
  return codes;
}

/**
 * How many channels the *Default robots* row asks about when it is edited for
 * all channels. Each one is a request the backend makes to a storefront, so
 * the number is bounded; an instance with more channels is told about the
 * first ones, and each channel's own view asks about that channel.
 */
export const DEFAULT_ROBOTS_NOTICE_MAX_CHANNELS = 5;
