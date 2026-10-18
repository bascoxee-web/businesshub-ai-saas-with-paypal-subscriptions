import Link from "next/link";
import { logout } from "@/lib/auth-actions";

const links = [
  { href: "/app", label: "Dashboard" },
  { href: "/app/clients", label: "Clients" },
  { href: "/app/projects", label: "Projects" },
  { href: "/app/invoices", label: "Invoices" },
  { href: "/app/seo", label: "SEO Grader" },
  { href: "/app/assistant", label: "AI Assistant" },
  { href: "/app/billing", label: "Plan & billing" },
];

export function Nav({ workspaceName, email }: { workspaceName: string; email: string }) {
  return (
    <aside className="side">
      <div className="brand">
        BusinessHub<span> VisionAI</span>
      </div>
      {links.map((l) => (
        <Link key={l.href} href={l.href} className="nav">{l.label}</Link>
      ))}
      <div className="spacer" />
      <div className="who">
        <strong style={{ color: "#fff" }}>{workspaceName}</strong>
        <br />
        {email}
      </div>
      <form action={logout}>
        <button className="btn ghost small" style={{ color: "#cbd8d1", borderColor: "#3b4d46", width: "100%" }}>Sign out</button>
      </form>
    </aside>
  );
}
