# Vercel integration

Use npm ci and npm run build. The application uses the businesshub Supabase schema, not public. The initial schema was already applied to VisionGrader ijqfgwkaulcapkrtancm; do not reapply it there. Confirm Vercel uses that project before testing authenticated workflows. Preserve unrelated schemas.

Configure the variables documented in .env.example directly in Vercel. Set NEXT_PUBLIC_SITE_URL to the exact deployed origin and allow its /auth/callback URL in Supabase Auth redirects. Gemini and Firecrawl keys remain server only. PayPal subscriptions remain sandbox only and do not grant paid entitlements. Do not enable live payments until renewal, cancellation, refund and dispute reconciliation have been implemented and tested.

Validate two independent user workspaces, password recovery email, client/project/task/invoice CRUD, AI proposal confirmation, SEO evidence, and sandbox payment flows on HTTPS before release.
