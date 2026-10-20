# BusinessHub recurring billing

Implemented in the existing Vercel project and preview branch; no live charge is enabled by this change. This is a monthly SaaS subscription checkout, separate from customer invoice payments. Existing invoice PayPal flags remain off.

## What the code now does

- Validates provider plan ID, exact monthly price and currency before checkout. Supports one unlimited monthly regular cycle, no trials, setup fee, tax surcharge or quantity override. Currency is USD or PHP; display and provider must match.
- Requires workspace owner access, explicit recurring-price consent, immutable server configured checkout terms, stable idempotency keys and provider/custom checkout identity matching.
- Refetches PayPal subscription and transaction records instead of trusting browser return parameters or webhook resource status. ACTIVE alone gives no paid entitlement; only a matching completed payment grants at most one calendar month.
- Atomically records payment IDs and event IDs. Stale snapshots cannot overwrite newer state. Verified refunds, reversals and disputes create sticky review holds, including notifications received before the original payment.
- Cancel stops future renewals. The last verified paid period remains accessible until its end; suspended/expired/risk-held subscriptions do not get paid features. Plan changes/resubscription wait until the existing period ends. No automatic refund API is called; issue refunds in PayPal and review their notifications.
- Authenticated members can read only their own subscription summary. Client writes, payment records, webhook records and privilege changes are denied. Only service-role operations bind subscriptions and write verified payments.
- AI and audit metering derive live access from verified billing records at request time. Sandbox never upgrades a live workspace. Expired payments and records not reconciled for 48 hours fall back to free access.
- Signed webhooks and authenticated daily reconciliation refresh status. The pilot reconciliation job has a hard cap of 100 total subscription records, including history; replace with a paginated worker before exceeding this cap. Check failures in Vercel logs; 503 is intentional when reconciliation fails.

## Database

The additive `database/proposals/billing-lifecycle.sql` was applied as `businesshub_verified_subscription_billing` on October 18, 2026. For a new installation, apply it once to the existing `businesshub` schema after the local PGlite tests pass. It does not change Grader tables or auth users. Do not reapply `businesshub-shared-project.sql`.

## Owner inputs still required

1. Approved plan prices and currency; configure matching PayPal plans in the same REST app. The initial pilot can expose just one plan. Plan limits are free 20 / starter 300 / growth 1500 / business 6000 AI messages per calendar month and 3 / 20 / 100 / 300 live audit attempts. Approve prices against actual provider costs; no trial or unlimited usage is promised.
2. A monitored billing support email and agreed refund/support terms. Render the email on the billing page; publish final terms before selling.
3. PayPal Sandbox REST app client ID, client secret and webhook ID. Then separate Live REST app credentials/plan IDs. Connecting the PayPal ChatGPT app does not provision these credentials, catalog plans or application webhooks.
4. Correct VisionGrader Supabase service-role/secret key in server-only `SUPABASE_SERVICE_ROLE_KEY`; the current preview override is deliberately blank. Never copy the old key for a different project. Enter directly in Vercel, never in chat/GitHub.

## Environment and URLs

Preview: scope Sandbox credentials and Config values to Preview, branch `codex/businesshub-visionai`. Set PAYPAL_ENV=sandbox and SUBSCRIPTIONS_ENABLED=sandbox only after all required values exist.

Secrets: PAYPAL_CLIENT_SECRET, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET. Use Secret for PAYPAL_CLIENT_ID as well. Config: PAYPAL_ENV, PAYPAL_WEBHOOK_ID, PAYPAL_PLAN_STARTER/GROWTH/BUSINESS, PAYPAL_STARTER/GROWTH/BUSINESS_MONTHLY_CENTS, PAYPAL_BILLING_CURRENCY, BILLING_SUPPORT_EMAIL, SUBSCRIPTIONS_ENABLED, PAYPAL_LIVE_VERIFIED.

Canonical production target: `https://app.titusville-adminsolution.site` (domain and production deployment still need configuration). Webhook path `/api/paypal/webhook`. Return path `/app/billing`. Cron path `/api/billing/reconcile` (Authorization: Bearer CRON_SECRET). A PayPal webhook must reach the endpoint without an interactive Vercel login. Do not disable protection for the whole preview; use a separate permitted test endpoint/deployment or Vercel's scoped webhook bypass, and keep any bypass secret private. Do not use the protected branch URL as a working webhook without verifying delivery.

Webhook events: BILLING.SUBSCRIPTION.CREATED, BILLING.SUBSCRIPTION.ACTIVATED, BILLING.SUBSCRIPTION.UPDATED, BILLING.SUBSCRIPTION.CANCELLED, BILLING.SUBSCRIPTION.SUSPENDED, BILLING.SUBSCRIPTION.EXPIRED, BILLING.SUBSCRIPTION.PAYMENT.FAILED, PAYMENT.SALE.COMPLETED, PAYMENT.SALE.REFUNDED, PAYMENT.SALE.REVERSED, CUSTOMER.DISPUTE.CREATED, CUSTOMER.DISPUTE.UPDATED, CUSTOMER.DISPUTE.RESOLVED. If invoice payments are later enabled, also CHECKOUT.ORDER.APPROVED and PAYMENT.CAPTURE.COMPLETED.

## Release checks (not yet performed against PayPal)

- Approve prices, terms, support and actual published features. Confirm merchant account can accept subscriptions in its region and selected currency.
- Check app credentials authenticate and the provider plans have exactly the displayed terms.
- Sandbox: checkout → approve → signed webhook → verified completed transaction; replay webhook; wrong amount/currency; pending/failed payment; cancel; expire; refund; dispute; different workspace access. Confirm the paid entitlement stays free for Sandbox.
- Verify webhook delivery and cron authorization/runs on the deployed HTTPS endpoint. Confirm failed verification never changes plan access. Ensure notifications/reconciliation errors are monitored.
- Production: configure the same database URL and corresponding public/server credentials, canonical domain/auth redirects and separate Live PayPal app/plan/webhook values. Merge/release the reviewed preview. Never copy live payment credentials into Preview.
- Only after all checks, explicitly set production SUBSCRIPTIONS_ENABLED=live and PAYPAL_ENV=live plus PAYPAL_LIVE_VERIFIED=yes; the code also checks VERCEL_ENV=production. Verify the authorized first real checkout with its real displayed price and reconcile it. Do not charge a test card or customer's account without that payer's authorization.
- If new sales must stop, set SUBSCRIPTIONS_ENABLED=disabled. Keep credentials, webhook and cron active so cancellations, refunds and existing subscribers still reconcile.

## Verification evidence

Automated tests cover identity/price matching, monthly boundaries, completed-vs-pending payments, approval hosts, live release gates, RLS and owner rights, duplicate/stale notifications, expiry, cancellations and out-of-order refund holds. These tests and a successful Next build do not replace a real sandbox purchase/webhook test.

Database verification: settlement execution is denied to anon/authenticated and allowed to service_role. All new tables have RLS. Advisors report intentional member-checked privileged RPCs and the token-scoped public invoice RPC; invoice_counters remains intentionally inaccessible. Existing leaked-password protection is disabled in Supabase Auth; enable through owner account settings before public launch. See https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection .
