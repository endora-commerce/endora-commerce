import { Fragment, type ReactNode } from 'react';
import { AUDIT_ERASED_MARKER } from '@endora-commerce/contracts';
import { Badge } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * An audit snapshot drawn as the JSON it is (issue #844).
 *
 * It replaces a raw `JSON.stringify`: the layout is the same — keys, nesting,
 * two-space indent, monospace — so support still compares two snapshots by
 * eye, but a value equal to the stored erased marker is drawn as a translated
 * token instead of the literal `"[erased]"`. Only an exact match is the marker;
 * a string that starts with it is ordinary data and is printed as typed.
 */
export function AuditStateView({ value }: { value: unknown }): ReactNode {
  return <>{renderValue(value, 0)}</>;
}

/** The muted "Erased" token, wherever the marker stands in for a value. */
export function ErasedValue(): ReactNode {
  const t = useTranslation('audit_logs');
  const label = t('auditLog.erased');
  return (
    <Badge variant="outline" className="px-1 py-0 font-sans text-xs font-normal italic text-muted-foreground" title={label}>
      {label}
    </Badge>
  );
}

/** A string column (the IP, the user agent): the token when it is the marker. */
export function AuditTextValue({ value, maxLength }: { value: string | null; maxLength?: number }): ReactNode {
  if (value === null || value === '') return '—';
  if (value === AUDIT_ERASED_MARKER) return <ErasedValue />;
  return maxLength !== undefined ? value.slice(0, maxLength) : value;
}

const INDENT = '  ';

function renderValue(value: unknown, depth: number): ReactNode {
  if (value === AUDIT_ERASED_MARKER) return <ErasedValue />;
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const pad = INDENT.repeat(depth + 1);
    return (
      <>
        {'[\n'}
        {value.map((element, index) => (
          <Fragment key={index}>
            {pad}
            {renderValue(element, depth + 1)}
            {index < value.length - 1 ? ',\n' : '\n'}
          </Fragment>
        ))}
        {`${INDENT.repeat(depth)}]`}
      </>
    );
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    const pad = INDENT.repeat(depth + 1);
    return (
      <>
        {'{\n'}
        {entries.map(([key, child], index) => (
          <Fragment key={key}>
            {`${pad}${JSON.stringify(key)}: `}
            {renderValue(child, depth + 1)}
            {index < entries.length - 1 ? ',\n' : '\n'}
          </Fragment>
        ))}
        {`${INDENT.repeat(depth)}}`}
      </>
    );
  }
  // A primitive prints exactly as `JSON.stringify` would have printed it.
  return JSON.stringify(value === undefined ? null : value);
}
