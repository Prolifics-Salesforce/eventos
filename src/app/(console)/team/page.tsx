import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { requirePrincipal } from "@/lib/session";
import { sysRole, sysUser, sysUserRole } from "@/db/schema";
import { createUserAction, resetPasswordAction } from "@/app/actions";
import { HUMAN_ROLES } from "@/platform/permissions";

export default async function Team({ searchParams }: { searchParams: Promise<{ notice?: string; ok?: string }> }) {
  const { notice, ok } = await searchParams;
  await requirePrincipal();
  const db = await getDb();
  const rows = await db.select({ u: sysUser, role: sysRole.name }).from(sysUser)
    .leftJoin(sysUserRole, eq(sysUserRole.userId, sysUser.id)).leftJoin(sysRole, eq(sysRole.id, sysUserRole.roleId)).orderBy(asc(sysUser.kind), asc(sysUser.name));
  return (
    <>
      <div className="head"><div><h1>Team</h1><div className="muted">People, agents and service accounts, all under the same roles.</div></div></div>
      {notice && <div className="notice">{notice}</div>}
      {ok && <div className="notice good">{ok}</div>}
      <div className="card">
        <h2>Add a person</h2>
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
          <thead><tr><th>Name</th><th>Kind</th><th>Email</th><th>Role</th><th>New password</th></tr></thead>
          <tbody>{rows.map(({ u, role }) => (
            <tr key={u.id + role}><td>{u.name}</td><td><span className="pill">{u.kind}</span></td><td className="muted">{u.email}</td><td>{role}</td>
              <td>{u.kind === "human" && (
                <form action={resetPasswordAction} className="actions"><input type="hidden" name="userId" value={u.id} />
                  <input name="password" type="password" minLength={10} required placeholder="At least 10 characters" autoComplete="new-password" style={{ width: 190 }} /><button className="ghost" type="submit">Reset</button></form>
              )}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}
