export function Banner({ error, notice, auth = false }: { error?: string | string[]; notice?: string | string[]; auth?: boolean }) {
  const e = Array.isArray(error) ? error[0] : error;
  const n = Array.isArray(notice) ? notice[0] : notice;
  return (
    <>
      {e ? <div className="banner" role="alert">{auth ? "Unable to complete sign-in. Check your details or try again." : e}</div> : null}
      {n ? <div className="banner ok" role="status">{auth ? n === "password-updated" ? "Password updated. Sign in with your new password." : "Check your email for account instructions, then sign in." : n}</div> : null}
    </>
  );
}
