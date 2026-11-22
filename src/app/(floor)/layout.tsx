import type { ReactNode } from "react";
import { requirePrincipal } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Screens for the venue floor: one column, big targets, no side navigation. */
export default async function FloorLayout({ children }: { children: ReactNode }) {
  await requirePrincipal();
  return <div className="phone">{children}</div>;
}
