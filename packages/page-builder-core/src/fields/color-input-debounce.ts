export function createDebouncedColorCommit(
  onCommit: (hex: string) => void,
  debounceMs = 200,
): {
  schedule: (hex: string) => void;
  commitNow: (hex: string) => void;
  dispose: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    schedule(hex: string): void {
      flush();
      timer = setTimeout(() => {
        onCommit(hex);
        timer = null;
      }, debounceMs);
    },
    commitNow(hex: string): void {
      flush();
      onCommit(hex);
    },
    dispose: flush,
  };
}
