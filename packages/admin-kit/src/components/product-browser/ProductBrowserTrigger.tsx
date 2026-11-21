import { useId, type ReactNode } from 'react';
import { PackageSearch } from 'lucide-react';
import { useAuth } from '../../lib/index.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { Button } from '../../ui/button.js';

/**
 * The **Browse products** button that opens `ProductBrowserDialog` (feature 145).
 *
 * It carries the picker's one permission gate (FR-013): without `catalog:read` the
 * button is disabled and says why. The gate is a permission and never a module's
 * presence — `catalog` is not deactivatable, and the kit names no module (R-12). A
 * host may disable it for its own reason too; the two combine, the permission's
 * hint winning because it is the one the operator cannot fix on this screen.
 *
 * The hint is rendered text linked by `aria-describedby`, not only a `title`: a
 * disabled button takes no focus, so a tooltip alone would reach nobody using a
 * keyboard or a screen reader.
 */
export interface ProductBrowserTriggerProps {
  onOpen: () => void;
  /** Host-level reason to disable (e.g. a system price list), combined with the gate. */
  disabled?: boolean | undefined;
  disabledReason?: string | undefined;
  /** Defaults to `productBrowser.trigger`. */
  label?: string | undefined;
}

export function ProductBrowserTrigger(props: ProductBrowserTriggerProps): ReactNode {
  const t = useTranslation('core');
  const { hasPermission } = useAuth();
  const hintId = useId();
  const canRead = hasPermission('catalog:read');
  const disabled = !canRead || props.disabled === true;
  const hint = !canRead
    ? t('productBrowser.trigger.noPermission')
    : props.disabled === true
      ? (props.disabledReason ?? null)
      : null;

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        aria-describedby={hint !== null ? hintId : undefined}
        title={hint ?? undefined}
        onClick={props.onOpen}
      >
        <PackageSearch size={14} aria-hidden="true" />
        {props.label ?? t('productBrowser.trigger')}
      </Button>
      {hint !== null ? (
        <span id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </span>
      ) : null}
    </span>
  );
}
