# BusinessHub AI

BusinessHub AI is an all-in-one workspace for freelancers and agencies, with CRM, projects, invoicing, client portals, and AI-assisted workflows.

## Going live

1. Set `PAYPAL_ENV=live` and use your live PayPal client ID and secret.
2. Set `NEXT_PUBLIC_PAYPAL_CLIENT_ID` to the same live client ID.
3. Set `PAYPAL_WEBHOOK_ID` to the webhook created in your live PayPal app.
4. Run the protected setup page at `/admin/setup` with `SETUP_TOKEN` to create the live catalog and plans.
5. Configure PayPal webhooks for subscription activation, updates, cancellation, suspension, expiration, failed payments, and completed sales.

Supabase auth and row-level security are configured through the connected project migration.
