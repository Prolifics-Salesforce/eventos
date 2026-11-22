"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="center">
      <div className="card">
        <h1>Something went wrong</h1>
        <p className="muted">Nothing you entered has been lost on our side. Try again; if it keeps happening, tell the person who runs this instance.</p>
        <button onClick={reset}>Try again</button>
      </div>
    </div>
  );
}
