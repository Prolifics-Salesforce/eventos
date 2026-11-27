import { guestEnterAction } from "@/app/actions";

export const dynamic = "force-dynamic";
// The address is the credential: keep it out of search engines and out of the Referer header of anything this page loads.
export const metadata = { title: "Your events", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

/**
 * Where the link in a guest's sign-in email lands. Opening it asks first, so a
 * mail scanner that follows links does not use the link up before the guest does.
 */
export default async function Enter({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="center">
      <div className="card">
        <h1>Your events</h1>
        <p className="muted" style={{ margin: "8px 0 22px" }}>Continue to see the events you are registered for and your passes. This device will stay signed in for 30 days.</p>
        <form action={guestEnterAction}>
          <input type="hidden" name="token" value={token} />
          <button type="submit" autoFocus>Continue</button>
        </form>
      </div>
    </div>
  );
}
