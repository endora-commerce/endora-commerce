import { type ReactNode } from 'react';
import { ColorPicker } from '@/components/ui/color-picker';
import { ORDER_STATUS_COLOR_PRESETS } from './orderStatusColor';

/**
 * Order-status colour picker — a thin wrapper around the core
 * {@link ColorPicker} that supplies the curated order-status preset palette.
 * Kept as a named component so existing call sites stay unchanged.
 */
export function StatusColorPicker(props: {
  value: string;
  onChange: (hex: string) => void;
  /** Accessible label for the trigger + custom input. */
  label: string;
  customLabel: string;
}): ReactNode {
  return (
    <ColorPicker
      value={props.value}
      onChange={props.onChange}
      label={props.label}
      customLabel={props.customLabel}
      presets={ORDER_STATUS_COLOR_PRESETS}
    />
  );
}
