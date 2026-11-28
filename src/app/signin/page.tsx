import { redirect } from "next/navigation";
import { signInAction } from "@/app/actions";
import { currentPrincipal } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SignIn({ searchParams }: { searchParams: Promise<{ notice?: string; ok?: string }> }) {
  if (await currentPrincipal()) redirect("/");
  const { notice, ok } = await searchParams;
  return (
    <div className="center">
      <div className="card">
        <div className="brand" style={{ padding: 0, fontSize: 32 }}>Event<i>OS</i></div>
        <p className="muted" style={{ margin: "8px 0 22px" }}>Your events, run with a team of agents you stay in charge of.</p>
        {notice && <div className="notice">{notice}</div>}
        {ok && <div className="notice good">{ok}</div>}
        <form action={signInAction} className="stack">
          <label>Email<input name="email" type="email" autoComplete="username" required autoFocus /></label>
          <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
          <button type="submit">Sign in</button>
        </form>
        <p className="small" style={{ margin: "16px 0 0" }}><a href="/reset">Forgot your password?</a></p>
        <p className="small muted" style={{ margin: "18px 0 0", paddingTop: 16, borderTop: "1px solid var(--rule-soft)" }}>Attending an event? <a href="/my">See your events and passes</a>. This page is for the organising team.</p>
      </div>
    </div>
  );
}
