export function PageHeader({ title, lede }: { title: string; lede?: string }) {
  return (
    <div className="masthead">
      <h1 className="display">{title}</h1>
      {lede === undefined ? null : <p className="lede">{lede}</p>}
    </div>
  );
}
