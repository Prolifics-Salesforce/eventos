import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { principalForSession } from "@/platform/auth";
import type { Permission } from "@/platform/permissions";
import type { Principal } from "@/platform/principal";

export const SESSION_COOKIE = "eventos_session";

/** Looked up once per request, however many layouts, pages and components ask. */
export const currentPrincipal = cache(async (): Promise<Principal | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? principalForSession(await getDb(), token) : null;
});

/**
 * For every console page and action: the signed-in person, or a trip to the sign-in page.
 * Every page calls this itself. A layout's check is not enough: layouts are not
 * rendered again when someone moves between pages.
 */
export async function requirePrincipal(): Promise<Principal> {
  const principal = await currentPrincipal();
  if (!principal) redirect("/signin");
  return principal;
}

/** Whether this person's roles include a permission. Screens ask before showing; tools ask again before changing. */
export const can = (principal: Principal, permission: Permission): boolean => principal.permissions.has(permission);

/** The role a team member holds, for showing beside their name. Worked out from what they may do. */
export function roleLabel(principal: Principal): "Admin" | "Organiser" | "Sales" | "Desk" | "Viewer" | "Team" {
  if (principal.permissions.has("admin.manage")) return "Admin";
  if (principal.permissions.has("event.write")) return "Organiser";
  if (principal.permissions.has("lead.write")) return "Sales";
  if (principal.permissions.has("checkin.write")) return "Desk";
  if (principal.permissions.has("event.read")) return "Viewer";
  return "Team";
}
