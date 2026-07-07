'use client';

import { useEffect, useState } from 'react';
import type { SettingsScope } from '../types/responsive.js';
import { getStoredScope, subscribeScope } from './settings-scope-store.js';

/** Reactive scope for a component — reads from the module store (not React context). */
export function useComponentScope(componentId: string | undefined): SettingsScope {
  const [scope, setScope] = useState<SettingsScope>(() => getStoredScope(componentId));

  useEffect(() => {
    setScope(getStoredScope(componentId));
    return subscribeScope(() => {
      setScope(getStoredScope(componentId));
    });
  }, [componentId]);

  return scope;
}
