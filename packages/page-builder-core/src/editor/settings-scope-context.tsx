import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import { FieldLabel } from '@measured/puck';
import { SETTINGS_SCOPE_LABELS, type SettingsScope } from '../types/responsive.js';
import { setStoredScope } from './settings-scope-store.js';
import { useComponentScope } from './use-component-scope.js';
import { usePageBuilderPuck } from './use-page-builder-puck.js';

const SettingsScopeContext = createContext<{
  scope: SettingsScope;
  setScope: (scope: SettingsScope) => void;
} | null>(null);

/** @deprecated Scope is stored in settings-scope-store; provider no longer required for field transforms. */
export function SettingsScopeProvider({
  children,
  componentId,
}: {
  children: ReactNode;
  componentId?: string;
}): ReactElement {
  const scope = useComponentScope(componentId);

  const setScope = (next: SettingsScope): void => {
    setStoredScope(componentId, next);
  };

  return (
    <SettingsScopeContext.Provider value={{ scope, setScope }}>
      {children}
    </SettingsScopeContext.Provider>
  );
}

export function useSettingsScope(): { scope: SettingsScope; setScope: (scope: SettingsScope) => void } {
  const ctx = useContext(SettingsScopeContext);
  if (!ctx) {
    return { scope: 'base', setScope: () => undefined };
  }
  return ctx;
}

const SCOPE_OPTIONS: SettingsScope[] = ['base', 'tablet', 'desktop'];

export function SettingsScopeSelector(): ReactElement {
  const componentId = usePageBuilderPuck((s) => s.selectedItem?.props.id as string | undefined);
  const scope = useComponentScope(componentId);

  return (
    <div>
      <FieldLabel label="Scope settings" />
      <select
        aria-label="Scope settings"
        className="_Input-input_bsxfo_26"
        style={{ width: '100%', boxSizing: 'border-box' }}
        value={scope}
        onChange={(e): void => setStoredScope(componentId, e.target.value as SettingsScope)}
      >
        {SCOPE_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {SETTINGS_SCOPE_LABELS[option]}
          </option>
        ))}
      </select>
    </div>
  );
}
