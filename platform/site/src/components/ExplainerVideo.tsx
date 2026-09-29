import { useEffect, useRef, useState } from 'react';
import { legal } from '../lib/legal';
import { Glyph } from './Glyph';

// The explainer video (docs/specs/explainer-video.md), made by platform/explainer from this site's
// own words (legal.explainer), cards and agents. Until the viewer presses it, the poster plays a
// muted 8-second loop of the Pick a card scene (about 130 KB), or stays a still image under reduced
// motion; nothing of the full video is fetched before the press (preload none). Below 48rem the phone
// cut (4:5) plays; from 48rem the wide cut (16:9). Both come as AV1 in WebM for the browsers that
// take it and H.264 in MP4 for every other.

const PHONE = '(max-width: 47.99rem)';
const AV1 = 'video/webm; codecs="av01.0.08M.08, opus"';
const REDUCED = '(prefers-reduced-motion: reduce)';
const file = (cut: 'wide' | 'tall', ext: 'webm' | 'mp4' | 'jpg') => (ext === 'jpg' ? `/video/explainer-${cut}-poster.jpg` : `/video/explainer-${cut}.${ext}`);
const loop = (cut: 'wide' | 'tall') => `/video/explainer-${cut}-loop.mp4`;

/** Whether the viewer asked for reduced motion; true until known, so first paint is the still. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(REDUCED);
    setReduced(query.matches);
    const change = () => setReduced(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  return reduced;
}

export function ExplainerVideo() {
  const video = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const reduced = useReducedMotion();
  const preview = useRef<HTMLVideoElement>(null);

  // React sets muted as a property only, and some browsers then refuse to autoplay; mute and start
  // the loop from here instead.
  useEffect(() => {
    const element = preview.current;
    if (element === null) return;
    element.muted = true;
    element.setAttribute('muted', '');
    const play = () => void element.play().catch(() => undefined);
    play();
    element.addEventListener('canplay', play);
    return () => element.removeEventListener('canplay', play);
  }, [reduced, started]);
  const words = legal.explainer;

  function start() {
    setStarted(true);
    const element = video.current;
    if (element === null) return;
    element.controls = true;
    element.focus();
    // A browser that refuses to start leaves the controls up for a second press.
    element.play().catch(() => undefined);
  }

  return (
    <figure className="explainer" aria-label={words.heading}>
      <div className="explainer-frame">
        <video ref={video} preload="none" playsInline tabIndex={started ? 0 : -1} aria-label={words.heading}>
          <source media={PHONE} src={file('tall', 'webm')} type={AV1} />
          <source media={PHONE} src={file('tall', 'mp4')} type="video/mp4" />
          <source src={file('wide', 'webm')} type={AV1} />
          <source src={file('wide', 'mp4')} type="video/mp4" />
        </video>
        {started ? null : (
          // The play button is the label; the poster around it is a larger target for a pointer,
          // and a keyboard or screen reader reaches the one button.
          <div className="explainer-poster" onClick={start}>
            <picture>
              <source media={PHONE} srcSet={file('tall', 'jpg')} width={1080} height={1350} />
              <img src={file('wide', 'jpg')} alt="" width={1920} height={1080} />
            </picture>
            {reduced ? null : (
              <video ref={preview} className="explainer-loop" autoPlay muted loop playsInline aria-hidden="true" tabIndex={-1}>
                <source media={PHONE} src={loop('tall')} type="video/mp4" />
                <source src={loop('wide')} type="video/mp4" />
              </video>
            )}
            <button type="button" className="explainer-play" onClick={(event) => {
                event.stopPropagation();
                start();
              }}>
              <Glyph name="play" />
              <span className="explainer-play-label">{words.play}</span>
            </button>
          </div>
        )}
      </div>
    </figure>
  );
}
