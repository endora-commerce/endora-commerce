import { type ReactNode } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSpeechToText } from './hooks/useSpeechToText';

/**
 * Mic toggle that dictates speech into a text field via the Web Speech API.
 * Renders nothing when the browser lacks the API (graceful degradation), so it
 * is safe to drop next to any input. Final transcripts are handed to
 * `onTranscript`; the parent decides whether to append or replace.
 */
export function SpeechToTextButton({
  onTranscript,
  lang,
  startTitle,
  stopTitle,
}: {
  onTranscript: (text: string) => void;
  lang?: string;
  startTitle: string;
  stopTitle: string;
}): ReactNode {
  const { supported, listening, toggle } = useSpeechToText({ onTranscript, ...(lang ? { lang } : {}) });
  if (!supported) return null;
  const title = listening ? stopTitle : startTitle;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={listening}
      aria-label={title}
      title={title}
      className={cn(
        'grid h-7 w-7 shrink-0 place-items-center rounded border-0 bg-transparent text-[var(--fg-muted)] transition hover:text-[var(--fg)] cursor-pointer',
        listening && 'animate-pulse text-[var(--danger,#ef4444)]',
      )}
    >
      {listening ? <MicOff size={16} /> : <Mic size={16} />}
    </button>
  );
}
