import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  ArrowDown,
  ArrowUp,
  Search,
} from 'lucide-react';
import type {
  PushAudienceRule,
  PushAudienceCriterionNode,
  PushAudienceCriterionType,
  PushAudienceGroupNode,
} from '@endora-commerce/contracts';
import { apiClient, ApiError, cn, normalize } from '@endora-commerce/admin-kit/lib';
import { Button, Checkbox, Input, Select } from '@endora-commerce/admin-kit/ui';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { criterionTypeLabels, groupOperatorLabels } from '../lib/labels.js';

const DEPTH_CAP = 5;

/** A compact 32 px icon button, grown to 44 px below desktop where the pointer is a finger (Fitts's Law). */
const ICON_BUTTON = 'size-8 max-lg:size-11';

interface PickerOption {
  value: string;
  label: string;
  hint?: string;
}

interface PickerCache {
  loading: boolean;
  options: PickerOption[];
  error: string | null;
}

/**
 * PushAudienceRuleBuilder — recursive editor over the AST defined in
 * `@endora-commerce/contracts/pwa#PushAudienceRule`. It reuses the same Rule Builder UX as
 * the price-list `ApplicationRuleBuilder`, scoped to push targeting criteria
 * (Sales Channel, Customer Group, Organization, Customer List).
 *
 * The contract caps depth at 5 nested groups; the UI disables "add subgroup"
 * once that limit is reached. Pickers are loaded lazily from
 * `/api/v1/admin/pwa/rule-targets/*`. Fully controlled — the parent owns the
 * AST and receives a new tree on every edit.
 */
export function PushAudienceRuleBuilder(props: {
  value: PushAudienceRule;
  onChange: (next: PushAudienceRule) => void;
  disabled?: boolean;
}): ReactNode {
  const { value, onChange, disabled } = props;
  const t = useTranslation('pwa');
  const [pickers, setPickers] = useState<Record<PushAudienceCriterionType, PickerCache>>(() => ({
    salesChannel: { loading: false, options: [], error: null },
    customerGroup: { loading: false, options: [], error: null },
    organization: { loading: false, options: [], error: null },
    customer: { loading: false, options: [], error: null },
  }));

  const attemptedRef = useRef<Set<PushAudienceCriterionType>>(new Set());
  // `ensurePicker` is stable for the builder's life; it reads the current translator.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const ensurePicker = useCallback(async (type: PushAudienceCriterionType): Promise<void> => {
    if (attemptedRef.current.has(type)) return;
    attemptedRef.current.add(type);
    setPickers((prev) => ({ ...prev, [type]: { ...prev[type], loading: true } }));
    try {
      const options = await loadPicker(type);
      setPickers((prev) => ({ ...prev, [type]: { loading: false, options, error: null } }));
    } catch (err) {
      const message = err instanceof ApiError ? err.envelope.error.message : tRef.current('audience.loadError');
      setPickers((prev) => ({ ...prev, [type]: { ...prev[type], loading: false, error: message } }));
    }
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">{t('audience.help')}</p>

      <RuleNodeView
        node={value}
        depth={0}
        disabled={disabled ?? false}
        pickers={pickers}
        ensurePicker={ensurePicker}
        onReplace={(next): void => onChange(next ?? { kind: 'all' })}
      />

      <p className="mt-1 text-xs text-muted-foreground">{t('audience.limits', { max: DEPTH_CAP })}</p>
    </div>
  );
}

