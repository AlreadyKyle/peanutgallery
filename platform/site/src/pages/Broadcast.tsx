import { useEffect, useState, type CSSProperties } from 'react';
import { CardFace } from '../components/Card';
import { feedFromSnapshot, useFeed } from '../lib/community';
import { useStudioDoc } from '../components/LiveStudio';
import { MachineMark } from '../components/Mark';
import { Pipe } from '../components/Pipe';
import { StudioRoom } from '../components/StudioRoom';
import { copy } from '../lib/copy';
import { groupCards, fundingPlace } from '../lib/cards';
import { qrModules, qrPath } from '../lib/qr';
import { useStudio } from '../lib/studio';

// /broadcast (docs/specs/final-state.md, Channels): a 1920 by 1080 overlay that OBS or any streaming
// tool loads as a browser source. The live studio, the pipe, the top three cards open for funding and
// "Fund at mobmachine.games" with a QR code drawn in code (lib/qr.ts). Unlisted and not indexed: no
// link points here and the top bar and footer are not drawn (App.tsx). The frame scales to fit a
// smaller window, so a preview shows the whole of it.

export const BROADCAST_PATH = '/broadcast';
export const FUND_URL = 'https://mobmachine.games/contribute';

function useScale(): number {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080) || 1);
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  return scale;
}

function Qr() {
  const modules = qrModules(FUND_URL);
  const size = modules.length + 8;
  return (
    <svg className="qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={copy.broadcast.qrLabel} shapeRendering="crispEdges">
      <rect className="qr-ground" x={0} y={0} width={size} height={size} />
      <path className="qr-module" d={qrPath(modules)} />
    </svg>
  );
}

export function Broadcast() {
  const studio = useStudio();
  const doc = useStudioDoc();
  const feed = useFeed();
  const scale = useScale();
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    document.title = `${copy.broadcast.title} · ${copy.studioName}`;
    return () => {
      meta.remove();
      document.title = copy.studioName;
    };
  }, []);
  const snapshot = studio.state === 'ready' ? studio.snapshot : null;
  const top = snapshot === null ? [] : groupCards(snapshot.cards, fundingPlace(snapshot)).fund.slice(0, 3);
  const live = feed.state === 'ready';
  return (
    <main className="broadcast" style={{ '--broadcast-scale': scale } as CSSProperties}>
      <div className="band broadcast-head">
        <p className="broadcast-brand">
          <MachineMark />
          <span>{copy.studioName}</span>
        </p>
        <h1 className="broadcast-pitch">{copy.pitchTitle}</h1>
        <div className="broadcast-fund">
          <p>
            <span className="broadcast-fund-line">{copy.broadcast.fundAt}</span>
            <span className="broadcast-url">{copy.broadcast.url}</span>
          </p>
          <Qr />
        </div>
      </div>
      <div className="band broadcast-body">
        <div className="broadcast-room">
          {snapshot === null ? <p className="muted">{studio.state === 'loading' ? copy.broadcast.loading : copy.broadcast.unavailable}</p> : <StudioRoom snapshot={snapshot} studio={doc} facts={false} />}
        </div>
        <div className="broadcast-side">
          <Pipe
            events={live ? feed.events : snapshot === null ? [] : feedFromSnapshot(snapshot)}
            live={live}
            loading={feed.state === 'loading'}
            hasOlder={false}
            loadingOlder={false}
            onOlder={() => undefined}
            pageSize={5}
            headingLevel={2}
            paging={false}
          />
          <section className="broadcast-cards" aria-labelledby="broadcast-cards">
            <h2 id="broadcast-cards">{copy.broadcast.cardsTitle}</h2>
            {snapshot === null || top.length === 0 ? (
              <p className="muted">{copy.broadcast.noCards}</p>
            ) : (
              <ul className="card-grid broadcast-grid">
                {top.map((card) => (
                  <CardFace key={card.id} card={card} snapshot={snapshot} mode="example" compact />
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
