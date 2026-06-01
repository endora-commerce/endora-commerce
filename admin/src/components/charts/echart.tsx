// Thin, reusable React wrapper around Apache ECharts.
//
// Owns the lifecycle the way React can't: it creates the chart instance once,
// keeps it sized to its container via a ResizeObserver, pushes new `option`
// objects on change, and disposes on unmount. Event handlers are (re)bound
// whenever `onEvents` changes — memoize that map in the caller to avoid churn.
//
// Intended as the shared charting primitive for the admin panel (status-graph
// editor today, analytics module later), so it stays chart-type agnostic: the
// caller supplies a full `EChartsOption`.
//
//   <EChart option={option} className="h-96 w-full" onEvents={events} />

import { useEffect, useRef, type CSSProperties } from 'react';
import * as echarts from 'echarts';
import type { ECElementEvent, EChartsOption, EChartsType } from 'echarts';

export type EChartEventHandler = (params: ECElementEvent) => void;

export interface EChartProps {
  /** Full ECharts option object. Replacing it re-renders the chart. */
  option: EChartsOption;
  /** When true (default) the option fully replaces the previous one. */
  notMerge?: boolean;
  /** Map of ECharts event name → handler, e.g. `{ click: fn }`. Memoize it. */
  onEvents?: Record<string, EChartEventHandler>;
  /** Called once with the live instance after init (for dispatchAction, etc.). */
  onReady?: (chart: EChartsType) => void;
  className?: string;
  style?: CSSProperties;
}

export function EChart({
  option,
  notMerge = true,
  onEvents,
  onReady,
  className,
  style,
}: EChartProps): React.ReactNode {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  // Create the instance once and keep it sized to the container.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = echarts.init(el);
    chartRef.current = chart;
    onReadyRef.current?.(chart);

    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(el);

    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  // Push option updates.
  useEffect(() => {
    chartRef.current?.setOption(option, notMerge);
  }, [option, notMerge]);

  // (Re)bind event handlers.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !onEvents) return;
    const entries = Object.entries(onEvents);
    for (const [event, handler] of entries) chart.on(event, handler as never);
    return () => {
      for (const [event, handler] of entries) chart.off(event, handler as never);
    };
  }, [onEvents]);

  return <div ref={containerRef} className={className} style={style} />;
}
