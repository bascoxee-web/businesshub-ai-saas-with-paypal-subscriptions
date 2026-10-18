> **Database update, October 17, 2026:** The approved BusinessHub schema is now applied to VisionGrader. See `database/APPLIED.md`. Do not reapply the initial SQL. Hosting, API schema exposure and live testing are still pending.

# BusinessHub VisionAI — October 17, 2026 build

## Implemented in source
- BusinessHub VisionAI branding and Gemini function-calling adapter. Request-scoped model parts preserve tool-call thought signatures. Provider failures/truncated output fail closed. Gemini is not yet connected to live credentials.
- Email recovery, authenticated password update, same-origin callback destination allowlist and sign-out after password change. Actual email delivery/PKCE still needs deployed testing.
- Firecrawl live single-page audits plus HTML snapshot audits. Public URL validation, TLS verification, bounded response streaming, fresh retrieval, workspace reports, explicit evidence labels and finding-to-task conversion.
- Database-enforced AI and audit allowances. AI confirmation and its resulting write run in one transaction; retries return the stored result. Draft invoice creation is transactional and issued invoices are protected in the database proposal.
- PayPal subscription sandbox checkout, server-side identity/status verification and cancellation. Real subscription billing and automatic paid entitlements remain disabled and unfinished.
- Cloudflare Workers build configuration with OpenNext. No routes, DNS changes or deployment were made; private access setup is still required.

## Verification scope
99 automated tests pass. Automated tests cover tenant isolation, invoice rollback/protection, atomic AI confirmation, audit allowances, URL validation, failed scrape handling, Gemini tool round trips, recovery input validation and sandbox subscription guards. TypeScript checks pass. The production dependency audit reports zero known vulnerabilities. Cloudflare build and dry-run results are in the handoff. Provider tests use mocks; SQL runs in isolated PGlite. Browser layout/accessibility, real credentials, deployed auth/email, payments and domain routing remain unverified.

## Database proposal
The app targets an isolated `businesshub` schema in the intended VisionGrader project. `database/proposals/businesshub-shared-project.sql` is generated and review-only. It creates no global signup trigger and touches no Grader data. The historical `supabase/migrations` files are regression fixtures, not instructions for VisionGrader. Nothing has been applied remotely.

## Before accepting paying customers
1. Approve/apply/verify the database and private hosting configuration, with live RLS/advisor and customer A/B tests.
2. Finalize prices, allowances, cost budgets and customer terms/support. Existing allowances are pilot values, not a public offer.
3. Implement verified subscription webhooks and paid entitlement lifecycle: renewals, failed payments, cancellations, expiration, refunds, disputes, duplicate/out-of-order events and reconciliation. Sandbox checkout does not change plans.
4. Add multi-business selection with explicit active-workspace scoping throughout existing queries; each new customer currently receives one workspace.
5. Complete deployed end-to-end testing. Add invoice business contact details and downloadable PDFs if needed for the launch offer.
6. Port Search Console CSV opportunities and authorized Google integrations as a separate module. Existing Grader data/integrations were not imported.
7. Prepare Android/Google Play packaging and current platform billing-policy review after the web pilot is accepted.

See `CLOUDFLARE.md` for the concrete setup sequence and required environment settings. No passwords or keys belong in chat or the source ZIP.
