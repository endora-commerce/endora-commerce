import type { ScopeRef, ScopedValuesData } from '@endora-commerce/contracts';

/**
 * Feature 170 (T092, `contracts/editor-ui.md` §1–§2) — the editor scope in the address and
 * in words.
 *
 * `?scope=global|channel|cl&channel=<uuid>&language=<code>` is the source of truth. A URL
 * that names no scope is seeded from the editor preference; one naming a scope the product
 * no longer has falls back along the chain C×L → C → G.
 */

export type ValidScopes = ScopedValuesData['validScopes'];
type Translate = (key: string, params?: Record<string, string>) => string;

/** The scope a URL names, or `null` when it names none (or an unreadable one). */
export function scopeFromSearch(search: URLSearchParams): ScopeRef | null {
  const level = search.get('scope');
  const channelId = search.get('channel');
  const languageCode = search.get('language');
  if (level === 'global') return { level: 'global' };
  if (level === 'channel' && channelId) return { level: 'channel', channelId };
  if (level === 'cl' && channelId && languageCode) return { level: 'channel_language', channelId, languageCode };
  return null;
}

/** A copy of `search` naming `scope`; every other parameter (tab, field) is kept. */
export function searchWithScope(search: URLSearchParams, scope: ScopeRef): URLSearchParams {
  const next = new URLSearchParams(search);
  next.delete('channel');
  next.delete('language');
  if (scope.level === 'global') next.set('scope', 'global');
  else if (scope.level === 'channel') {
    next.set('scope', 'channel');
    next.set('channel', scope.channelId);
  } else {
    next.set('scope', 'cl');
    next.set('channel', scope.channelId);
    next.set('language', scope.languageCode);
  }
  return next;
}

export function sameScope(a: ScopeRef, b: ScopeRef): boolean {
  if (a.level !== b.level) return false;
  if (a.level === 'global') return true;
  if (a.channelId !== (b as { channelId: string }).channelId) return false;
  return a.level === 'channel' || a.languageCode.toLowerCase() === (b as { languageCode: string }).languageCode.toLowerCase();
}

/** The scope a field inherits from: the channel at C×L, Global at C. */
export function parentScope(scope: ScopeRef): ScopeRef {
  return scope.level === 'channel_language' ? { level: 'channel', channelId: scope.channelId } : { level: 'global' };
}

/** The next wider scope on the chain, or `null` at Global. */
export function widerScope(scope: ScopeRef): ScopeRef | null {
  return scope.level === 'global' ? null : parentScope(scope);
}

/** Whether `scope` is one of the product's valid scopes. */
export function isValidScope(scope: ScopeRef, valid: ValidScopes): boolean {
  if (scope.level === 'global') return true;
  const channel = valid.channels.find((c) => c.channelId === scope.channelId);
  if (!channel) return false;
  return scope.level === 'channel' || channel.languages.some((l) => l.code.toLowerCase() === scope.languageCode.toLowerCase());
}

/** The nearest valid scope on the chain C×L → C → G. */
export function nearestValidScope(scope: ScopeRef, valid: ValidScopes): ScopeRef {
  let current: ScopeRef | null = scope;
  while (current) {
    if (isValidScope(current, valid)) return current;
    current = widerScope(current);
  }
  return { level: 'global' };
}

export function channelName(valid: ValidScopes, channelId: string): string {
  return valid.channels.find((c) => c.channelId === channelId)?.name ?? channelId.slice(0, 8);
}

/** A language by name: the read's own name, else `Intl.DisplayNames` in the admin's language, else the code. */
export function languageName(valid: ValidScopes, channelId: string | null, code: string, adminLanguage: string): string {
  for (const channel of valid.channels) {
    if (channelId !== null && channel.channelId !== channelId) continue;
    const found = channel.languages.find((l) => l.code.toLowerCase() === code.toLowerCase());
    if (found?.name) return found.name;
  }
  try {
    const names = new Intl.DisplayNames([adminLanguage], { type: 'language' });
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

/** "Global" · "B2B PL — all languages" · "B2B PL × Polish" (§2). */
export function scopeInWords(scope: ScopeRef, valid: ValidScopes, t: Translate, adminLanguage: string): string {
  if (scope.level === 'global') return t('productEditor.scope.global');
  const channel = channelName(valid, scope.channelId);
  if (scope.level === 'channel') return t('productEditor.scope.channelAllLanguages', { channel });
  return t('productEditor.scope.channelLanguage', {
    channel,
    language: languageName(valid, scope.channelId, scope.languageCode, adminLanguage),
  });
}

/** The short form a source line names: "Global", "B2B PL", "B2B PL × Polish". */
export function scopeShortWords(scope: ScopeRef, valid: ValidScopes, t: Translate, adminLanguage: string): string {
  if (scope.level === 'channel') return channelName(valid, scope.channelId);
  return scopeInWords(scope, valid, t, adminLanguage);
}

/** A stable string key of a scope, for comparing and memoising. */
export function scopeKey(scope: ScopeRef): string {
  if (scope.level === 'global') return 'G';
  if (scope.level === 'channel') return `C:${scope.channelId}`;
  return `CL:${scope.channelId}:${scope.languageCode.toLowerCase()}`;
}
