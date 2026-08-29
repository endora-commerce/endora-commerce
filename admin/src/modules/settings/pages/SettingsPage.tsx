import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import type {
  SalesChannelSummary,
  SettingDto,
  SettingGroupDto,
} from '@endora-commerce/contracts';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { settingsClient } from '../api/settings-client';
import { salesChannelsClient } from '@/modules/sales_channels/api/sales-channels-client';
import { useTranslation } from '@/i18n/useTranslation';
import { ConflictBanner } from '../components/ConflictBanner';
import { ActivationPointerRow } from '../components/ActivationPointerRow';
import {
  SettingRowEditor,
  computeVersion,
  deriveDisplayValue,
  isDraftDirty,
  parseValue,
  type SettingDraft,
} from '../components/SettingRowEditor';
import { normalize } from '@/lib/text-normalization';

/**
 * Settings page — feature 004 / US2.
 *
 * The page is driven by a single "Editing for" channel context picked at the
 * top: `null` = All channels (default), otherwise a specific sales-channel
 * code. Every row's value input reflects the value for that context (the
 * channel's override, or the default when none exists). Save sends the
 * batch as either `scope: 'all'` or `scope: 'subset', salesChannelCodes: […]`
 * depending on the picker. Edits accumulate in `drafts` and a sticky bottom
 * bar flushes them all at once.
 */
