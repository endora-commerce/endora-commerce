import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  ArrowDown,
  ArrowUp,
  CheckSquare,
  Square,
  Search,
} from 'lucide-react';
import type {
  ApplicationRule,
  RuleCriterionNode,
  RuleCriterionType,
  RuleGroupNode,
} from '@b2b/contracts';
import { ApiError, apiClient } from '@/lib/api-client';
import { useTranslation } from '@/i18n/useTranslation';

const DEPTH_CAP = 5;

const CRITERION_TYPES: RuleCriterionType[] = ['salesChannel', 'customerGroup', 'organization', 'category', 'currency'];

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
 * ApplicationRuleBuilder (US4 / T055).
 *
 * Recursive editor over the AST defined in
 * `@b2b/contracts/price-lists#ApplicationRule`. The contract caps depth
 * at 5 nested groups; the UI disables "add subgroup" once that limit is
 * reached so the validator never sees a tree it has to reject.
 *
 * Pickers are loaded lazily on first use from
 * `/api/v1/admin/pricing/rule-targets/*`. Currency values are
 * uppercased; every other criterion stores the target row ID.
 *
 * The component is fully controlled — the parent owns the AST and
 * receives a new tree on every edit.
 */
export function ApplicationRuleBuilder(props: {
  value: ApplicationRule;
  onChange: (next: ApplicationRule) => void;
  /** When true, every interactive control is disabled. */
  disabled?: boolean;
}): ReactNode {
  const t = useTranslation('core');
  const { value, onChange, disabled } = props;
  const [pickers, setPickers] = useState<Record<RuleCriterionType, PickerCache>>(() => ({
    salesChannel: { loading: false, options: [], error: null },
    customerGroup: { loading: false, options: [], error: null },
    organization: { loading: false, options: [], error: null },
    category: { loading: false, options: [], error: null },
    currency: { loading: false, options: [], error: null },
  }));

  const ensurePicker = async (type: RuleCriterionType): Promise<void> => {
    setPickers((prev) => {
      if (prev[type].options.length > 0 || prev[type].loading) return prev;
      return { ...prev, [type]: { ...prev[type], loading: true } };
    });
    try {
      const options = await loadPicker(type);
      setPickers((prev) => ({ ...prev, [type]: { loading: false, options, error: null } }));
    } catch (err) {
      const message = err instanceof ApiError ? err.envelope.error.message : t('priceLists.rule.error.load');
      setPickers((prev) => ({ ...prev, [type]: { ...prev[type], loading: false, error: message } }));
    }
  };

  return (
    <div className="b2b-col" style={{ gap: 12 }}>
      <div className="b2b-help">
        {t('priceLists.rule.intro')}
      </div>

      <RuleNodeView
        node={value}
        path={[]}
        depth={0}
        disabled={disabled ?? false}
        pickers={pickers}
        ensurePicker={ensurePicker}
        onReplace={(next): void => onChange(next ?? { kind: 'all' })}
      />

      <div
        className="b2b-help"
        style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}
      >
        <span>{t('priceLists.rule.depthLimit', { cap: DEPTH_CAP })}</span>
        <span>{t('priceLists.rule.currencyHint')}</span>
      </div>
    </div>
  );
}

