import {it,expect} from 'vitest';
import {subscriptionPlans,subscriptionsEnabled,approvalUrl,subscriptionPreview} from '../src/lib/subscriptions';
it('only enables sandbox with explicit credentials and a service key',()=>{
 const env={SUBSCRIPTIONS_ENABLED:'sandbox',PAYPAL_ENV:'sandbox',PAYPAL_CLIENT_ID:'id',PAYPAL_CLIENT_SECRET:'secret',SUPABASE_SERVICE_ROLE_KEY:'server-only'};
 expect(subscriptionsEnabled(env)).toBe(true);expect(subscriptionsEnabled({...env,PAYPAL_ENV:'live'})).toBe(false);expect(subscriptionsEnabled({})).toBe(false);
});
it('uses only configured plan IDs and genuine sandbox approval links',()=>{
 expect(subscriptionPlans({PAYPAL_PLAN_STARTER:'P-'+'A'.repeat(24),PAYPAL_PLAN_BUSINESS:'https://evil.com'})).toEqual({starter:'P-'+'A'.repeat(24)});
 expect(approvalUrl({links:[{rel:'approve',href:'https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=x'}]})).toContain('sandbox.paypal.com');
 for(const href of ['https://evil.com/','https://www.paypal.com/','javascript:alert(1)'])expect(()=>approvalUrl({links:[{rel:'approve',href}]})).toThrow();
});
it('verifies the provider subscription, checkout and trusted plan all match',()=>{
 const remote={id:'I-TEST',custom_id:'checkout',plan_id:'P-TEST',status:'ACTIVE'};
 expect(subscriptionPreview(remote,{id:'I-TEST',checkout:'checkout',planId:'P-TEST'}).status).toBe('ACTIVE');
 for(const patch of [{id:'another'},{checkout:'another'},{planId:'cheap-plan'}])expect(()=>subscriptionPreview(remote,{id:'I-TEST',checkout:'checkout',planId:'P-TEST',...patch})).toThrow();
});
it('fetches full subscription identity when PayPal creates with a minimal response',async()=>{
 const {PayPalClient}=await import('../src/lib/paypal');
 const {vi}=await import('vitest');
 const send=vi.fn().mockResolvedValueOnce(Response.json({access_token:'token',expires_in:3600})).mockResolvedValueOnce(Response.json({id:'I-NEW',status:'APPROVAL_PENDING',links:[{rel:'approve',href:'https://www.sandbox.paypal.com/approve'}]})).mockResolvedValueOnce(Response.json({id:'I-NEW',status:'APPROVAL_PENDING',custom_id:'checkout',plan_id:'P-PLAN'}));
 const paypal=new PayPalClient({clientId:'id',clientSecret:'secret',base:'https://api-m.sandbox.paypal.com'},send);
 const remote=await paypal.createSubscription('P-PLAN','checkout','https://app.example.com');
 expect(subscriptionPreview(remote,{id:'I-NEW',checkout:'checkout',planId:'P-PLAN'}).status).toBe('APPROVAL_PENDING');
 expect(approvalUrl(remote)).toBe('https://www.sandbox.paypal.com/approve');
 expect(send.mock.calls[1][1].headers['PayPal-Request-Id']).toBe('checkout');
});
