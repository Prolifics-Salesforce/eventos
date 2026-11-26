/** Shown the moment a floor screen is asked for, while its data is on the way. */
export default function Loading() {
  return (
    <div className="loading" role="status" aria-label="Loading">
      <div className="bone title" />
      <div className="bone row" />
      <div className="bone row" />
      <div className="bone row" />
    </div>
  );
}
