// Monthly AI Assistant messages per plan.
// PLACEHOLDER NUMBERS: set these to match the limits on your pricing page before launch.
export const PLAN_LIMITS = {
  free: { aiMessages: 20 },
  pro: { aiMessages: 300 },
  agency: { aiMessages: 6000 },
  starter: { aiMessages: 300 },
  growth: { aiMessages: 1500 },
  business: { aiMessages: 6000 },
} as const;

export type Plan = keyof typeof PLAN_LIMITS;

export function aiMessageLimit(plan: string): number {
  return (PLAN_LIMITS as Record<string, { aiMessages: number }>)[plan]?.aiMessages ?? PLAN_LIMITS.free.aiMessages;
}