export function SettingsPage(): ReactNode {
  const t = useTranslation('settings');
  const [groups, setGroups] = useState<SettingGroupDto[]>([]);
  const [allChannels, setAllChannels] = useState<SalesChannelSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [resettingCode, setResettingCode] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, SettingDraft>>({});
  const [channelContext, setChannelContext] = useState<string | null>(null);

  const refresh = useCallback(
    async (contextOverride?: string | null): Promise<void> => {
      const contextForRefresh =
        contextOverride === undefined ? channelContext : contextOverride;
      setLoading(true);
      setError(null);
      try {
        const list = await settingsClient.list();
        setGroups(list.groups);
        setDrafts((prev) => mergeDrafts(prev, list.groups, contextForRefresh));
        // Fetch sales channels separately so a permission/connectivity issue
        // here surfaces in the UI instead of silently emptying the dropdown.
        try {
          const channels = await salesChannelsClient.list({
            activeOnly: false,
            pageSize: 100,
          });
          setAllChannels(channels.items);
        } catch (err) {
          setAllChannels([]);
          setError(
            err instanceof ApiError
              ? `Failed to load sales channels: ${err.envelope.error.message}`
              : 'Failed to load sales channels.',
          );
        }
      } catch (err) {
        setError(
          err instanceof ApiError ? err.envelope.error.message : 'Failed to load settings.',
        );
      } finally {
        setLoading(false);
      }
    },
    [channelContext],
  );

  useEffect(() => {
    void refresh();
    // We intentionally only refresh on mount; switchChannelContext drives
    // subsequent refreshes when the context changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ctrl/⌘+Shift+K jumps to the settings filter from anywhere on the page —
  // the settings list is long enough that reaching for the mouse is the slow
  // path. Shift distinguishes it from the global ⌘K palette, which skips the
  // shifted chord (see AppShell's keydown handler).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
      if (e.key.toLowerCase() !== 'k') return;
      e.preventDefault();
      const input = searchRef.current;
      if (!input) return;
      input.focus();
      // Select what's already typed so the next keystroke replaces the
      // previous query instead of appending to it.
      input.select();
    };
    window.addEventListener('keydown', onKey);
    return (): void => window.removeEventListener('keydown', onKey);
  }, []);

  const filteredGroups = useMemo(
    () => filterGroupsForContext(groups, search, channelContext),
    [groups, search, channelContext],
  );

  // `/settings?group=<code>` scrolls to that group and expands it — module
  // pages link here to point an operator at their own settings (e.g. the KSeF
  // page's "Open module settings"). Runs once the groups have rendered; an
  // unknown code is a no-op rather than an error, since the group may belong
  // to a module that is currently disabled.
  const requestedGroup = new URLSearchParams(location.search).get('group');
  useEffect(() => {
    if (!requestedGroup || loading) return;
    const card = document.getElementById(`settings-group-${requestedGroup}`);
    if (!card) return;
    setCollapsed((prev) => ({ ...prev, [requestedGroup]: false }));
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [requestedGroup, loading]);

  const channelOptions = useMemo<ChannelOption[]>(() => {
    const byCode = new Map<string, ChannelOption>();
    for (const c of allChannels) {
      byCode.set(c.code, { code: c.code, label: channelLabel(c) });
    }
    for (const g of groups) {
      for (const c of g.salesChannelCodes) {
        if (!byCode.has(c)) byCode.set(c, { code: c, label: c });
      }
      for (const s of g.settings) {
        for (const c of s.salesChannelCodes) {
          if (!byCode.has(c)) byCode.set(c, { code: c, label: c });
        }
        for (const v of s.valuesByChannel) {
          if (!byCode.has(v.salesChannelCode)) {
            byCode.set(v.salesChannelCode, { code: v.salesChannelCode, label: v.salesChannelCode });
          }
        }
      }
    }
    return Array.from(byCode.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [allChannels, groups]);

  const allCollapsed = useMemo(
    () => filteredGroups.length > 0 && filteredGroups.every((g) => collapsed[g.code]),
    [collapsed, filteredGroups],
  );

  const toggleGroup = (code: string): void => {
    setCollapsed((prev) => ({ ...prev, [code]: !prev[code] }));
  };

  const toggleAll = (): void => {
    const next = !allCollapsed;
    setCollapsed((prev) => {
      const out = { ...prev };
      for (const g of filteredGroups) out[g.code] = next;
      return out;
    });
  };

  const patchDraft = useCallback(
    (code: string, patch: Partial<SettingDraft>): void => {
      setDrafts((prev) => {
        const current = prev[code];
        if (!current) return prev;
        return { ...prev, [code]: { ...current, ...patch } };
      });
    },
    [],
  );

  const onCopyCode = useCallback(async (code: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      window.setTimeout(() => {
        setCopiedCode((current) => (current === code ? null : current));
      }, 1500);
    } catch {
      setError('Failed to copy to clipboard.');
    }
  }, []);

  const dirtyCountFor = useCallback(
    (group: SettingGroupDto): number => {
      let n = 0;
      for (const s of group.settings) {
        if (!isSaveable(s)) continue;
        const d = drafts[s.code];
        if (d && isDraftDirty(d)) n += 1;
      }
      return n;
    },
    [drafts],
  );

  const allDirtySettings = useMemo<SettingDto[]>(() => {
    const out: SettingDto[] = [];
    for (const g of groups) {
      for (const s of g.settings) {
        // Feature 073: a row belonging to a switched-off module, and a module's
        // activation control, are both excluded from the batch — the first
        // because the server refuses it, the second because it has its own
        // audited endpoint. Counting them would put a "save 1 change" bar on
        // screen for a write that can never happen.
        if (!isSaveable(s)) continue;
        const d = drafts[s.code];
        if (d && isDraftDirty(d)) out.push(s);
      }
    }
    return out;
  }, [drafts, groups]);

  const totalDirtyCount = allDirtySettings.length;

  const discardAll = useCallback((): void => {
    setDrafts(() => {
      const out: Record<string, SettingDraft> = {};
      for (const g of groups) {
        for (const s of g.settings) {
          out[s.code] = baselineDraft(s, channelContext);
        }
      }
      return out;
    });
    setConflicts({});
  }, [groups, channelContext]);

  const switchChannelContext = useCallback(
    (next: string | null): void => {
      if (next === channelContext) return;
      if (totalDirtyCount > 0) {
        const ok = window.confirm(t('context.discardOnSwitch'));
        if (!ok) return;
      }
      setChannelContext(next);
      setConflicts({});
      // Re-baseline every draft for the new context.
      setDrafts(() => {
        const out: Record<string, SettingDraft> = {};
        for (const g of groups) {
          for (const s of g.settings) out[s.code] = baselineDraft(s, next);
        }
        return out;
      });
    },
    [channelContext, groups, t, totalDirtyCount],
  );

  const findSetting = useCallback(
    (code: string): SettingDto | undefined => {
      for (const g of groups) {
        for (const s of g.settings) if (s.code === code) return s;
      }
      return undefined;
    },
    [groups],
  );

  const saveAll = useCallback(async (): Promise<void> => {
    if (allDirtySettings.length === 0) return;
    setSaving(true);
    setError(null);
    setInfo(null);
    const newConflicts: Record<string, string> = {};
    const savedCodes = new Set<string>();

    for (const s of allDirtySettings) {
      const draft = drafts[s.code];
      if (!draft) continue;
      try {
        const value = parseValue(s.valueType, draft.text);
        const expectedVersion = computeVersion(s);
        if (channelContext === null) {
          await settingsClient.setValue(s.code, {
            scope: 'all',
            value,
            expectedVersion,
          });
        } else {
          await settingsClient.setValue(s.code, {
            scope: 'subset',
            salesChannelCodes: [channelContext],
            value,
            expectedVersion,
          });
        }
        savedCodes.add(s.code);
      } catch (err) {
        if (err instanceof ApiError && err.envelope.error.code === 'VERSION_CONFLICT') {
          newConflicts[s.code] = err.envelope.error.message;
        } else {
          newConflicts[s.code] =
            err instanceof ApiError ? err.envelope.error.message : 'Save failed.';
        }
      }
    }

    if (savedCodes.size > 0) {
      setDrafts((prev) => {
        const out = { ...prev };
        for (const code of savedCodes) delete out[code];
        return out;
      });
    }

    setConflicts((prev) => ({ ...prev, ...newConflicts }));
    if (savedCodes.size > 0) {
      setInfo(t('editor.savedNotice', { count: savedCodes.size }));
    }
    await refresh();
    setSaving(false);
  }, [allDirtySettings, channelContext, drafts, refresh, t]);

  const resetSetting = useCallback(
    async (code: string): Promise<void> => {
      const setting = findSetting(code);
      if (!setting) return;
      const isChannelMode = channelContext !== null;
      const confirmMsg = isChannelMode
        ? `Reset "${code}" override for channel "${channelContext}"?`
        : `Reset all per-channel values for "${code}"?`;
      if (!confirm(confirmMsg)) return;
      setResettingCode(code);
      setError(null);
      try {
        await settingsClient.resetValues(
          code,
          isChannelMode ? [channelContext!] : undefined,
        );
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Reset failed.');
      } finally {
        setResettingCode(null);
      }
    },
    [channelContext, findSetting, refresh],
  );

  return (
    <>
      <PageHeader
        title={t('page.title')}
        description={t('page.description')}
      />
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {info && (
        <Alert className="mb-4">
          <AlertDescription>{info}</AlertDescription>
        </Alert>
      )}

      <Card className="mb-4">
        <CardContent className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:gap-4">
          <Label htmlFor="settings-channel-context" className="shrink-0 text-sm font-medium">
            {t('context.label')}:
          </Label>
          <Select
            id="settings-channel-context"
            className="sm:max-w-sm"
            value={channelContext ?? ''}
            onChange={(e) => switchChannelContext(e.target.value === '' ? null : e.target.value)}
          >
            <option value="">{t('context.allChannels')}</option>
            {channelOptions.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </Select>
        </CardContent>
      </Card>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={searchRef}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('search.placeholder')}
            aria-keyshortcuts="Control+Shift+K Meta+Shift+K"
            className="pl-8 pr-16"
          />
          <kbd
            aria-hidden="true"
            className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-block"
          >
            {t('search.shortcut')}
          </kbd>
        </div>
        {filteredGroups.length > 0 && (
          <Button variant="outline" size="sm" onClick={toggleAll}>
            {allCollapsed ? t('groups.expandAll') : t('groups.collapseAll')}
          </Button>
        )}
      </div>

      <div className={cn('space-y-4', totalDirtyCount > 0 && 'pb-24')}>
        {loading && (
          <p className="text-sm text-muted-foreground">{t('state.loading')}</p>
        )}
        {!loading && filteredGroups.length === 0 && search && (
          <p className="text-sm text-muted-foreground">{t('search.noResults')}</p>
        )}
        {!loading && filteredGroups.length === 0 && !search && channelContext !== null && (
          <p className="text-sm text-muted-foreground">{t('context.empty')}</p>
        )}
        {!loading &&
          filteredGroups.map((group) => {
            const isCollapsed = !!collapsed[group.code];
            const dirtyCount = dirtyCountFor(group);
            return (
              <Card key={group.code} id={`settings-group-${group.code}`}>
                <CardHeader>
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.code)}
                    className="flex w-full items-center gap-2 text-left"
                    aria-expanded={!isCollapsed}
                  >
                    {isCollapsed ? (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                    <CardTitle className="flex items-center gap-2">
                      {group.name}
                      {group.isSystemProtected && (
                        <span className="rounded bg-muted px-2 py-0.5 text-xs">
                          system
                        </span>
                      )}
                      <span className="text-xs font-normal text-muted-foreground">
                        ({group.settings.length})
                      </span>
                      {dirtyCount > 0 && (
                        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
                          {t('actions.saveChanges', { count: dirtyCount })}
                        </span>
                      )}
                    </CardTitle>
                  </button>
                </CardHeader>
                {!isCollapsed && (
                  <CardContent>
                    {group.settings.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {t('groups.empty')}
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {group.settings.map((s) => {
                          const draft = drafts[s.code] ?? baselineDraft(s, channelContext);
                          const conflict = conflicts[s.code];
                          return (
                            <div key={s.code} className="space-y-2">
                              {conflict && (
                                <ConflictBanner
                                  message={conflict}
                                  onRefresh={() => {
                                    setConflicts((prev) => {
                                      const out = { ...prev };
                                      delete out[s.code];
                                      return out;
                                    });
                                    void refresh();
                                  }}
                                />
                              )}
                              {s.activationControl === true ? (
                                // D-36a: the control itself lives on
                                // `/platform/modules`. What stays here is the
                                // row an operator looks for by name, pointing
                                // at the one surface that can flip it.
                                <ActivationPointerRow setting={s} />
                              ) : (
                                <SettingRowEditor
                                  setting={s}
                                  draft={draft}
                                  channelContext={channelContext}
                                  isCopied={copiedCode === s.code}
                                  resetting={resettingCode === s.code}
                                  readOnly={s.editable === false}
                                  onChange={(patch) => patchDraft(s.code, patch)}
                                  onCopyCode={() => void onCopyCode(s.code)}
                                  onReset={() => void resetSetting(s.code)}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}
      </div>

      {totalDirtyCount > 0 && (
        <div
          role="region"
          aria-label={t('actions.saveChanges', { count: totalDirtyCount })}
          className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-end gap-3 border-t bg-background/95 px-4 py-3 shadow-lg backdrop-blur sm:px-6 lg:px-8"
        >
          <span className="mr-auto text-sm text-muted-foreground">
            {channelContext !== null
              ? `${t('context.channelOverride', { code: channelContext })} · ${t('actions.saveChanges', { count: totalDirtyCount })}`
              : t('actions.saveChanges', { count: totalDirtyCount })}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={discardAll}
            disabled={saving}
          >
            {t('actions.discard')}
          </Button>
          <Button
            size="sm"
            onClick={() => void saveAll()}
            disabled={saving}
          >
            {saving
              ? t('actions.saveAll') + '…'
              : t('actions.saveChanges', { count: totalDirtyCount })}
          </Button>
        </div>
      )}
    </>
  );
}

/**
 * Feature 073 — can the generic batch save touch this row?
 *
 * Two rows it must not: one whose module is switched off (the server refuses
 * it, FR-033) and a module's activation control (the audited Command owns it,
 * FR-009). `editable`/`activationControl` are optional on the wire so an older
 * backend keeps working; absent means "ordinary setting", which is the
 * pre-073 behaviour.
 */
function isSaveable(setting: SettingDto): boolean {
  return setting.editable !== false && setting.activationControl !== true;
}

function baselineDraft(
  setting: SettingDto,
  channelContext: string | null,
): SettingDraft {
  const text = deriveDisplayValue(setting, channelContext);
  return { text, initialText: text };
}

/**
 * Re-baseline drafts against the current channel context after a refresh.
 * Dirty drafts keep their `text` so unsaved edits aren't blown away; their
 * `initialText` is rebound to whatever the server now reports for the active
 * context.
 */
function mergeDrafts(
  prev: Record<string, SettingDraft>,
  groups: SettingGroupDto[],
  channelContext: string | null,
): Record<string, SettingDraft> {
  const out: Record<string, SettingDraft> = {};
  for (const g of groups) {
    for (const s of g.settings) {
      const existing = prev[s.code];
      const base = baselineDraft(s, channelContext);
      if (existing && isDraftDirty(existing)) {
        out[s.code] = {
          ...existing,
          initialText: base.initialText,
        };
      } else {
        out[s.code] = base;
      }
    }
  }
  return out;
}

function filterGroupsForContext(
  groups: SettingGroupDto[],
  search: string,
  channelContext: string | null,
): SettingGroupDto[] {
  const q = normalize(search);
  const out: SettingGroupDto[] = [];
  for (const g of groups) {
    if (
      channelContext !== null &&
      g.salesChannelCodes.length > 0 &&
      !g.salesChannelCodes.includes(channelContext)
    ) {
      continue;
    }
    // A query may match the section (group) title itself — e.g. "assistant"
    // matching "Prompt actions (AI assistant)". When it does, surface every
    // channel-passing setting in the group rather than requiring a per-setting
    // match.
    const groupMatches =
      q !== '' && (normalize(g.name).includes(q) || normalize(g.code).includes(q));
    const filtered = g.settings.filter((s) => {
      if (
        channelContext !== null &&
        s.salesChannelCodes.length > 0 &&
        !s.salesChannelCodes.includes(channelContext)
      ) {
        return false;
      }
      if (groupMatches) return true;
      if (q && !settingMatches(s, q)) return false;
      return true;
    });
    if (filtered.length === 0 && (q || channelContext !== null)) continue;
    out.push({ ...g, settings: filtered });
  }
  return out;
}

function settingMatches(s: SettingDto, q: string): boolean {
  if (normalize(s.name).includes(q)) return true;
  if (normalize(s.code).includes(q)) return true;
  if (s.description && normalize(s.description).includes(q)) return true;
  return false;
}

interface ChannelOption {
  code: string;
  label: string;
}

function channelLabel(channel: SalesChannelSummary): string {
  const name = channel.name['en-US'] ?? Object.values(channel.name)[0] ?? channel.code;
  return `${name} (${channel.code})`;
}
