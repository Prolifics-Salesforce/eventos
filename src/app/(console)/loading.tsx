/** Shown the moment a screen is asked for, while its data is on the way. */
export default function Loading() {
  return (
    <div className="loading" role="status" aria-label="Loading">
      <div className="bone title" />
      <div className="bone line" />
      <div className="bone block" />
      <div className="bone row" />
      <div className="bone row" />
      <div className="bone row" />
    </div>
  );
}
