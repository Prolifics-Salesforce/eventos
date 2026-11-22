import Link from "next/link";

export default function NotFound() {
  return (
    <div className="center">
      <div className="card">
        <h1>We can't find that page</h1>
        <p className="muted">The link may be old, or the event may not be open yet.</p>
        <Link className="button" href="/">Go to the start</Link>
      </div>
    </div>
  );
}
