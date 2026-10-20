import { requireWorkspace } from "@/lib/auth";
import { Nav } from "@/components/Nav";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, ws } = await requireWorkspace();
  return (
    <div className="shell">
      <a href="#main-content" className="skip-link">Skip to content</a>
      <Nav workspaceName={ws.name} email={user.email ?? ""} />
      <main id="main-content" tabIndex={-1} className="main">{children}</main>
    </div>
  );
}
