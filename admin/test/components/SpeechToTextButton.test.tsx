import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SpeechToTextButton } from '../../../packages/admin-shell/src/components/SpeechToTextButton';

/**
 * Speech-to-text mic button: feature-detected (renders nothing without the Web
 * Speech API), toggles a recognition session, and forwards final transcripts.
 */

class FakeRecognition {
  lang = '';
  interimResults = false;
  continuous = false;
  onresult: ((e: unknown) => void) | null = null;
  onerror: (() => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn(() => this.onend?.());
}

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).SpeechRecognition;
  delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
});

describe('SpeechToTextButton', () => {
  it('renders nothing when the Web Speech API is unavailable', () => {
    const { container } = render(
      <SpeechToTextButton onTranscript={vi.fn()} startTitle="start" stopTitle="stop" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('starts a session and forwards the final transcript', () => {
    let instance: FakeRecognition | null = null;
    (window as unknown as Record<string, unknown>).SpeechRecognition = vi.fn(() => {
      instance = new FakeRecognition();
      return instance;
    });
    const onTranscript = vi.fn();
    render(<SpeechToTextButton onTranscript={onTranscript} startTitle="start" stopTitle="stop" />);

    fireEvent.click(screen.getByTitle('start'));
    expect(instance).not.toBeNull();
    expect(instance!.start).toHaveBeenCalled();
    // Button now reflects the listening state.
    expect(screen.getByTitle('stop')).toBeTruthy();

    instance!.onresult?.({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: 'update stock to 110' } }],
    });
    expect(onTranscript).toHaveBeenCalledWith('update stock to 110');
  });
});
