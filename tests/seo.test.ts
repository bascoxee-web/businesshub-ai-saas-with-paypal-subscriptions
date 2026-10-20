import { describe, expect, it } from 'vitest';
import { buildEvidence } from '../src/lib/seo/evidence';
import { snapshotSchema, snapshotText } from '../src/lib/seo/input';
describe('Grader snapshot integration', () => {
 it('labels snapshot provenance and does not claim live URL verification', () => {
  const r = buildEvidence('<title>Example business</title><h1>Example</h1>', '', {name:'Example',url:'https://example.com'});
  expect(r.source).toMatch(/snapshot/); expect(r.facts.find(f=>f.field==='website')?.status).toBe('NEEDS CONFIRMATION');
  expect(r.disclaimer).toMatch(/does not measure Google rankings/);
  expect(r.findings.find(f=>f.id==='description')).toBeDefined(); expect(r.score).toBeGreaterThanOrEqual(0); expect(r.score).toBeLessThanOrEqual(100);
 });
 it('preserves JSON-LD detection and distinguishes invalid JSON', () => {
  const html = '<script type="application/ld+json">{"@type":"LocalBusiness","name":"Example"}</script>';
  expect(buildEvidence(html,'',{name:'Example',url:'https://example.com'}).schemaStatus).toBe('valid-json');
  expect(buildEvidence(html.replace('{"@type"','{bad"@type"'),'',{name:'Example',url:'https://example.com'}).schemaStatus).toBe('invalid');
 });
 it('rejects executable URLs, credentials and oversized HTML', () => {
  const input={name:'Example',url:'https://example.com',html:'<title>Example business</title>'};
  for(const url of ['javascript:alert(1)','file:///etc/passwd','https://user:password@example.com']) expect(snapshotSchema.safeParse({...input,url}).success).toBe(false);
  expect(snapshotSchema.safeParse({...input,html:'x'.repeat(250001)}).success).toBe(false);
 });
 it('removes executable content from sampled text', () => {
  expect(snapshotText('<script>alert("secret")</script><style>hidden</style><h1>Example</h1>')).toBe('Example');
 });
});
