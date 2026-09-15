export function PageHeader({ title, lede }: { title: string; lede?: string }) {
  return (
    <div className="hero">
      <h1>{title}</h1>
      {lede === undefined ? null : <p className="lede">{lede}</p>}
    </div>
  );
}
