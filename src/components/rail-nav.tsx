"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./icons";

export type RailItem = { href: string; label: string; icon: string; count?: number };

/** The main navigation, with the screen you are on picked out. */
export function RailNav({ items }: { items: RailItem[] }) {
  const path = usePathname();
  return (
    <>
      {items.map((n) => {
        const on = path === n.href || path.startsWith(`${n.href}/`);
        return (
          <Link key={n.href} href={n.href} className={`nav ${on ? "on" : ""}`} aria-current={on ? "page" : undefined} title={n.label}>
            <Icon name={n.icon} /><span className="label">{n.label}</span>
            {n.count ? <span className="count">{n.count}</span> : null}
          </Link>
        );
      })}
    </>
  );
}
