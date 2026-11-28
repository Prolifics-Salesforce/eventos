import { guestEnterAction } from "@/app/actions";

export const dynamic = "force-dynamic";
// The address is the credential: keep it out of search engines and out of the Referer header of anything this page loads.
export const metadata = { title: "Your events", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

/**
 * Where the link in a guest's sign-in email lands. Opening it asks first, so a
 * mail scanner that follows links does not use the link up before the guest does.
 */
export default async function Enter({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ direct?: string }> }) {
  const { token } = await params;
  const { direct } = await searchParams;
  return (
    <div className="center">
      <div className="card">
        <h1>Your events</h1>
        {direct && <div className="notice quiet" style={{ marginTop: 14 }}>Email is not set up on this site yet, so instead of emailing you a link we have brought you straight here.</div>}
        <p className="muted" style={{ margin: "8px 0 22px" }}>Continue to see the events you are registered for and your passes. This device will stay signed in for 30 days.</p>
        <form action={guestEnterAction}>
          <input type="hidden" name="token" value={token} />
          <button type="submit" autoFocus>Continue</button>
        </form>
      </div>
    </div>
  );
}
