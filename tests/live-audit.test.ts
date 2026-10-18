import {it,expect,vi} from 'vitest';
import {publicPageUrl,scrapeEvidence} from '../src/lib/seo/live';
it('rejects local addresses, IP spellings, credentials and non-web schemes',()=>{
 for(const url of ['http://127.0.0.1','http://2130706433','http://0x7f000001','http://[::1]','http://thing.local','https://user:pass@site.com','https://site.com:8443','file:///etc/passwd'])expect(()=>publicPageUrl(url)).toThrow();
 expect(publicPageUrl('https://example.com/page#here')).toBe('https://example.com/page');
});
it('requires successful HTML and labels retrieved reports without claiming rankings',async()=>{
 const send=vi.fn().mockResolvedValue(Response.json({success:true,data:{rawHtml:'<title>Example business</title><h1>Example</h1>',metadata:{statusCode:200,url:'https://example.com/'}}}));
 const report=await scrapeEvidence({name:'Example',url:'https://example.com'},'key',send);
 expect(report.source).toMatch(/Fresh Firecrawl/);expect(JSON.parse(send.mock.calls[0][1].body).skipTlsVerification).toBe(false);
 expect(JSON.parse(send.mock.calls[0][1].body).maxAge).toBe(0);
});
it('does not score block pages, failed responses, or incompatible payloads',async()=>{
 for(const data of [{success:false},{success:true,data:{rawHtml:'<html>Access denied</html>',metadata:{statusCode:403}}}])await expect(scrapeEvidence({name:'Example',url:'https://example.com'},'key',vi.fn().mockResolvedValue(Response.json(data)))).rejects.toThrow();
});
