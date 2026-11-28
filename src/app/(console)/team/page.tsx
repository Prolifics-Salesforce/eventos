import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { can, requirePrincipal } from "@/lib/session";
import { Denied } from "@/components/denied";

import { sysRole, sysUser, sysUserRole } from "@/db/schema";
import { cookies } from "next/headers";
import { createUserAction, inviteUserAction, resetPasswordAction, setActiveAction, setEmailAction, setRoleAction } from "@/app/actions";
import { HUMAN_ROLES } from "@/platform/permissions";

export default async function Team({ searchParams }: { searchParams: Promise<{ notice?: string; ok?: string }> }) {
  const { notice, ok } = await searchParams;
  const me = await requirePrincipal();
  if (!can(me, "admin.manage")) return <Denied title="Team" />;
  const inviteLink = ok === "Invited" ? (await cookies()).get("eventos_flash")?.value : undefined;
  const db = await getDb();
  const rows = await db.select({ u: sysUser, role: sysRole.name }).from(sysUser)
    .leftJoin(sysUserRole, eq(sysUserRole.userId, sysUser.id)).leftJoin(sysRole, eq(sysRole.id, sysUserRole.roleId)).orderBy(asc(sysUser.kind), asc(sysUser.name));
  return (
    <>
      <div className="head"><div><h1>Team</h1><div className="muted">People, agents and service accounts, all under the same roles.</div></div></div>
      {notice && <div className="notice">{notice}</div>}
      {ok && <div className="notice good">{ok}</div>}
      {inviteLink && <div className="notice quiet" style={{ borderColor: "var(--amber)" }}>Email is not set up on this site, so the invitation could not be sent. Pass this link on yourself; it lets them choose their password and works once, for 7 days: <code style={{ color: "var(--ink)", userSelect: "all", wordBreak: "break-all" }}>{inviteLink}</code></div>}
      <div className="card">
        <h2>Invite a person <small className="small faint" style={{ fontWeight: 400 }}>they choose their own password</small></h2>
        <form action={inviteUserAction} className="row">
          <label>Name<input name="name" required minLength={2} /></label>
          <label>Email<input name="email" type="email" required /></label>
          <label>Role<select name="role" defaultValue="organiser">{HUMAN_ROLES.map((r) => <option key={r}>{r}</option>)}</select></label>
          <button type="submit">Send invitation</button>
        </form>
      </div>
      <div className="card">
        <h2>Add a person <small className="small faint" style={{ fontWeight: 400 }}>with a password you set</small></h2>
        <form action={createUserAction} className="row">
          <label>Name<input name="name" required minLength={2} /></label>
          <label>Email<input name="email" type="email" required /></label>
          <label>Role<select name="role" defaultValue="organiser">{HUMAN_ROLES.map((r) => <option key={r}>{r}</option>)}</select></label>
          <label>Starting password<input name="password" type="password" required minLength={10} autoComplete="new-password" /></label>
          <button type="submit">Add</button>
        </form>
      </div>
      <div className="card">
        <table>
          <thead><tr><th>Name</th><th>Kind</th><th>Email</th><th>Role</th><th>New password</th><th>Account</th></tr></thead>
          <tbody>{rows.map(({ u, role }) => (
            <tr key={u.id + role}><td>{u.name}</td><td><span className="pill">{u.kind}</span></td><td className="muted">{u.kind === "human" ? (
                <form action={setEmailAction} className="actions" style={{ flexWrap: "nowrap" }}><input type="hidden" name="userId" value={u.id} />
                  <input name="email" type="email" required defaultValue={u.email ?? ""} aria-label={`Email for ${u.name}`} style={{ width: 210 }} /><button className="link small" type="submit">Save</button></form>
              ) : u.email}</td>
              <td>{u.kind === "human" ? (
                <form action={setRoleAction} className="actions"><input type="hidden" name="userId" value={u.id} />
                  <select name="role" defaultValue={role ?? "organiser"} aria-label={`Role for ${u.name}`} style={{ width: "auto" }}>{HUMAN_ROLES.map((r) => <option key={r}>{r}</option>)}</select><button className="ghost" type="submit">Save</button></form>
              ) : role}</td>
              <td>{u.kind === "human" && (
                <form action={resetPasswordAction} className="actions"><input type="hidden" name="userId" value={u.id} />
                  <input name="password" type="password" minLength={10} required placeholder="At least 10 characters" autoComplete="new-password" style={{ width: 190 }} /><button className="ghost" type="submit">Reset</button></form>
              )}</td>
              <td>{u.kind === "human" && (u.id === me.id ? <span className="small faint">You</span> : (
                <form action={setActiveAction} className="actions"><input type="hidden" name="userId" value={u.id} /><input type="hidden" name="active" value={u.active ? "false" : "true"} />
                  {!u.active && <span className="pill">switched off</span>}<button className="link" type="submit">{u.active ? "Switch off" : "Switch back on"}</button></form>
              ))}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}
