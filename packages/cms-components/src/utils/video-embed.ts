export type VideoProvider = 'auto' | 'youtube' | 'vimeo' | 'generic';

export type VideoAspectRatio = '16:9' | '4:3' | '1:1';

const ASPECT_PADDING: Record<VideoAspectRatio, string> = {
  '16:9': '56.25%',
  '4:3': '75%',
  '1:1': '100%',
};

export function aspectPadding(ratio: VideoAspectRatio): string {
  return ASPECT_PADDING[ratio];
}

export function detectVideoProvider(url: string): Exclude<VideoProvider, 'auto'> {
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
  if (/vimeo\.com/i.test(url)) return 'vimeo';
  return 'generic';
}

function youtubeId(url: string): string | null {
  const short = url.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
  if (short) return short[1] ?? null;
  const watch = url.match(/[?&]v=([a-zA-Z0-9_-]+)/);
  if (watch) return watch[1] ?? null;
  const embed = url.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]+)/);
  return embed?.[1] ?? null;
}

function vimeoId(url: string): string | null {
  const match = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  return match?.[1] ?? null;
}

export function buildVideoEmbedUrl(
  url: string,
  provider: VideoProvider,
  opts: { autoplay?: boolean; muted?: boolean; loop?: boolean; controls?: boolean },
): string | null {
  const resolved = provider === 'auto' ? detectVideoProvider(url) : provider;
  const params = new URLSearchParams();
  if (opts.autoplay) params.set('autoplay', '1');
  if (opts.muted) params.set('mute', '1');
  if (opts.loop) params.set('loop', '1');
  if (opts.controls === false) params.set('controls', '0');

  if (resolved === 'youtube') {
    const id = youtubeId(url);
    if (!id) return null;
    if (opts.loop) params.set('playlist', id);
    const qs = params.toString();
    return `https://www.youtube.com/embed/${id}${qs ? `?${qs}` : ''}`;
  }
  if (resolved === 'vimeo') {
    const id = vimeoId(url);
    if (!id) return null;
    const qs = params.toString();
    return `https://player.vimeo.com/video/${id}${qs ? `?${qs}` : ''}`;
  }
  if (/^https:\/\//i.test(url)) return url;
  return null;
}
