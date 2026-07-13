'use client';

import {
  Children,
  isValidElement,
  memo,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { FieldLabel } from '@measured/puck';
import type { Field } from '@measured/puck';
import { SETTINGS_SCOPE_LABELS, type SettingsScope } from '../types/responsive.js';
import { fieldTabForName, componentHasDataFields, componentHasResponsiveFields } from './field-tabs.js';
import { setStoredScope } from './settings-scope-store.js';
import {
  getStoredSettingsTab,
  setStoredSettingsTab,
  subscribeSettingsTab,
  type SettingsTab,
} from './settings-tab-store.js';
import { useComponentScope } from './use-component-scope.js';
import { usePageBuilderPuck } from './use-page-builder-puck.js';

const SCOPE_OPTIONS: SettingsScope[] = ['base', 'tablet', 'desktop'];

const TAB_LABELS: Record<SettingsTab, string> = {
  general: 'General',
  data: 'Data',
  responsive: 'Responsive',
};

function visibleTabs(hasData: boolean, hasResponsive: boolean): SettingsTab[] {
  const tabs: SettingsTab[] = ['general'];
  if (hasData) tabs.push('data');
  if (hasResponsive) tabs.push('responsive');
  return tabs;
}

const tabBarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  overflowX: 'auto',
  flexShrink: 0,
  paddingTop: '8px',
  paddingBottom: '8px',
  marginBottom: '8px',
  borderBottom: '1px solid var(--puck-color-grey-09, #dce3ea)',
  WebkitOverflowScrolling: 'touch',
};

const panelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  height: '100%',
};

const scrollStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
};

const scopePanelStyle: React.CSSProperties = {
  marginInline: '16px',
  marginBottom: '16px',
  paddingBlock: '14px',
  paddingInline: '16px',
  borderRadius: '8px',
  background: 'var(--puck-color-grey-12, #f6f8fa)',
  border: '1px solid var(--puck-color-grey-09, #dce3ea)',
};

function tabButtonStyle(active: boolean): React.CSSProperties {
  return {
    flexShrink: 0,
    border: 'none',
    borderRadius: '6px',
    padding: '6px 12px',
    fontSize: '12px',
    fontWeight: active ? 600 : 500,
    cursor: 'pointer',
    background: active ? 'var(--puck-color-grey-11, #eef2f6)' : 'transparent',
    color: active ? 'var(--puck-color-black, #000)' : 'var(--puck-color-grey-04, #5a6b7d)',
  };
}

function ScopeSelectorControl(): ReactElement {
  const componentId = usePageBuilderPuck((s) => s.selectedItem?.props.id as string | undefined);
  const scope = useComponentScope(componentId);

  return (
    <div style={scopePanelStyle}>
      <FieldLabel label="Scope settings" />
      <select
        id="pb-settings-scope"
        aria-label="Scope settings"
        className="_Input-input_bsxfo_26"
        style={{ width: '100%', boxSizing: 'border-box', marginTop: '4px' }}
        value={scope}
        onChange={(e): void => {
          setStoredScope(componentId, e.target.value as SettingsScope);
        }}
      >
        {SCOPE_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {SETTINGS_SCOPE_LABELS[option]}
          </option>
        ))}
      </select>
      <p style={{ margin: '8px 0 0', paddingInline: '2px', fontSize: '12px', color: 'var(--puck-color-grey-04, #5a6b7d)' }}>
        Fields below apply to the selected scope. Switch Puck viewports (Mobile / Tablet / Desktop) to preview each breakpoint.
      </p>
    </div>
  );
}

function useSettingsTab(
  componentId: string | undefined,
  hasData: boolean,
  hasResponsive: boolean,
): SettingsTab {
  const hasTabs = hasData || hasResponsive;
  const tabs = visibleTabs(hasData, hasResponsive);
  const [tab, setTab] = useState<SettingsTab>(() => {
    const stored = getStoredSettingsTab(componentId);
    return tabs.includes(stored) ? stored : 'general';
  });

  useEffect(() => {
    const stored = getStoredSettingsTab(componentId);
    const allowed = visibleTabs(hasData, hasResponsive);
    setTab(hasTabs && allowed.includes(stored) ? stored : 'general');
  }, [componentId, hasData, hasResponsive, hasTabs]);

  useEffect(() => {
    return subscribeSettingsTab(() => {
      const stored = getStoredSettingsTab(componentId);
      const allowed = visibleTabs(hasData, hasResponsive);
      setTab(hasTabs && allowed.includes(stored) ? stored : 'general');
    });
  }, [componentId, hasData, hasResponsive, hasTabs]);

  return hasTabs ? tab : 'general';
}

function childFieldName(child: ReactNode): string | null {
  if (!isValidElement(child)) return null;
  const props = child.props as { fieldName?: string };
  return typeof props.fieldName === 'string' ? props.fieldName : null;
}

function FieldsTabPanelInner({
  children,
}: {
  children: ReactNode;
  isLoading: boolean;
  itemSelector?: unknown;
}): ReactElement {
  const componentId = usePageBuilderPuck((s) => s.selectedItem?.props.id as string | undefined);
  const itemType = usePageBuilderPuck((s) => s.selectedItem?.type as string | undefined);
  const config = usePageBuilderPuck((s) => s.config);
  const fields = itemType ? config.components[itemType]?.fields : undefined;
  const hasResponsive = componentHasResponsiveFields(fields);
  const hasData = componentHasDataFields(fields);
  const hasTabs = hasResponsive || hasData;
  const activeTab = useSettingsTab(componentId, hasData, hasResponsive);
  const tabs = visibleTabs(hasData, hasResponsive);

  const childEntries = useMemo(
    () =>
      Children.toArray(children).map((child) => ({
        child,
        fieldName: childFieldName(child),
      })),
    [children],
  );

  return (
    <div style={panelStyle}>
      {hasTabs ? (
        <div style={{ ...tabBarStyle, paddingInline: '16px' }} role="tablist" aria-label="Component settings">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              style={tabButtonStyle(activeTab === tab)}
              onClick={(): void => setStoredSettingsTab(componentId, tab)}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>
      ) : null}
      <div style={scrollStyle}>
        {hasResponsive && activeTab === 'responsive' ? <ScopeSelectorControl /> : null}
        {childEntries.map(({ child, fieldName }) => {
          if (!fieldName) return <div key="pb-field-unknown">{child}</div>;
          const field = fields?.[fieldName] as Field | undefined;
          const tab = fieldTabForName(fieldName, field);
          const visible = !hasTabs || tab === activeTab;
          return (
            <div key={fieldName} style={{ display: visible ? 'block' : 'none' }}>
              {child}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const FieldsTabPanel = memo(FieldsTabPanelInner);
