export default function Loading() {
  return (
    <main className="setup-page" aria-busy="true">
      <div className="setup-card">
        <p className="eyebrow">PAWPORT</p>
        <h1>A little moment…</h1>
        <p className="muted" role="status">
          Opening your passport.
        </p>
      </div>
    </main>
  );
}
