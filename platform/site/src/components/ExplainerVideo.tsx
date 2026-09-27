import { useRef, useState } from 'react';
import { legal } from '../lib/legal';
import { Glyph } from './Glyph';

// The explainer video (docs/specs/explainer-video.md), made by platform/explainer from this site's
// own words (legal.explainer), cards and agents. First paint is still: a poster until the viewer
// presses it, and nothing of the video is fetched before then (preload none). Below 48rem the phone
// cut (4:5) plays; from 48rem the wide cut (16:9). Both come as AV1 in WebM for the browsers that
// take it and H.264 in MP4 for every other. The transcript under it says every line the video shows.

const PHONE = '(max-width: 47.99rem)';
const AV1 = 'video/webm; codecs="av01.0.08M.08, opus"';
const file = (cut: 'wide' | 'tall', ext: 'webm' | 'mp4' | 'jpg') => (ext === 'jpg' ? `/video/explainer-${cut}-poster.jpg` : `/video/explainer-${cut}.${ext}`);

export function ExplainerVideo({ id }: { id: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  // The transcript's lines are drawn once it is opened, so the page does not say the pitch twice.
  const [reading, setReading] = useState(false);
  const words = legal.explainer;
  const transcriptId = `${id}-transcript`;

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
        <video ref={video} preload="none" playsInline tabIndex={started ? 0 : -1} aria-label={words.heading} aria-describedby={transcriptId}>
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
            <button type="button" className="explainer-play" onClick={(event) => {
                event.stopPropagation();
                start();
              }} aria-describedby={`${id}-length`}>
              <Glyph name="play" />
              {words.play}
            </button>
          </div>
        )}
      </div>
      <figcaption className="explainer-caption">
        <p id={`${id}-length`}>{words.length}</p>
        <details id={transcriptId} className="explainer-transcript" onToggle={(event) => setReading(event.currentTarget.open)}>
          <summary>{words.transcript}</summary>
          {reading ? (
            <ol>
              {words.beats.map((beat) => (
                <li key={beat.line}>
                  {beat.step === null ? null : <strong>{beat.step}. </strong>}
                  {beat.line}
                </li>
              ))}
            </ol>
          ) : null}
        </details>
      </figcaption>
    </figure>
  );
}
