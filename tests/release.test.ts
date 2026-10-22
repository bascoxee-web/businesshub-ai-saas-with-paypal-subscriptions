import {it,expect} from 'vitest';
import {allowIndexing,paidPlansEnabled} from '../src/lib/release';
import {billingOffers} from '../src/lib/billing';
import {aiMessageLimit} from '../src/lib/plans';
it('keeps indexing and paid plans off unless explicitly enabled',()=>{
 for(const env of [{},{ALLOW_INDEXING:'false',PAID_PLANS_ENABLED:'false'},{ALLOW_INDEXING:'yes',PAID_PLANS_ENABLED:'1'}]){expect(allowIndexing(env)).toBe(false);expect(paidPlansEnabled(env)).toBe(false)}
 expect(allowIndexing({ALLOW_INDEXING:'true'})).toBe(true);expect(paidPlansEnabled({PAID_PLANS_ENABLED:'true'})).toBe(true);
});
it('maps new provider plan IDs to exact published USD prices, preserving old plans',()=>{
 const offers=billingOffers({PAYPAL_PLAN_PRO:'P-'+'A'.repeat(24),PAYPAL_PLAN_AGENCY:'P-'+'B'.repeat(24)});
 expect(offers.map(o=>[o.plan,o.cents,o.currency])).toEqual([['pro',3500,'USD'],['agency',7900,'USD']]);
 expect(aiMessageLimit('pro')).toBe(300);expect(aiMessageLimit('agency')).toBe(6000);expect(aiMessageLimit('starter')).toBe(300);
});
