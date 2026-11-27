import Link from "next/link";
import { completeResetAction } from "@/app/actions";

export const dynamic = "force-dynamic";
// The address is the credential: keep it out of search engines and out of the Referer header of anything this page loads.
export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default async function ResetPassword({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ notice?: string }> }) {
  const { token } = await params;
  const { notice } = await searchParams;
  return (
    <div className="center">
      <div className="card">
        <h1>Choose a new password</h1>
        {notice && <div className="notice" style={{ marginTop: 14 }}>{notice}</div>}
        <form action={completeResetAction} className="stack" style={{ marginTop: 18 }}>
          <input type="hidden" name="token" value={token} />
          <label>New password, at least 10 characters<input name="password" type="password" required minLength={10} autoComplete="new-password" autoFocus /></label>
          <button type="submit">Save and sign in again</button>
        </form>
        <p className="small" style={{ margin: "16px 0 0" }}><Link href="/signin">Back to sign in</Link></p>
      </div>
    </div>
  );
}
