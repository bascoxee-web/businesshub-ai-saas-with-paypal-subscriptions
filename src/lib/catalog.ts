/** Public product catalog. Prices are USD; checkout must independently verify PayPal terms. */
export const hubPlans = [
  { id: 'starter', name: 'Starter', cents: 1900, messages: 300, audits: 20, description: 'Keep customers, jobs and invoices in one place.' },
  { id: 'business', name: 'Business', cents: 3900, messages: 6000, audits: 300, description: 'More capacity for a busy business.' },
] as const;
export const builderOffer = { id: 'ai_builder', name: 'AI Builder', cents: 1500, builds: 10 } as const;
export function usd(cents: number) { return new Intl.NumberFormat('en-US', {style:'currency', currency:'USD', maximumFractionDigits:0}).format(cents/100); }
export function isPaidHubPlan(plan: string) { return ['starter','growth','business'].includes(plan); }
export const coreFeatures = ['Customer contacts and notes', 'Projects, tasks and deadlines', 'Itemized invoices and payment tracking', 'Business dashboard', 'AI assistance with confirmed actions', 'Website audit findings and follow-up tasks'];
