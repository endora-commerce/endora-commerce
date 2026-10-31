import { describe, expect, it } from 'vitest';

import { bulkOperationLogText } from './bulk-operation-log-text.js';

const polish: Record<string, string> = {
  'bulkOperations.log.started': 'Rozpoczęto przetwarzanie operacji ({total} elementów).',
};
const t = (key: string, params?: Record<string, string | number>): string => {
  const template = polish[key];
  if (template === undefined) return `catalog.${key}`;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    params?.[name] != null ? String(params[name]) : match,
  );
};

describe('bulkOperationLogText', () => {
  it("draws the entry's key in the reader's language", () => {
    expect(
      bulkOperationLogText(t, {
        message: 'Started processing the operation (4 items).',
        messageKey: { key: 'bulkOperations.log.started', params: { total: 4 } },
      }),
    ).toBe('Rozpoczęto przetwarzanie operacji (4 elementów).');
  });

  it('draws the stored sentence for a key the bundle does not carry', () => {
    expect(
      bulkOperationLogText(t, { message: 'Something else.', messageKey: { key: 'bulkOperations.log.other' } }),
    ).toBe('Something else.');
  });

  it('draws the stored sentence of an entry written before keys existed', () => {
    expect(bulkOperationLogText(t, { message: 'Operacja nie powiodła się: x' })).toBe(
      'Operacja nie powiodła się: x',
    );
  });
});
