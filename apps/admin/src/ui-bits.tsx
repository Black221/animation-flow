// The loader: the animator's first exercise, a ball that bounces (the same as the app's).
export function Bounce({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div className="bounce" role="status">
      <span className="stage" aria-hidden><span className="ball" /><span className="shadow" /></span>
      <span className="muted">{label}</span>
    </div>
  );
}
