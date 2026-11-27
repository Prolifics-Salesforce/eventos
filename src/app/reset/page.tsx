import Link from "next/link";
import { requestResetAction } from "@/app/actions";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function ResetRequest({ searchParams }: { searchParams: Promise<{ sent?: string; notice?: string }> }) {
  const { sent, notice } = await searchParams;
  return (
    <div className="center">
      <div className="card">
        <h1>Forgot your password?</h1>
        {notice && <div className="notice" style={{ marginTop: 14 }}>{notice}</div>}
        {sent ? (
          <>
            <p className="muted">If that email belongs to someone on the team, a link to choose a new password is on its way. It works for an hour.</p>
            <p className="small faint">Nothing arrived? Check the address and your spam folder, or ask an administrator to reset it for you.</p>
          </>
        ) : (
          <>
            <p className="muted" style={{ margin: "8px 0 22px" }}>Enter the email you sign in with and we will send you a link to choose a new one.</p>
            <form action={requestResetAction} className="stack">
              <label>Email<input name="email" type="email" autoComplete="username" required autoFocus /></label>
              <button type="submit">Send the link</button>
            </form>
          </>
        )}
        <p className="small" style={{ margin: "16px 0 0" }}><Link href="/signin">Back to sign in</Link></p>
      </div>
    </div>
  );
}