function RuleNodeView(props: {
  node: ApplicationRule;
  path: number[];
  depth: number;
  disabled: boolean;
  pickers: Record<RuleCriterionType, PickerCache>;
  ensurePicker: (type: RuleCriterionType) => void | Promise<void>;
  onReplace: (next: ApplicationRule | null) => void;
}): ReactNode {
  const t = useTranslation('core');
  const { node, depth, disabled, pickers, ensurePicker, onReplace } = props;

  if (node.kind === 'all') {
    return (
      <div
        className="b2b-card"
        style={{
          padding: 12,
          border: '1px dashed var(--border-color)',
          background: 'var(--surface-muted)',
        }}
      >
        <div className="b2b-row" style={{ alignItems: 'center', gap: 8 }}>
          <div className="b2b-grow" style={{ fontSize: 13 }}>
            <strong>{t('priceLists.rule.alwaysMatch')}</strong> {t('priceLists.rule.alwaysMatchHint')}
          </div>
          <button
            type="button"
            className="b2b-btn b2b-btn--default b2b-btn--sm"
            disabled={disabled}
            onClick={(): void =>
              onReplace({ kind: 'group', op: 'AND', children: [emptyCriterion()] })
            }
          >
            <Plus size={12} /> {t('priceLists.rule.addCriterion')}
          </button>
        </div>
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
  node: RuleGroupNode;
  depth: number;
  disabled: boolean;
  pickers: Record<RuleCriterionType, PickerCache>;
  ensurePicker: (type: RuleCriterionType) => void | Promise<void>;
  onChange: (next: ApplicationRule | null) => void;
}): ReactNode {
  const t = useTranslation('core');
  const { node, depth, disabled, pickers, ensurePicker, onChange } = props;
  const [collapsed, setCollapsed] = useState(false);

  const updateChild = (idx: number, next: ApplicationRule | null): void => {
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
  const childIsLastInTree = node.children.length <= 1;

  return (
    <div
      className="b2b-card"
      style={{
        padding: 0,
        border: depth === 0 ? '1px solid var(--border-color)' : '1px solid var(--border-color)',
        background: depth === 0 ? 'var(--surface-color)' : 'var(--surface-muted)',
      }}
    >
      <div
        className="b2b-row"
        style={{
          padding: '8px 10px',
          alignItems: 'center',
          gap: 8,
          borderBottom: collapsed ? 'none' : '1px solid var(--border-color)',
        }}
      >
        <button
          type="button"
          className="b2b-btn b2b-btn--ghost b2b-btn--icon b2b-btn--sm"
          onClick={(): void => setCollapsed((v) => !v)}
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        </button>
        <div className="b2b-row" style={{ gap: 4 }}>
          {(['AND', 'OR'] as const).map((op) => (
            <button
              key={op}
              type="button"
              className="b2b-btn b2b-btn--sm"
              disabled={disabled}
              onClick={(): void => onChange({ ...node, op })}
              style={{
                background: node.op === op ? 'var(--primary-color)' : 'var(--surface-color)',
                color: node.op === op ? '#fff' : 'var(--fg-default)',
                border: `1px solid ${node.op === op ? 'var(--primary-color)' : 'var(--border-color)'}`,
                fontWeight: node.op === op ? 600 : 400,
              }}
            >
              {op}
            </button>
          ))}
        </div>
        <div className="b2b-grow b2b-help">
          {t('priceLists.rule.groupSummary', {
            count: node.children.length,
            label: node.children.length === 1 ? t('priceLists.rule.child') : t('priceLists.rule.children'),
            depth: depth + 1,
            cap: DEPTH_CAP,
          })}
        </div>
        {depth > 0 ? (
          <button
            type="button"
            className="b2b-btn b2b-btn--ghost b2b-btn--icon b2b-btn--sm"
            disabled={disabled}
            onClick={(): void => onChange(null)}
            title={t('priceLists.rule.removeGroup')}
            style={{ color: 'hsl(8 80% 50%)' }}
          >
            <Trash2 size={13} />
          </button>
        ) : null}
      </div>

      {!collapsed ? (
        <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {node.children.map((child, idx) => (
            <div key={idx} className="b2b-row" style={{ alignItems: 'flex-start', gap: 6 }}>
              <div className="b2b-col" style={{ gap: 2 }}>
                <button
                  type="button"
                  className="b2b-btn b2b-btn--ghost b2b-btn--icon b2b-btn--sm"
                  disabled={disabled || idx === 0}
                  onClick={(): void => moveChild(idx, -1)}
                  title={t('priceLists.rule.moveUp')}
                >
                  <ArrowUp size={12} />
                </button>
                <button
                  type="button"
                  className="b2b-btn b2b-btn--ghost b2b-btn--icon b2b-btn--sm"
                  disabled={disabled || idx === node.children.length - 1}
                  onClick={(): void => moveChild(idx, 1)}
                  title={t('priceLists.rule.moveDown')}
                >
                  <ArrowDown size={12} />
                </button>
              </div>
              <div className="b2b-grow">
                <RuleNodeView
                  node={child}
                  path={[idx]}
                  depth={depth + 1}
                  disabled={disabled}
                  pickers={pickers}
                  ensurePicker={ensurePicker}
                  onReplace={(next): void => updateChild(idx, next)}
                />
              </div>
            </div>
          ))}
          {node.children.length === 0 && childIsLastInTree ? (
            <div className="b2b-help">
              {t('priceLists.rule.emptyGroupHint')}
            </div>
          ) : null}
          <div className="b2b-row" style={{ gap: 6, marginTop: 4 }}>
            <button
              type="button"
              className="b2b-btn b2b-btn--default b2b-btn--sm"
              disabled={disabled}
              onClick={addCriterion}
            >
              <Plus size={12} /> {t('priceLists.rule.addCriterion')}
            </button>
            <button
              type="button"
              className="b2b-btn b2b-btn--default b2b-btn--sm"
              disabled={disabled || subgroupBlocked}
              title={subgroupBlocked ? t('priceLists.rule.depthCapReached', { cap: DEPTH_CAP }) : undefined}
              onClick={addGroup}
            >
              <Plus size={12} /> {t('priceLists.rule.addSubgroup')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CriterionView(props: {
  node: RuleCriterionNode;
  disabled: boolean;
  pickers: Record<RuleCriterionType, PickerCache>;
  ensurePicker: (type: RuleCriterionType) => void | Promise<void>;
  onChange: (next: RuleCriterionNode) => void;
  onDelete: () => void;
}): ReactNode {
  const t = useTranslation('core');
  const CRITERION_LABEL: Record<RuleCriterionType, string> = {
    salesChannel: t('priceLists.rule.criterion.salesChannel'),
    customerGroup: t('priceLists.rule.criterion.customerGroup'),
    organization: t('priceLists.rule.criterion.organization'),
    category: t('priceLists.rule.criterion.category'),
    currency: t('priceLists.rule.criterion.currency'),
  };
  const { node, disabled, pickers, ensurePicker, onChange, onDelete } = props;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void ensurePicker(node.type);
  }, [node.type, ensurePicker]);

  const handleType = (type: RuleCriterionType): void => {
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
    <div
      className="b2b-card"
      style={{
        padding: 8,
        border: '1px solid var(--border-color)',
        background: 'var(--surface-color)',
      }}
    >
      <div className="b2b-row" style={{ gap: 8, alignItems: 'center' }}>
        <select
          className="b2b-field"
          style={{ width: 150 }}
          value={node.type}
          disabled={disabled}
          onChange={(e): void => handleType(e.target.value as RuleCriterionType)}
        >
          {CRITERION_TYPES.map((ct) => (
            <option key={ct} value={ct}>
              {CRITERION_LABEL[ct]}
            </option>
          ))}
        </select>
        <span className="b2b-help">∈</span>
        <button
          type="button"
          className="b2b-btn b2b-btn--default b2b-btn--sm b2b-grow"
          style={{ justifyContent: 'flex-start', textAlign: 'left' }}
          disabled={disabled}
          onClick={(): void => {
            setOpen((v) => !v);
            void ensurePicker(node.type);
          }}
        >
          {node.values.length === 0 ? (
            <span className="b2b-help">{t('priceLists.rule.pickPlaceholder', { label: CRITERION_LABEL[node.type].toLowerCase() })}</span>
          ) : (
            <span style={{ fontSize: 12 }}>
              {node.values
                .slice(0, 3)
                .map((v) => labelMap.get(v) ?? v)
                .join(', ')}
              {node.values.length > 3 ? t('priceLists.rule.moreSuffix', { count: node.values.length - 3 }) : ''}
            </span>
          )}
        </button>
        <button
          type="button"
          className="b2b-btn b2b-btn--ghost b2b-btn--icon b2b-btn--sm"
          disabled={disabled}
          onClick={onDelete}
          title={t('priceLists.rule.removeCriterion')}
          style={{ color: 'hsl(8 80% 50%)' }}
        >
          <Trash2 size={13} />
        </button>
      </div>

      {open ? (
        <ValuePicker
          type={node.type}
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
  type: RuleCriterionType;
  values: string[];
  cache: PickerCache;
  onClose: () => void;
  onChange: (next: string[]) => void;
}): ReactNode {
  const t = useTranslation('core');
  const { type, values, cache, onChange } = props;
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Set<string>>(new Set(values));

  // For currency we also let the user type a code freely (e.g. an unconfigured currency).
  const [customInput, setCustomInput] = useState('');

  const toggle = (v: string): void => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  };

  const filtered = cache.options.filter((opt) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return opt.label.toLowerCase().includes(q) || opt.value.toLowerCase().includes(q);
  });

  const apply = (): void => {
    onChange(Array.from(draft));
    props.onClose();
  };

  return (
    <div
      style={{
        marginTop: 8,
        padding: 8,
        border: '1px solid var(--border-color)',
        borderRadius: 6,
        background: 'var(--surface-muted)',
      }}
    >
      <div className="b2b-input-wrap" style={{ marginBottom: 6 }}>
        <Search size={13} className="lead" />
        <input
          autoFocus
          className="b2b-field b2b-field--addon"
          placeholder={t('priceLists.rule.searchPlaceholder')}
          value={search}
          onChange={(e): void => setSearch(e.target.value)}
        />
      </div>
      {cache.error ? (
        <div className="b2b-help" style={{ color: 'hsl(8 80% 40%)' }}>
          {cache.error}
        </div>
      ) : cache.loading ? (
        <div className="b2b-help">{t('priceLists.rule.searchLoading')}</div>
      ) : filtered.length === 0 ? (
        <div className="b2b-help">{t('priceLists.rule.noOptions')}</div>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', maxHeight: 220, overflow: 'auto' }}>
          {filtered.slice(0, 200).map((opt) => {
            const isOn = draft.has(opt.value);
            return (
              <li
                key={opt.value}
                onClick={(): void => toggle(opt.value)}
                style={{
                  padding: '4px 6px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                }}
              >
                {isOn ? <CheckSquare size={13} /> : <Square size={13} />}
                <span>{opt.label}</span>
                {opt.hint ? <span className="b2b-help">· {opt.hint}</span> : null}
              </li>
            );
          })}
        </ul>
      )}
      {type === 'currency' ? (
        <div className="b2b-row" style={{ marginTop: 6, gap: 4 }}>
          <input
            className="b2b-field b2b-field--mono b2b-field--sm"
            placeholder={t('priceLists.rule.addCodePlaceholder')}
            value={customInput}
            onChange={(e): void => setCustomInput(e.target.value.toUpperCase())}
            maxLength={3}
          />
          <button
            type="button"
            className="b2b-btn b2b-btn--default b2b-btn--sm"
            disabled={customInput.length !== 3}
            onClick={(): void => {
              setDraft((prev) => {
                const next = new Set(prev);
                next.add(customInput);
                return next;
              });
              setCustomInput('');
            }}
          >
            {t('priceLists.rule.add')}
          </button>
        </div>
      ) : null}
      <div className="b2b-row" style={{ marginTop: 8, gap: 6, justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="b2b-btn b2b-btn--ghost b2b-btn--sm"
          onClick={props.onClose}
        >
          {t('priceLists.rule.cancel')}
        </button>
        <button
          type="button"
          className="b2b-btn b2b-btn--primary b2b-btn--sm"
          onClick={apply}
        >
          {t('priceLists.rule.apply', { count: draft.size })}
        </button>
      </div>
    </div>
  );
}

function emptyCriterion(): RuleCriterionNode {
  return { kind: 'criterion', type: 'salesChannel', values: [] };
}

async function loadPicker(type: RuleCriterionType): Promise<PickerOption[]> {
  switch (type) {
    case 'salesChannel': {
      const res = await apiClient.get<{ data: { items: { id: string; code: string; name: string }[] } }>(
        '/api/v1/admin/pricing/rule-targets/sales-channels',
      );
      return res.data.items.map((i) => ({ value: i.id, label: i.name, hint: i.code }));
    }
    case 'customerGroup': {
      const res = await apiClient.get<{ data: { items: { id: string; code: string; name: string }[] } }>(
        '/api/v1/admin/pricing/rule-targets/customer-groups',
      );
      return res.data.items.map((i) => ({ value: i.id, label: i.name, hint: i.code }));
    }
    case 'organization': {
      const res = await apiClient.get<{
        data: { items: { id: string; name: string; taxId: string }[] };
      }>('/api/v1/admin/pricing/rule-targets/organizations?limit=200');
      return res.data.items.map((i) => ({ value: i.id, label: i.name, hint: i.taxId }));
    }
    case 'category': {
      const res = await apiClient.get<{
        data: { items: { id: string; slug: string; name: string }[] };
      }>('/api/v1/admin/pricing/rule-targets/categories');
      return res.data.items.map((i) => ({ value: i.id, label: i.name, hint: i.slug }));
    }
    case 'currency': {
      const res = await apiClient.get<{ data: { items: { code: string; exposedByChannels: string[] }[] } }>(
        '/api/v1/admin/pricing/rule-targets/currencies',
      );
      return res.data.items.map((i) => ({
        value: i.code,
        label: i.code,
        hint: i.exposedByChannels.join(', '),
      }));
    }
  }
}
