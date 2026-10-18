# Applied database setup — October 17, 2026

User approved applying the prepared setup to VisionGrader. Migration `businesshub_visionai_initial_schema` succeeded.

Verified: 16 BusinessHub tables, all with RLS enabled; no custom global Auth signup triggers; anonymous onboarding denied; authenticated customers cannot bind payment-provider records; service-role schema usage allowed. A SQL request under the authenticated role with no user claim saw zero workspaces, clients or reports. No customer data was created by these checks.

Security advisor returned only the informational `rls_enabled_no_policy` notice for `businesshub.invoice_counters`. This is intentional: direct API access is denied and numbering is managed through the existing protected trigger/function.

Data API schema exposure has not been verified/configured. No explicit pgrst.db_schemas role setting was found; that does not establish the platform's effective API schema list. Check Exposed schemas in the project Data API settings and add businesshub while preserving existing entries. Authentication redirect/email configuration, private Cloudflare deployment, secrets and deployed end-to-end tests remain pending.

Do not reapply the initial schema SQL: it has already been applied to VisionGrader. Keep it for reproducibility on a new test project.
