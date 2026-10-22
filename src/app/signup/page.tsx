import Link from "next/link";
import {Brand} from "@/components/Brand";
import { signup } from "@/lib/auth-actions";
import { Banner } from "@/components/Banner";

export const metadata = { title: "Create account" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="auth">
      <Brand />
      <div className="card">
        <h1 className="u-font-size-22px">Create your workspace</h1>
        <Banner auth error={sp.error} />
        <form action={signup}>
          <div className="field">
            <label htmlFor="workspace_name">Business or agency name</label>
            <input id="workspace_name" name="workspace_name" required maxLength={80} />
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="field">
            <label htmlFor="password">Password (8+ characters)</label>
            <input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
          </div>
          <button className="btn u-width-100" type="submit" >Create account</button>
        </form>
      </div>
      <p className="muted small">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </main>
  );
}
