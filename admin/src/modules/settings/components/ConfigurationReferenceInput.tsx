import { useEffect, useState, type ReactNode } from 'react';
import type {
  ConfigurationDto,
  ConfigurationListResponse,
} from '@endora-commerce/contracts';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { useTranslation } from '@/i18n/useTranslation';
import { ConfigurationPreviewModal } from '@/modules/credentials/components/ConfigurationPreviewModal';

/**
 * List the configurations of one type (feature 091, P6).
 *
 * The request is built here rather than through `credentials`' own admin API
 * client: that client is another module's **code**, which is what the
 * cross-module ledger recorded, while `/api/v1/admin/credentials` and
 * `ConfigurationListResponse` are an HTTP path and a
 * `@endora-commerce/contracts` type that both sides already compile. That is
 * the exit P2 established and `admin-kit-surface.md` R6 records. The reach into
 * `ConfigurationPreviewModal` below is a **component** reach and is a different
 * repair, still ledgered.
 */
function listConfigurations(type: string): Promise<ConfigurationDto[]> {
  return apiClient
    .get<ConfigurationListResponse>(
      `/api/v1/admin/credentials?type=${encodeURIComponent(type)}`,
    )
    .then((res) => res.configurations);
}

/**
 * Settings field editor for the `credential_ref` value type (feature 058 US2).
 *
 * Reads the setting's `configurationType`, loads the matching configurations,
 * and renders a picker (value = configuration code) plus a preview button that
 * opens the read-only `ConfigurationPreviewModal` (secrets masked). Modeled on
 * `ImageSettingInput`.
 */
interface Props {
  /** The configuration type the reference is constrained to (e.g. `'llm'`). */
  configurationType: string | null | undefined;
  /** Current value — a configuration code (may be empty ⇒ not configured). */
  value: string;
  onChange: (next: string) => void;
}

export function ConfigurationReferenceInput({
  configurationType,
  value,
  onChange,
}: Props): ReactNode {
  const t = useTranslation('credentials');
  const [options, setOptions] = useState<ConfigurationDto[]>([]);
  const [preview, setPreview] = useState<ConfigurationDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!configurationType) {
      setOptions([]);
      return;
    }
    void listConfigurations(configurationType)
      .then((list) => {
        if (!cancelled) setOptions(list);
      })
      .catch(() => {
        if (!cancelled) setOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [configurationType]);

  const selected = options.find((o) => o.code === value) ?? null;

  return (
    <div className="flex items-center gap-2">
      <Select
        className="flex-1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.code} value={o.code}>
            {o.name} ({o.code})
          </option>
        ))}
      </Select>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!selected}
        onClick={() => setPreview(selected)}
      >
        {t('action.preview')}
      </Button>

      <ConfigurationPreviewModal
        open={preview !== null}
        configuration={preview}
        onClose={() => setPreview(null)}
      />
    </div>
  );
}
