import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { legal } from '../lib/legal';
import { ExplainerVideo } from './ExplainerVideo';

afterEach(cleanup);

describe('ExplainerVideo', () => {
  it('shows a still poster and fetches nothing of the video before it is pressed', () => {
    const { container } = render(<ExplainerVideo id="t" />);
    const video = container.querySelector('video')!;
    expect(video.getAttribute('preload')).toBe('none');
    expect(video.hasAttribute('autoplay')).toBe(false);
    expect(video.controls).toBe(false);
    expect(screen.getByRole('button', { name: legal.explainer.play })).toBeTruthy();
    expect(container.querySelector('img')!.getAttribute('src')).toBe('/video/explainer-wide-poster.jpg');
  });

  it('offers the phone cut below 48rem and the wide cut above it, AV1 first and H.264 for every other browser', () => {
    const { container } = render(<ExplainerVideo id="t" />);
    const sources = [...container.querySelectorAll('video source')].map((s) => [s.getAttribute('media'), s.getAttribute('src'), s.getAttribute('type')]);
    expect(sources).toEqual([
      ['(max-width: 47.99rem)', '/video/explainer-tall.webm', 'video/webm; codecs="av01.0.08M.08, opus"'],
      ['(max-width: 47.99rem)', '/video/explainer-tall.mp4', 'video/mp4'],
      [null, '/video/explainer-wide.webm', 'video/webm; codecs="av01.0.08M.08, opus"'],
      [null, '/video/explainer-wide.mp4', 'video/mp4'],
    ]);
  });

  it('plays with its controls when the poster is pressed', () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const { container } = render(<ExplainerVideo id="t" />);
    fireEvent.click(screen.getByRole('button', { name: legal.explainer.play }));
    const video = container.querySelector('video')!;
    expect(play).toHaveBeenCalledOnce();
    expect(video.controls).toBe(true);
    expect(screen.queryByRole('button', { name: legal.explainer.play })).toBeNull();
    play.mockRestore();
  });

  it('says its length and reads out every line it shows once the transcript is opened', () => {
    const { container } = render(<ExplainerVideo id="t" />);
    expect(screen.getByText(legal.explainer.length)).toBeTruthy();
    const details = container.querySelector('details')!;
    expect(details.querySelectorAll('li')).toHaveLength(0);
    details.open = true;
    fireEvent(details, new Event('toggle'));
    const lines = [...details.querySelectorAll('li')].map((li) => li.textContent);
    expect(lines).toEqual(legal.explainer.beats.map((beat) => (beat.step === null ? beat.line : `${beat.step}. ${beat.line}`)));
  });
});
