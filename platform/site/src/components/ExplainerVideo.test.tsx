import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { legal } from '../lib/legal';
import { ExplainerVideo } from './ExplainerVideo';

afterEach(cleanup);

describe('ExplainerVideo', () => {
  it('shows a still poster and fetches nothing of the video before it is pressed', () => {
    const { container } = render(<ExplainerVideo />);
    const video = container.querySelector('video')!;
    expect(video.getAttribute('preload')).toBe('none');
    expect(video.hasAttribute('autoplay')).toBe(false);
    expect(video.controls).toBe(false);
    expect(screen.getByRole('button', { name: legal.explainer.play })).toBeTruthy();
    expect(container.querySelector('img')!.getAttribute('src')).toBe('/video/explainer-wide-poster.jpg');
  });

  it('offers the phone cut below 48rem and the wide cut above it, AV1 first and H.264 for every other browser', () => {
    const { container } = render(<ExplainerVideo />);
    const sources = [...container.querySelectorAll('video source')].map((s) => [s.getAttribute('media'), s.getAttribute('src'), s.getAttribute('type')]);
    expect(sources).toEqual([
      ['(max-width: 47.99rem)', '/video/explainer-tall.webm', 'video/webm; codecs="av01.0.08M.08, opus"'],
      ['(max-width: 47.99rem)', '/video/explainer-tall.mp4', 'video/mp4'],
      [null, '/video/explainer-wide.webm', 'video/webm; codecs="av01.0.08M.08, opus"'],
      [null, '/video/explainer-wide.mp4', 'video/mp4'],
    ]);
  });

  it('offers the poster at the sizes the frame needs, WebP first, and waits to fetch it below the fold', () => {
    const { container } = render(<ExplainerVideo lazy sizes="(min-width: 80rem) 28rem, 100vw" />);
    const sources = [...container.querySelectorAll('picture source')].map((s) => [s.getAttribute('media'), s.getAttribute('type'), s.getAttribute('srcset')]);
    expect(sources).toEqual([
      ['(max-width: 47.99rem)', 'image/webp', '/video/explainer-tall-poster-720.webp 720w, /video/explainer-tall-poster-1080.webp 1080w'],
      ['(max-width: 47.99rem)', null, '/video/explainer-tall-poster-720.jpg 720w, /video/explainer-tall-poster.jpg 1080w'],
      [null, 'image/webp', '/video/explainer-wide-poster-720.webp 720w, /video/explainer-wide-poster-1080.webp 1080w, /video/explainer-wide-poster-1920.webp 1920w'],
    ]);
    const img = container.querySelector('img')!;
    expect(img.getAttribute('srcset')).toBe('/video/explainer-wide-poster-720.jpg 720w, /video/explainer-wide-poster-1080.jpg 1080w, /video/explainer-wide-poster.jpg 1920w');
    expect(img.getAttribute('sizes')).toBe('(min-width: 80rem) 28rem, 100vw');
    expect(img.getAttribute('loading')).toBe('lazy');
    cleanup();
    // Near the top of a page (How it works) it loads at once.
    expect(render(<ExplainerVideo />).container.querySelector('img')!.hasAttribute('loading')).toBe(false);
  });

  it('names only poster files that are in the public folder', () => {
    const { container } = render(<ExplainerVideo />);
    const urls = [...container.querySelectorAll('picture source, picture img')].flatMap((el) =>
      (el.getAttribute('srcset') ?? '').split(',').map((part) => part.trim().split(' ')[0]!).filter((url) => url !== ''),
    );
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(existsSync(resolve(process.cwd(), 'public', url.replace(/^\//, ''))), url).toBe(true);
  });

  it('plays with its controls when the poster is pressed', () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const { container } = render(<ExplainerVideo />);
    fireEvent.click(screen.getByRole('button', { name: legal.explainer.play }));
    const video = container.querySelector('video')!;
    expect(play).toHaveBeenCalledOnce();
    expect(video.controls).toBe(true);
    expect(screen.queryByRole('button', { name: legal.explainer.play })).toBeNull();
    play.mockRestore();
  });
});
