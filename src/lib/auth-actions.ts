"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/site";
import { failTo } from "@/lib/auth";
import { firstError } from "@/lib/schemas";

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  password: z.string().min(1, "Enter your password"),
});

const signupSchema = z.object({
  workspace_name: z.string().trim().min(1, "Give your workspace a name").max(80),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  password: z.string().min(8, "Use at least 8 characters").max(200),
});

export async function login(formData: FormData) {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) failTo("/login", firstError(parsed.error));
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  // Same message for unknown email and wrong password, so it can't be used to probe accounts.
  if (error) failTo("/login", "Email or password is incorrect");
  redirect("/app");
}

export async function signup(formData: FormData) {
  const parsed = signupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) failTo("/signup", firstError(parsed.error));
  const { email, password, workspace_name } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { workspace_name },
      emailRedirectTo: `${await siteUrl()}/auth/callback`,
    },
  });
  if (error) failTo("/signup", error.message);
  // With email confirmation switched on in Supabase there is no session yet.
  if (!data.session) redirect(`/login?notice=${encodeURIComponent("Check your email to confirm your account, then sign in.")}`);
  redirect("/app");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
