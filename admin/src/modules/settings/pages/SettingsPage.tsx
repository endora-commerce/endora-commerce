import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import type {
  SalesChannelSummary,
  SettingDto,
  SettingGroupDto,
} from '@b2b/contracts';
import { ApiError } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { settingsClient } from '../api/settings-client';
import { salesChannelsClient } from '@/modules/sales_channels/api/sales-channels-client';
import { useTranslation } from '@/i18n/useTranslation';
import { ConflictBanner } from '../components/ConflictBanner';
import {
  SettingRowEditor,
  computeVersion,
  deriveDisplayValue,
  parseValue,
  type SettingDraft,
} from '../components/SettingRowEditor';

/**
 * Settings page — feature 004 / US2, redesigned for batch editing.
 *
 * Every setting renders inline within its group card and is always editable;
 * changes accumulate in `drafts` and are flushed in one "Save N changes"
 * sequence per group. Per-setting "Apply to" scope (all-in-scope / subset)
 * is still honoured and each write carries its own optimistic-version
 * check, so conflicts are reported per setting.
 */
export function SettingsPage(): ReactNode {
  const t = useTranslation('settings');
  const [groups, setGroups] = useState<SettingGroupDto[]>([]);
  const [allChannels, setAllChannels] = useState<SalesChannelSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Record<string, string>>({});
  const [savingGroup, setSavingGroup] = useState<string | null>(null);
  const [resettingCode, setResettingCode] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, SettingDraft>>({});

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [list, channels] = await Promise.all([
        settingsClient.list(),
        salesChannelsClient
          .list({ activeOnly: false, pageSize: 200 })
          .catch(() => ({ items: [] as SalesChannelSummary[] })),
      ]);
      setGroups(list.groups);
      setAllChannels(channels.items);
      // Re-baseline drafts for settings that the user has NOT touched, so
      // server-side changes flow through; preserve any active dirty drafts.
      setDrafts((prev) => mergeDrafts(prev, list.groups));
    } catch (err) {
      setError(
        err instanceof ApiError ? err.envelope.error.message : 'Failed to load settings.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const allChannelCodes = useMemo(
    () => mergeChannelCodes(groups, allChannels),
    [groups, allChannels],
  );

  const filteredGroups = useMemo(
    () => filterGroupsBySearch(groups, search),
    [groups, search],
  );

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
        const d = drafts[s.code];
        if (d && d.text !== d.initialText) n += 1;
      }
      return n;
    },
    [drafts],
  );

  const discardGroup = useCallback(
    (group: SettingGroupDto): void => {
      setDrafts((prev) => {
        const out = { ...prev };
        for (const s of group.settings) {
          out[s.code] = baselineDraft(s);
        }
        return out;
      });
      setConflicts((prev) => {
        const out = { ...prev };
        for (const s of group.settings) delete out[s.code];
        return out;
      });
    },
    [],
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

  const saveGroup = useCallback(
    async (group: SettingGroupDto): Promise<void> => {
      const dirtySettings = group.settings.filter((s) => {
        const d = drafts[s.code];
        return d && d.text !== d.initialText;
      });
      if (dirtySettings.length === 0) return;

      setSavingGroup(group.code);
      setError(null);
      setInfo(null);
      const newConflicts: Record<string, string> = {};
      let saved = 0;

      for (const s of dirtySettings) {
        const draft = drafts[s.code];
        if (!draft) continue;
        if (draft.scope === 'subset' && draft.subsetCodes.length === 0) {
          newConflicts[s.code] = t('editor.applyTo.subsetEmpty');
          continue;
        }
        try {
          const value = parseValue(s.valueType, draft.text);
          const expectedVersion = computeVersion(s);
          if (draft.scope === 'all') {
            await settingsClient.setValue(s.code, {
              scope: 'all',
              value,
              expectedVersion,
            });
          } else {
            await settingsClient.setValue(s.code, {
              scope: 'subset',
              salesChannelCodes: draft.subsetCodes,
              value,
              expectedVersion,
            });
          }
          saved += 1;
        } catch (err) {
          if (err instanceof ApiError && err.envelope.error.code === 'VERSION_CONFLICT') {
            newConflicts[s.code] = err.envelope.error.message;
          } else {
            newConflicts[s.code] =
              err instanceof ApiError ? err.envelope.error.message : 'Save failed.';
          }
        }
      }

      setConflicts((prev) => ({ ...prev, ...newConflicts }));
      if (saved > 0) {
        setInfo(t('editor.savedNotice', { count: saved }));
      }
      await refresh();
      setSavingGroup(null);
    },
    [drafts, refresh, t],
  );

  const resetSetting = useCallback(
    async (code: string): Promise<void> => {
      const setting = findSetting(code);
      if (!setting) return;
      if (!confirm(`Reset all per-channel values for "${code}"?`)) return;
      setResettingCode(code);
      setError(null);
      try {
        await settingsClient.resetValues(code);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Reset failed.');
      } finally {
        setResettingCode(null);
      }
    },
    [findSetting, refresh],
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
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('search.placeholder')}
            className="pl-8"
          />
        </div>
        {filteredGroups.length > 0 && (
          <Button variant="outline" size="sm" onClick={toggleAll}>
            {allCollapsed ? t('groups.expandAll') : t('groups.collapseAll')}
          </Button>
        )}
      </div>
      <div className="space-y-4">
        {loading && (
          <p className="text-sm text-muted-foreground">Loading settings…</p>
        )}
        {!loading && filteredGroups.length === 0 && search && (
          <p className="text-sm text-muted-foreground">{t('search.noResults')}</p>
        )}
        {!loading &&
          filteredGroups.map((group) => {
            const isCollapsed = !!collapsed[group.code];
            const dirtyCount = dirtyCountFor(group);
            const isSaving = savingGroup === group.code;
            return (
              <Card key={group.code}>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.code)}
                      className="flex flex-1 items-center gap-2 text-left"
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
                    {dirtyCount > 0 && !isCollapsed && (
                      <div className="flex shrink-0 gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => discardGroup(group)}
                          disabled={isSaving}
                        >
                          {t('actions.discard')}
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => void saveGroup(group)}
                          disabled={isSaving}
                        >
                          {isSaving
                            ? t('actions.saveAll') + '…'
                            : t('actions.saveChanges', { count: dirtyCount })}
                        </Button>
                      </div>
                    )}
                  </div>
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
                          const draft = drafts[s.code] ?? baselineDraft(s);
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
                              <SettingRowEditor
                                setting={s}
                                draft={draft}
                                availableChannelCodes={allChannelCodes}
                                isCopied={copiedCode === s.code}
                                resetting={resettingCode === s.code}
                                onChange={(patch) => patchDraft(s.code, patch)}
                                onCopyCode={() => void onCopyCode(s.code)}
                                onReset={() => void resetSetting(s.code)}
                              />
                            </div>
                          );
                        })}
                        {dirtyCount > 0 && (
                          <div className="flex justify-end gap-2 border-t pt-3">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => discardGroup(group)}
                              disabled={isSaving}
                            >
                              {t('actions.discard')}
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => void saveGroup(group)}
                              disabled={isSaving}
                            >
                              {isSaving
                                ? t('actions.saveAll') + '…'
                                : t('actions.saveChanges', { count: dirtyCount })}
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}
      </div>
    </>
  );
}

