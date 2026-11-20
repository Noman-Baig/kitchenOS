'use client';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div className="card stack" style={{ maxWidth: 460 }}>
        <h1>Something went wrong</h1>
        <p className="muted">{error.message || 'An unexpected error occurred.'}{error.digest ? ` (ref ${error.digest})` : ''}</p>
        <div className="row"><button className="btn btn-primary" onClick={reset}>Try again</button><a className="btn" href="/">Home</a></div>
      </div>
    </main>
  );
}
