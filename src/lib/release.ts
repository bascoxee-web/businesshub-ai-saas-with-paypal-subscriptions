/** Server-only release switches. Only the literal 'true' enables a feature. */
export function allowIndexing(env: Record<string,string|undefined> = process.env) { return env.ALLOW_INDEXING === 'true'; }
export function paidPlansEnabled(env: Record<string,string|undefined> = process.env) { return env.PAID_PLANS_ENABLED === 'true'; }
