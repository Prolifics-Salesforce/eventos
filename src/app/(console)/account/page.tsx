import { changePasswordAction, signOutAction } from "@/app/actions";
import { requirePrincipal } from "@/lib/session";

export default async function Account({ searchParams }: { searchParams: Promise<{ notice?: string; ok?: string }> }) {
  const { notice, ok } = await searchParams;
  const me = await requirePrincipal();
  return (
    <>
      <div className="head"><div><h1>{me.name}</h1><div className="muted">Your account.</div></div><form action={signOutAction}><button type="submit" className="ghost">Sign out</button></form></div>
      {notice && <div className="notice">{notice}</div>}
      {ok && <div className="notice good">{ok}</div>}
      <div className="card" style={{ maxWidth: 460 }}>
        <h2>Change password</h2>
        <form action={changePasswordAction} className="stack">
          <label>Current password<input name="current" type="password" required autoComplete="current-password" /></label>
          <label>New password, at least 10 characters<input name="password" type="password" required minLength={10} autoComplete="new-password" /></label>
          <button type="submit">Change password</button>
        </form>
      </div>
    </>
  );
}
