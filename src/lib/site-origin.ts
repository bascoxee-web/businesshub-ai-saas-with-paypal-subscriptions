/** Use a configured, validated origin; never derive payment or email links from request headers. */
export function resolveSiteOrigin(configured: string | undefined, production: boolean): string {
  if (!configured) {
    if (production) throw new Error("NEXT_PUBLIC_SITE_URL is required in production");
    return "http://localhost:3000";
  }
  const url = new URL(configured);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && local && !production))) {
    throw new Error("NEXT_PUBLIC_SITE_URL must be an HTTPS origin without credentials, path, query or fragment");
  }
  return url.origin;
}
