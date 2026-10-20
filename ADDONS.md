# BusinessHub plans and optional purchases

Implemented catalog: Free, Starter USD 19/month, Business USD 39/month, AI Builder USD 15/month separately. Assisted setup USD 49 one time is displayed as planned and cannot be purchased. Existing Growth records remain readable/reconcilable but new Growth checkouts are not offered.

The base subscription increases the existing AI/audit allowances; it does not claim to provide team invitations, file storage, connectors or automations. Those features are explicitly planned. AI Builder creates data-only internal forms and record trackers, not arbitrary software. It is separate from the core assistant.

## Access and lifecycle

Apply `database/proposals/paid-builder.sql` once, after the isolated base schema and billing lifecycle. Keep existing original `public` tables and auth accounts. The migration extends verified subscription records with `ai_builder`, excludes add-ons from `effective_billing_plan`, and requires both a verified paid main subscription and verified paid add-on for builder mutations. Refund/dispute holds, paid expiry, 48-hour verification freshness and sandbox isolation are inherited from the existing billing lifecycle.

Builder use is metered atomically at 10 generation attempts per UTC calendar month. Failed provider calls count. Only owners generate/publish; members may add records to a published tool while both purchases are active. Each tool has 12 fields maximum and a 1,000-record pilot limit. Definitions are validated, rendered through ordinary React inputs and never evaluated as code. Records remain readable to workspace members after expiry. The schema's cross-workspace foreign keys, RLS and restricted RPCs enforce isolation. Generation saves drafts; publication requires a separate action.

Each provider subscription is independent. Main-plan cancellation does NOT cancel the add-on automatically. Checkout consent, pricing and billing management explicitly disclose this. An owner can cancel or refresh a particular subscription by its local ID, checked against workspace, owner role and provider environment. Existing legacy base subscriptions continue reconciliation.

## Provider configuration before sales

Set USD currency, `PAYPAL_STARTER_MONTHLY_CENTS=1900`, `PAYPAL_BUSINESS_MONTHLY_CENTS=3900`, `PAYPAL_AI_BUILDER_MONTHLY_CENTS=1500` and create matching separate PayPal monthly plan IDs in `PAYPAL_PLAN_STARTER`, `PAYPAL_PLAN_BUSINESS`, `PAYPAL_PLAN_AI_BUILDER`. No trial, setup fee or tax surcharge is supported. Checkout validates the selected price against this catalog and independently fetches provider terms.

Keep SUBSCRIPTIONS_ENABLED=disabled and PAYPAL_LIVE_VERIFIED=no until base + add-on real provider tests pass. Tests/builds do not establish that credentials work. Need reachable signed webhook delivery, reconciliation cron, support email, correct Supabase server key, auth redirects and production-domain review as listed in BILLING.md. Do not treat a preview deployment as a production launch.

## Verification

Run all Vitest tests and Next.js build. New tests cover free/paid separation, add-on-only not upgrading a base plan, sandbox and stale verification denying access, refund/expiry lock, read retention, quota cap, draft-before-publish, tenant isolation, model completion validation and bounded field parsing.

Before charging customers, test actual main + add-on checkout, webhook receipt, duplicate notifications, targeted cancellation, renewal, refund, failed payment, owner/member roles, and real Gemini generation on the deployed application. Existing cron scans 100 subscription records total; replace with paginated scheduling before exceeding the pilot cap. Two subscriptions per workspace reduce the number of workspaces that fit under that cap.
