import Link from "next/link";
import { login } from "@/lib/auth-actions";
import { Banner } from "@/components/Banner";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="auth">
      <div className="brand" style={{ padding: 0, marginBottom: 14, fontSize: 22 }}>
        BusinessHub<span style={{ color: "var(--accent)" }}> VisionAI</span>
      </div>
      <div className="card">
        <h1 style={{ fontSize: 22 }}>Sign in</h1>
        <Banner auth error={sp.error} notice={sp.notice} />
        <form action={login}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
          <button className="btn" type="submit" style={{ width: "100%" }}>Sign in</button>
        </form>
      </div>
      <p className="muted small">
        <Link href="/forgot-password">Forgot password?</Link><br />
        New here? <Link href="/signup">Create an account</Link>
      </p>
    </main>
  );
}