function RuleNodeView(props: {
  node: PushAudienceRule;
  depth: number;
  disabled: boolean;
  pickers: Record<PushAudienceCriterionType, PickerCache>;
  ensurePicker: (type: PushAudienceCriterionType) => void | Promise<void>;
  onReplace: (next: PushAudienceRule | null) => void;
}): ReactNode {
  const { node, depth, disabled, pickers, ensurePicker, onReplace } = props;
  const t = useTranslation('pwa');

  if (node.kind === 'all') {
    return (
      // A dashed frame: the rule is empty, not missing. *Add criterion* is outline because it
      // applies at once and the screen's Save is its one primary (Von Restorff).
      <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted p-3">
        <p className="flex-1 text-sm">{t('audience.empty')}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={(): void => onReplace({ kind: 'group', op: 'AND', children: [emptyCriterion()] })}
        >
          <Plus aria-hidden="true" /> {t('audience.addCriterion')}
        </Button>
      </div>
    );
  }

  if (node.kind === 'criterion') {
    return (
      <CriterionView
        node={node}
        disabled={disabled}
        pickers={pickers}
        ensurePicker={ensurePicker}
        onChange={(next): void => onReplace(next)}
        onDelete={(): void => onReplace(null)}
      />
    );
  }

  return (
    <GroupView
      node={node}
      depth={depth}
      disabled={disabled}
      pickers={pickers}
      ensurePicker={ensurePicker}
      onChange={(next): void => onReplace(next)}
    />
  );
}

