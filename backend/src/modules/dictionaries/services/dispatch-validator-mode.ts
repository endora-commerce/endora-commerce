import type { DictionaryWriteMode } from '@b2b/contracts';

export function dispatchValidatorMode(
  currentValue: string | null | undefined,
  incomingValue: string | null | undefined,
): DictionaryWriteMode {
  if (!currentValue) return 'create-or-change';
  if (!incomingValue) return 'unchanged';
  return currentValue === incomingValue ? 'unchanged' : 'create-or-change';
}
