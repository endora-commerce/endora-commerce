import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Input } from '@endora-commerce/admin-kit/ui';
import { normalize } from '@endora-commerce/admin-kit/lib';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { varSnippet } from './insert-at-cursor.js';
import type { EmailVariableItem } from './variables.js';

export type { EmailVariableItem } from './variables.js';
export { varSnippet } from './insert-at-cursor.js';

type InsertHandler = (snippet: string) => void;

interface EmailVariablesContextValue {
  variables: EmailVariableItem[];
  openPicker: (onInsert: InsertHandler) => void;
}

const EmailVariablesContext = createContext<EmailVariablesContextValue | null>(null);

export function useEmailVariables(): EmailVariablesContextValue {
  const ctx = useContext(EmailVariablesContext);
  if (!ctx) {
    return {
      variables: [],
      openPicker: () => {
        /* no-op when provider is absent */
      },
    };
  }
  return ctx;
}

export function EmailVariablesProvider({
  variables,
  children,
}: {
  variables: EmailVariableItem[];
  children: ReactNode;
}): React.ReactElement {
  const t = useTranslation('core');
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pendingInsert, setPendingInsert] = useState<InsertHandler | null>(null);

  const openPicker = useCallback((onInsert: InsertHandler) => {
    setPendingInsert(() => onInsert);
    setQuery('');
    setOpen(true);
  }, []);

  const value = useMemo(() => ({ variables, openPicker }), [variables, openPicker]);

  const filtered = useMemo(() => {
    const q = normalize(query);
    if (!q) return variables;
    return variables.filter(
      (v) =>
        normalize(v.key).includes(q) ||
        normalize(v.label).includes(q) ||
        (v.description !== undefined && normalize(v.description).includes(q)),
    );
  }, [variables, query]);

  const close = (): void => {
    setOpen(false);
    setPendingInsert(null);
  };

  const pick = (item: EmailVariableItem): void => {
    const snippet = item.snippet ?? varSnippet(item.key);
    pendingInsert?.(snippet);
    close();
  };

  return (
    <EmailVariablesContext.Provider value={value}>
      {children}
      {open ? (
        // Issue #1493 (CONTENT-03): the kit's dialog, above the fullscreen
        // builder — focus trapped, Escape closes it, focus returns to the field.
        <ModalDialog
          layer="overlay"
          title={t('pageBuilder.emailVariables.title')}
          onClose={close}
          initialFocusRef={searchRef}
          footer={
            <Button type="button" variant="outline" onClick={close}>
              {t('common.action.cancel')}
            </Button>
          }
        >
          <div className="space-y-2">
            <Input
              ref={searchRef}
              type="search"
              aria-label={t('pageBuilder.emailVariables.search')}
              placeholder={`${t('pageBuilder.emailVariables.search')}…`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <ul className="max-h-[50vh] overflow-y-auto">
              {filtered.map((v) => (
                <li key={v.key}>
                  <button
                    type="button"
                    className="flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => pick(v)}
                  >
                    <span className="text-sm font-medium">{v.label}</span>
                    <span className="font-mono text-xs text-muted-foreground">{v.snippet ?? varSnippet(v.key)}</span>
                    {v.description ? <span className="text-xs text-muted-foreground">{v.description}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
            {/* Mounted before it has text, so "no match" is announced as the query narrows. */}
            <p role="status" className="px-3 text-center text-sm text-muted-foreground">
              {filtered.length === 0 ? t('pageBuilder.emailVariables.empty') : null}
            </p>
          </div>
        </ModalDialog>
      ) : null}
    </EmailVariablesContext.Provider>
  );
}