function GroupView(props: {
  node: PushAudienceGroupNode;
  depth: number;
  disabled: boolean;
  pickers: Record<PushAudienceCriterionType, PickerCache>;
  ensurePicker: (type: PushAudienceCriterionType) => void | Promise<void>;
  onChange: (next: PushAudienceRule | null) => void;
}): ReactNode {
  const { node, depth, disabled, pickers, ensurePicker, onChange } = props;
  const t = useTranslation('pwa');
  const { language } = useTranslationContext();
  const [collapsed, setCollapsed] = useState(false);

  const updateChild = (idx: number, next: PushAudienceRule | null): void => {
    const children = [...node.children];
    if (next === null) children.splice(idx, 1);
    else children[idx] = next;
    if (children.length === 0) {
      onChange(depth === 0 ? { kind: 'all' } : null);
      return;
    }
    onChange({ ...node, children });
  };

  const moveChild = (idx: number, direction: -1 | 1): void => {
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= node.children.length) return;
    const children = [...node.children];
    const [moved] = children.splice(idx, 1);
    children.splice(newIdx, 0, moved!);
    onChange({ ...node, children });
  };

  const addCriterion = (): void => {
    onChange({ ...node, children: [...node.children, emptyCriterion()] });
  };

  const addGroup = (): void => {
    if (depth + 1 >= DEPTH_CAP) return;
    onChange({
      ...node,
      children: [...node.children, { kind: 'group', op: 'AND', children: [emptyCriterion()] }],
    });
  };

  const subgroupBlocked = depth + 1 >= DEPTH_CAP;

  return (
    <div className={cn('rounded-md border', depth === 0 ? 'bg-card' : 'bg-muted')}>
      <div className={cn('flex items-center gap-2 px-2.5 py-2', !collapsed && 'border-b')}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={ICON_BUTTON}
          onClick={(): void => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t('audience.expand') : t('audience.collapse')}
        >
          {collapsed ? <ChevronRight aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
        </Button>
        {/* A two-way switch: the one applied is filled and announced (aria-pressed), the
            other is outline — theme tokens, never a hard-coded white. */}
        <div className="flex gap-1" role="group" aria-label={t('audience.operator')}>
          {groupOperatorLabels.values.map((op) => (
            <Button
              key={op}
              type="button"
              size="sm"
              variant={node.op === op ? 'default' : 'outline'}
              disabled={disabled}
              onClick={(): void => onChange({ ...node, op })}
              aria-pressed={node.op === op}
            >
              {groupOperatorLabels.label(t, op)}
            </Button>
          ))}
        </div>
        <p className="flex-1 text-xs text-muted-foreground">
          {t(`audience.groupSummary.${new Intl.PluralRules(language).select(node.children.length)}`, {
            count: node.children.length,
            depth: depth + 1,
            max: DEPTH_CAP,
          })}
        </p>
        {depth > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(ICON_BUTTON, 'text-destructive hover:text-destructive')}
            disabled={disabled}
            onClick={(): void => onChange(null)}
            title={t('audience.removeGroup')}
            aria-label={t('audience.removeGroup')}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        ) : null}
      </div>

      {!collapsed ? (
        <div className="flex flex-col gap-2 p-2.5">
          {node.children.map((child, idx) => (
            <div key={idx} className="flex items-start gap-1.5">
              <div className="flex flex-col gap-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={ICON_BUTTON}
                  disabled={disabled || idx === 0}
                  onClick={(): void => moveChild(idx, -1)}
                  title={t('audience.moveUp')}
                  aria-label={t('audience.moveUp')}
                >
                  <ArrowUp aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={ICON_BUTTON}
                  disabled={disabled || idx === node.children.length - 1}
                  onClick={(): void => moveChild(idx, 1)}
                  title={t('audience.moveDown')}
                  aria-label={t('audience.moveDown')}
                >
                  <ArrowDown aria-hidden="true" />
                </Button>
              </div>
              <div className="min-w-0 flex-1">
                <RuleNodeView
                  node={child}
                  depth={depth + 1}
                  disabled={disabled}
                  pickers={pickers}
                  ensurePicker={ensurePicker}
                  onReplace={(next): void => updateChild(idx, next)}
                />
              </div>
            </div>
          ))}
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={addCriterion}>
              <Plus aria-hidden="true" /> {t('audience.addCriterion')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || subgroupBlocked}
              title={subgroupBlocked ? t('audience.depthReached', { max: DEPTH_CAP }) : undefined}
              onClick={addGroup}
            >
              <Plus aria-hidden="true" /> {t('audience.addGroup')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CriterionView(props: {
  node: PushAudienceCriterionNode;
  disabled: boolean;
  pickers: Record<PushAudienceCriterionType, PickerCache>;
  ensurePicker: (type: PushAudienceCriterionType) => void | Promise<void>;
  onChange: (next: PushAudienceCriterionNode) => void;
  onDelete: () => void;
}): ReactNode {
  const { node, disabled, pickers, ensurePicker, onChange, onDelete } = props;
  const t = useTranslation('pwa');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void ensurePicker(node.type);
  }, [node.type, ensurePicker]);

  const handleType = (type: PushAudienceCriterionType): void => {
    onChange({ kind: 'criterion', type, values: [] });
    void ensurePicker(type);
  };

  const cache = pickers[node.type];
  const labelMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const opt of cache.options) m.set(opt.value, opt.label);
    return m;
  }, [cache.options]);

  return (
    <div className="rounded-md border bg-card p-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          className="w-40"
          value={node.type}
          disabled={disabled}
          aria-label={t('audience.criterionType')}
          onChange={(e): void => handleType(e.target.value as PushAudienceCriterionType)}
        >
          {criterionTypeLabels.options(t).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <span className="text-xs text-muted-foreground">{t('audience.valueIn')}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-w-0 flex-1 justify-start text-left"
          disabled={disabled}
          aria-expanded={open}
          onClick={(): void => {
            setOpen((v) => !v);
            void ensurePicker(node.type);
          }}
        >
          {node.values.length === 0 ? (
            <span className="text-muted-foreground">{t('audience.pickValues')}</span>
          ) : (
            <span className="truncate">
              {node.values
                .slice(0, 3)
                .map((v) => labelMap.get(v) ?? v)
                .join(', ')}
              {node.values.length > 3 ? <> {t('audience.more', { count: node.values.length - 3 })}</> : null}
            </span>
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(ICON_BUTTON, 'text-destructive hover:text-destructive')}
          disabled={disabled}
          onClick={onDelete}
          title={t('audience.removeCriterion')}
          aria-label={t('audience.removeCriterion')}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>

      {open ? (
        <ValuePicker
          values={node.values}
          cache={cache}
          onClose={(): void => setOpen(false)}
          onChange={(values): void => onChange({ ...node, values })}
        />
      ) : null}
    </div>
  );
}

function ValuePicker(props: {
  values: string[];
  cache: PickerCache;
  onClose: () => void;
  onChange: (next: string[]) => void;
}): ReactNode {
  const { values, cache, onChange } = props;
  const t = useTranslation('pwa');
  const tc = useTranslation('core');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Set<string>>(new Set(values));

  const toggle = (v: string): void => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  };

  const filtered = cache.options.filter((opt) => {
    const q = normalize(search);
    if (q === '') return true;
    return normalize(opt.label).includes(q) || normalize(opt.value).includes(q);
  });

  const apply = (): void => {
    onChange(Array.from(draft));
    props.onClose();
  };

  return (
    <div className="mt-2 rounded-md border bg-muted p-2">
      <div className="relative mb-1.5">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          autoFocus
          type="search"
          className="pl-8"
          aria-label={t('audience.search')}
          placeholder={t('audience.search')}
          value={search}
          onChange={(e): void => setSearch(e.target.value)}
        />
      </div>
      {/* Mounted before it has text, so "Loading…" and the result are announced (WCAG 4.1.3). */}
      <div role="status" className="empty:hidden">
        {!cache.error && cache.loading ? (
          <p className="text-xs text-muted-foreground">{t('audience.loading')}</p>
        ) : null}
      </div>
      {cache.error ? (
        <p role="alert" className="text-xs text-destructive">
          {cache.error}
        </p>
      ) : cache.loading ? null : filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('audience.noOptions')}</p>
      ) : (
        // Each option is a labelled kit checkbox: reachable by Tab, toggled by Space, and the
        // whole row is its target (WCAG 2.1.1; Fitts's Law). They were `<li onClick>`s.
        <ul className="m-0 max-h-56 list-none overflow-auto p-0">
          {filtered.slice(0, 200).map((opt) => (
            <li key={opt.value}>
              <label className="flex cursor-pointer items-center gap-1.5 rounded-sm px-1.5 py-1 text-xs hover:bg-accent">
                <Checkbox checked={draft.has(opt.value)} onChange={(): void => toggle(opt.value)} />
                <span>{opt.label}</span>
                {opt.hint ? <span className="text-muted-foreground">· {opt.hint}</span> : null}
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex justify-end gap-1.5">
        <Button type="button" variant="ghost" size="sm" onClick={props.onClose}>
          {tc('common.action.cancel')}
        </Button>
        <Button type="button" size="sm" onClick={apply}>
          {t('audience.apply', { count: draft.size })}
        </Button>
      </div>
    </div>
  );
}

function emptyCriterion(): PushAudienceCriterionNode {
  return { kind: 'criterion', type: 'salesChannel', values: [] };
}

type LocalisedName = string | Record<string, string>;

function flattenName(name: LocalisedName, fallback: string): string {
  if (typeof name === 'string') return name || fallback;
  return name['en-US'] ?? name['pl-PL'] ?? Object.values(name)[0] ?? fallback;
}

async function loadPicker(type: PushAudienceCriterionType): Promise<PickerOption[]> {
  switch (type) {
    case 'salesChannel': {
      const res = await apiClient.get<{ data: { items: { id: string; code: string; name: LocalisedName }[] } }>(
        '/api/v1/admin/pwa/rule-targets/sales-channels',
      );
      return res.data.items.map((i) => ({ value: i.id, label: flattenName(i.name, i.code), hint: i.code }));
    }
    case 'customerGroup': {
      const res = await apiClient.get<{ data: { items: { id: string; code: string; name: LocalisedName }[] } }>(
        '/api/v1/admin/pwa/rule-targets/customer-groups',
      );
      return res.data.items.map((i) => ({ value: i.id, label: flattenName(i.name, i.code), hint: i.code }));
    }
    case 'organization': {
      const res = await apiClient.get<{ data: { items: { id: string; name: LocalisedName; taxId: string | null }[] } }>(
        '/api/v1/admin/pwa/rule-targets/organizations?limit=200',
      );
      return res.data.items.map((i) => ({
        value: i.id,
        label: flattenName(i.name, i.taxId ?? i.id),
        ...(i.taxId ? { hint: i.taxId } : {}),
      }));
    }
    case 'customer': {
      const res = await apiClient.get<{ data: { items: { id: string; email: string }[] } }>(
        '/api/v1/admin/pwa/rule-targets/customers?limit=200',
      );
      return res.data.items.map((i) => ({ value: i.id, label: i.email }));
    }
  }
}
