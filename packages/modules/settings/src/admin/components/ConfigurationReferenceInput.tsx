import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import type {
  ConfigurationDto,
  ConfigurationListResponse,
} from '@endora-commerce/contracts';
import { apiClient, useSurfaceVisibility } from '@endora-commerce/admin-kit/lib';
import { Button, Select } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
/**
 * Loaded lazily, and that is a **build** decision rather than a performance one
 * (`specs/110-instance-repository/` T138).
 *
 * `credentials` is an **optional** peer of this package — `manifests:generate`
 * marks a peer optional when only a UI layer reaches it — so a client's instance
 * that did not install `credentials` has no such package, and a *static* named
 * import of one is a bundle that does not build. Measured on the acceptance
 * criterion's own scaffolded instance: Vite binds an unresolved optional peer to
 * an `__vite-optional-peer-dep:` stub, and a named import off a stub is
 * `"ConfigurationPreviewModal" is not exported by …` — which takes out the whole
 * admin bundle, every module's screens with it, over one button.
 *
 * A dynamic import is not analysed that way, so the stub survives to runtime,
 * where it is never reached: the render below is already gated on the module's
 * presence (Z12), and a module that is not installed is never present. The gate
 * was there first and answers the operator's question; this answers the
 * bundler's, and neither stands in for the other.
 */
const ConfigurationPreviewModal = lazy(() =>
  import('@endora-commerce/mod-credentials/admin-ui').then((module) => ({
    default: module.ConfigurationPreviewModal,
  })),
);

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
 * repair — D-191's `./admin-ui`, taken in batch 10 — and it is **still
 * ledgered**, because Z11 keeps a published-component reach counted.
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
 *
 * ## Two things batch 10 changed about it, and both are seam decisions
 *
 * **The preview button gates on `credentials`' presence** (Z12). A statically
 * imported component is filtered by nothing, and `credentials` declares an
 * activation control — so with the module switched off the modal would render
 * over an API that answers 503 and a picker whose list is already empty. The
 * predicate is the one every other admin surface uses; this is its fourth kind
 * of caller. The gate is here rather than inside the modal because only the
 * consumer knows what the absence should collapse: the button and nothing else,
 * so the operator keeps the stored value and the field it sits in.
 *
 * **Its copy is this module's** (R-1 §9.2, one surface over). The button read
 * `useTranslation('credentials')` for a single label — a module id written as a
 * string in a file `credentials` does not own, which
 * `backend/scripts/ledgers/foreign-module-ids.ts` recorded as its
 * `module-namespace:credentials` entry. The string a settings field shows
 * belongs in the settings bundle, so `editor.credentialRef.preview` is a key of
 * this module's and the entry retires because the coupling is **gone**, not
 * because this file left the walk the check reads.
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
  const t = useTranslation('settings');
  const isVisible = useSurfaceVisibility();
  const credentialsPresent = isVisible({ module: 'credentials' });
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
      {credentialsPresent ? (
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!selected}
            onClick={() => setPreview(selected)}
          >
            {t('editor.credentialRef.preview')}
          </Button>

          <Suspense fallback={null}>
            <ConfigurationPreviewModal
              open={preview !== null}
              configuration={preview}
              onClose={() => setPreview(null)}
            />
          </Suspense>
        </>
      ) : null}
    </div>
  );
}