function baselineDraft(setting: SettingDto): SettingDraft {
  const text = deriveDisplayValue(setting);
  return {
    text,
    initialText: text,
    scope: 'all',
    subsetCodes: [],
  };
}

/**
 * After a refresh, re-baseline drafts that the user has NOT modified so the
 * UI reflects newly persisted values; preserve any dirty drafts (and their
 * scope choice) so unsaved edits aren't blown away by a peer's write.
 */
function mergeDrafts(
  prev: Record<string, SettingDraft>,
  groups: SettingGroupDto[],
): Record<string, SettingDraft> {
  const out: Record<string, SettingDraft> = {};
  for (const g of groups) {
    for (const s of g.settings) {
      const existing = prev[s.code];
      const base = baselineDraft(s);
      if (existing && existing.text !== existing.initialText) {
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

function mergeChannelCodes(
  groups: SettingGroupDto[],
  allChannels: SalesChannelSummary[],
): string[] {
  const codes = new Set<string>();
  for (const c of allChannels) codes.add(c.code);
  for (const g of groups) {
    for (const s of g.settings) {
      for (const v of s.valuesByChannel) codes.add(v.salesChannelCode);
      for (const c of s.salesChannelCodes) codes.add(c);
    }
    for (const c of g.salesChannelCodes) codes.add(c);
  }
  return Array.from(codes).sort();
}

function filterGroupsBySearch(
  groups: SettingGroupDto[],
  search: string,
): SettingGroupDto[] {
  const q = search.trim().toLowerCase();
  if (!q) return groups;
  const out: SettingGroupDto[] = [];
  for (const g of groups) {
    const matches = g.settings.filter((s) => settingMatches(s, q));
    if (matches.length > 0) out.push({ ...g, settings: matches });
  }
  return out;
}

function settingMatches(s: SettingDto, q: string): boolean {
  if (s.name.toLowerCase().includes(q)) return true;
  if (s.code.toLowerCase().includes(q)) return true;
  if (s.description && s.description.toLowerCase().includes(q)) return true;
  return false;
}
