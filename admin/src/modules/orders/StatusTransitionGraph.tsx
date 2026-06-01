// Visual editor for the order-status transition graph (feature 038 / 039 UX).
//
// Replaces the flat "from → to" table with an ECharts directed graph: nodes are
// statuses, arrows are allowed transitions. Editing happens on the canvas —
// "connect mode" turns two node clicks into a new transition, and clicking an
// arrow selects it for removal. The classic From/To form is kept below as an
// accessible, test-friendly fallback.

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Plus, Trash2, Workflow, X } from 'lucide-react';
import type { ECElementEvent, EChartsOption, EChartsType } from 'echarts';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { EChart, type EChartEventHandler } from '@/components/charts/echart';

interface StatusDef {
  code: string;
  name: Record<string, string>;
  defaultName: string;
  isInitial: boolean;
  isTerminal: boolean;
  isSystem: boolean;
  weight: number;
  inUseCount: number;
}
interface TransitionDef {
  fromStatusCode: string;
  toStatusCode: string;
  isSystem: boolean;
}

interface Props {
  statuses: StatusDef[];
  transitions: TransitionDef[];
  statusLabel: (s: StatusDef) => string;
  onAdd: (from: string, to: string) => void;
  onRemove: (from: string, to: string) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

type GraphLayout = 'force' | 'circular';

interface GraphParams {
  dataType?: 'node' | 'edge';
  name: string;
  data: { name?: string; source?: string; target?: string; label?: string; flags?: string };
}

// Node fill by lifecycle role; system membership is shown with a gold border.
const COLOR_INITIAL = '#10b981';
const COLOR_TERMINAL = '#f43f5e';
const COLOR_NORMAL = '#3b82f6';
const COLOR_SYSTEM_BORDER = '#f59e0b';
const COLOR_EDGE = '#94a3b8';
const COLOR_EDGE_SYSTEM = '#cbd5e1';

export function StatusTransitionGraph({
  statuses,
  transitions,
  statusLabel,
  onAdd,
  onRemove,
  t,
}: Props): ReactNode {
  const [layout, setLayout] = useState<GraphLayout>('force');
  const [connectMode, setConnectMode] = useState(false);
  const [pendingFrom, setPendingFrom] = useState<string | null>(null);
  const [selected, setSelected] = useState<TransitionDef | null>(null);
  const [transFrom, setTransFrom] = useState('');
  const [transTo, setTransTo] = useState('');
  const chartRef = useRef<EChartsType | null>(null);

  const labelByCode = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of statuses) map.set(s.code, statusLabel(s));
    return map;
  }, [statuses, statusLabel]);

  const labelOf = useCallback(
    (code: string): string => labelByCode.get(code) ?? code,
    [labelByCode],
  );

  const option = useMemo<EChartsOption>(() => {
    const nodes = statuses.map((s) => {
      const flags = [
        s.isInitial ? t('orderStatusConfig.flag.initial') : null,
        s.isTerminal ? t('orderStatusConfig.flag.terminal') : null,
        s.isSystem ? t('orderStatusConfig.flag.system') : null,
      ]
        .filter(Boolean)
        .join(', ');
      const fill = s.isInitial ? COLOR_INITIAL : s.isTerminal ? COLOR_TERMINAL : COLOR_NORMAL;
      return {
        name: s.code,
        label: statusLabel(s),
        flags,
        symbolSize: 22,
        itemStyle: {
          color: fill,
          borderColor: s.isSystem ? COLOR_SYSTEM_BORDER : 'transparent',
          borderWidth: s.isSystem ? 3 : 0,
        },
      };
    });

    const links = transitions.map((tr) => ({
      source: tr.fromStatusCode,
      target: tr.toStatusCode,
      lineStyle: { color: tr.isSystem ? COLOR_EDGE_SYSTEM : COLOR_EDGE },
    }));

    return {
      tooltip: {
        confine: true,
        formatter: (raw: unknown): string => {
          const p = raw as GraphParams;
          if (p.dataType === 'edge') {
            return `${labelOf(String(p.data.source))} → ${labelOf(String(p.data.target))}`;
          }
          const flags = p.data.flags ? `<br/><span style="color:#64748b">${p.data.flags}</span>` : '';
          return `<strong>${labelOf(String(p.data.name))}</strong><br/><code>${p.data.name}</code>${flags}`;
        },
      },
      series: [
        {
          type: 'graph',
          layout,
          roam: true,
          draggable: true,
          cursor: 'pointer',
          edgeSymbol: ['none', 'arrow'],
          edgeSymbolSize: 9,
          force: { repulsion: 340, edgeLength: 160, gravity: 0.08 },
          circular: { rotateLabel: false },
          label: {
            show: true,
            position: 'bottom',
            fontSize: 11,
            color: '#334155',
            formatter: (raw: unknown): string => labelOf(String((raw as GraphParams).data.name)),
          },
          lineStyle: { color: COLOR_EDGE, width: 1.5, curveness: 0.12, opacity: 0.9 },
          emphasis: { focus: 'adjacency', lineStyle: { width: 3 } },
          data: nodes,
          links,
        },
      ],
    } as EChartsOption;
  }, [statuses, transitions, layout, labelOf, statusLabel, t]);

  const exists = useCallback(
    (from: string, to: string): boolean =>
      transitions.some((tr) => tr.fromStatusCode === from && tr.toStatusCode === to),
    [transitions],
  );

  const highlightNode = useCallback((code: string | null) => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.dispatchAction({ type: 'downplay', seriesIndex: 0 });
    if (code) chart.dispatchAction({ type: 'highlight', seriesIndex: 0, name: code });
  }, []);

  const tryAdd = useCallback(
    (from: string, to: string) => {
      if (!from || !to || from === to || exists(from, to)) return;
      onAdd(from, to);
    },
    [exists, onAdd],
  );

  const handleClick = useMemo<Record<string, EChartEventHandler>>(() => {
    const click: EChartEventHandler = (e: ECElementEvent): void => {
      const p = e as unknown as GraphParams;
      if (p.dataType === 'edge') {
        const tr = transitions.find(
          (x) => x.fromStatusCode === p.data.source && x.toStatusCode === p.data.target,
        );
        if (tr) setSelected(tr);
        return;
      }
      if (p.dataType === 'node') {
        const code = String(p.data.name);
        if (!connectMode) return;
        if (!pendingFrom) {
          setPendingFrom(code);
          highlightNode(code);
          return;
        }
        if (pendingFrom !== code) tryAdd(pendingFrom, code);
        setPendingFrom(null);
        highlightNode(null);
      }
    };
    return { click };
  }, [transitions, connectMode, pendingFrom, tryAdd, highlightNode]);

  const exitConnectMode = useCallback(() => {
    setConnectMode(false);
    setPendingFrom(null);
    highlightNode(null);
  }, [highlightNode]);

  const connectHint = pendingFrom
    ? t('orderStatusConfig.graph.pickTarget', { from: labelOf(pendingFrom) })
    : t('orderStatusConfig.graph.pickSource');

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={connectMode ? 'default' : 'outline'}
          size="sm"
          onClick={(): void => (connectMode ? exitConnectMode() : setConnectMode(true))}
        >
          <Workflow />
          {t('orderStatusConfig.graph.connectMode')}
        </Button>
        {connectMode ? (
          <span className="text-sm text-muted-foreground">{connectHint}</span>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant={layout === 'force' ? 'default' : 'outline'}
            size="sm"
            onClick={(): void => setLayout('force')}
          >
            {t('orderStatusConfig.graph.layoutForce')}
          </Button>
          <Button
            variant={layout === 'circular' ? 'default' : 'outline'}
            size="sm"
            onClick={(): void => setLayout('circular')}
          >
            {t('orderStatusConfig.graph.layoutCircular')}
          </Button>
        </div>
      </div>

      {/* Graph */}
      <div className="rounded-md border bg-card">
        {statuses.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            {t('orderStatusConfig.graph.empty')}
          </p>
        ) : (
          <EChart
            option={option}
            onEvents={handleClick}
            onReady={(chart): void => {
              chartRef.current = chart;
            }}
            className="h-[440px] w-full"
          />
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <LegendDot color={COLOR_INITIAL} label={t('orderStatusConfig.flag.initial')} />
        <LegendDot color={COLOR_TERMINAL} label={t('orderStatusConfig.flag.terminal')} />
        <LegendDot color={COLOR_NORMAL} label={t('orderStatusConfig.graph.legendNormal')} />
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-full border-[3px]"
            style={{ borderColor: COLOR_SYSTEM_BORDER, background: 'transparent' }}
          />
          {t('orderStatusConfig.flag.system')}
        </span>
      </div>

      {/* Selected-edge removal panel */}
      {selected ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/40 px-3 py-2">
          <span className="text-sm">
            {t('orderStatusConfig.graph.selected')}:{' '}
            <span className="font-mono text-xs">
              {selected.fromStatusCode} → {selected.toStatusCode}
            </span>
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={selected.isSystem}
              onClick={(): void => {
                onRemove(selected.fromStatusCode, selected.toStatusCode);
                setSelected(null);
              }}
            >
              <Trash2 />
              {t('orderStatusConfig.graph.removeTransition')}
            </Button>
            <Button variant="ghost" size="sm" onClick={(): void => setSelected(null)}>
              <X />
            </Button>
          </div>
        </div>
      ) : null}

      {/* Classic From/To form — accessible fallback */}
      <div className="flex flex-wrap items-end gap-3 border-t pt-4">
        <div className="space-y-1">
          <Label htmlFor="transFrom">{t('orderStatusConfig.col.from')}</Label>
          <Select id="transFrom" value={transFrom} onChange={(e): void => setTransFrom(e.target.value)}>
            <option value="">—</option>
            {statuses.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="transTo">{t('orderStatusConfig.col.to')}</Label>
          <Select id="transTo" value={transTo} onChange={(e): void => setTransTo(e.target.value)}>
            <option value="">—</option>
            {statuses.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code}
              </option>
            ))}
          </Select>
        </div>
        <Button
          onClick={(): void => {
            tryAdd(transFrom, transTo);
            setTransFrom('');
            setTransTo('');
          }}
          disabled={!transFrom || !transTo || transFrom === transTo}
        >
          <Plus />
          {t('orderStatusConfig.addTransition')}
        </Button>
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }): ReactNode {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-3 w-3 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
