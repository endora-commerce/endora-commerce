import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Button, Input } from '@endora-commerce/admin-kit/ui';
import { normalize } from '@endora-commerce/admin-kit/lib';
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

  const pick = (item: EmailVariableItem): void => {
    const snippet = item.snippet ?? varSnippet(item.key);
    pendingInsert?.(snippet);
    setOpen(false);
    setPendingInsert(null);
  };

  return (
    <EmailVariablesContext.Provider value={value}>
      {children}
      {open ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Insert variable"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setOpen(false);
              setPendingInsert(null);
            }
          }}
        >
          <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border bg-background shadow-lg">
            <div className="space-y-2 border-b p-4">
              <h2 className="text-sm font-semibold">Insert variable</h2>
              <Input
                autoFocus
                placeholder="Search variables…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto p-2">
              {filtered.map((v) => (
                <li key={v.key}>
                  <button
                    type="button"
                    className="flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left hover:bg-muted"
                    onClick={() => pick(v)}
                  >
                    <span className="text-sm font-medium">{v.label}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {v.snippet ?? varSnippet(v.key)}
                    </span>
                    {v.description ? (
                      <span className="text-xs text-muted-foreground">{v.description}</span>
                    ) : null}
                  </button>
                </li>
              ))}
              {filtered.length === 0 ? (
                <li className="px-3 py-6 text-center text-sm text-muted-foreground">No matches.</li>
              ) : null}
            </ul>
            <div className="flex justify-end border-t p-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setOpen(false);
                  setPendingInsert(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </EmailVariablesContext.Provider>
  );
}
