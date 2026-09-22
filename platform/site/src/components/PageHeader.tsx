import { useEffect, type ReactNode } from 'react';
import { copy } from '../lib/copy';

export function PageHeader({ title, lede, children }: { title: string; lede?: string; children?: ReactNode }) {
  // Each page names itself in the tab and in history; leaving it puts the studio name back.
  useEffect(() => {
    document.title = `${title} · ${copy.studioName}`;
    return () => {
      document.title = copy.studioName;
    };
  }, [title]);

  return (
    <div className="hero">
      <h1>{title}</h1>
      {lede === undefined ? null : <p className="lede">{lede}</p>}
      {children}
    </div>
  );
}
