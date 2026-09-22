"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clock, Hospital, Shield } from "./Icon";
import { useT, type Key } from "@/lib/i18n";

const TABS: { href: string; label: Key; Icon: (p: { size?: number }) => React.ReactElement }[] = [
  { href: "/", label: "nav_alert", Icon: Shield },
  { href: "/help", label: "nav_help", Icon: Hospital },
  { href: "/history", label: "nav_history", Icon: Clock },
];

export default function Nav() {
  const path = usePathname();
  const { t } = useT();
  // Setup owns the whole screen — a nav bar there invites people to skip the
  // one thing the app needs before it can tell them anything at all.
  if (path === "/setup") return null;
  return (
    <nav className="tabs">
      {TABS.map(({ href, label, Icon }) => (
        <Link key={href} href={href} aria-current={path === href ? "page" : undefined}>
          <Icon />
          {t(label)}
        </Link>
      ))}
    </nav>
  );
}
