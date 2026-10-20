import { resolveSiteOrigin } from "./site-origin";

/** Canonical origin for payment links and email redirects. */
export async function siteUrl(): Promise<string> {
  return resolveSiteOrigin(process.env.NEXT_PUBLIC_SITE_URL, process.env.NODE_ENV === "production");
}
