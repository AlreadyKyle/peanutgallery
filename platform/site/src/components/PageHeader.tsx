import type { ReactNode } from 'react';

export function PageHeader({ title, lede, children }: { title: string; lede?: string; children?: ReactNode }) {
  return (
    <div className="hero">
      <h1>{title}</h1>
      {lede === undefined ? null : <p className="lede">{lede}</p>}
      {children}
    </div>
  );
}
