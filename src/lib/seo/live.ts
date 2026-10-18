import {z} from 'zod';
import {buildEvidence} from './evidence';
export function publicPageUrl(raw:string):string {
 const url=new URL(raw); const host=url.hostname.toLowerCase().replace(/\.$/,'');
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port||!host.includes('.')||/^[\d.]+$/.test(host)||host.includes(':')||/(^|\.)(localhost|local|internal|test|invalid|example|lan|home)$/.test(host)) throw new Error('Use a public HTTP or HTTPS website without credentials or custom ports.');
 url.hash='';return url.href;
}
export const liveAuditInput=z.object({name:z.string().trim().min(1).max(120),url:z.string().trim().max(2048).transform((v,ctx)=>{try{return publicPageUrl(v)}catch{ctx.addIssue({code:'custom',message:'Enter a public website URL.'});return z.NEVER}})});
const scrapeResponse=z.object({success:z.literal(true),data:z.object({rawHtml:z.string().min(20).max(1500000),markdown:z.string().max(1500000).optional(),metadata:z.object({url:z.string().optional(),statusCode:z.number().optional(),error:z.string().optional(),title:z.string().optional(),description:z.string().optional()}).passthrough().optional()})});
export async function scrapeEvidence(input:{name:string;url:string},apiKey:string,send:typeof fetch=fetch){
 const url=publicPageUrl(input.url);
 const res=await send('https://api.firecrawl.dev/v2/scrape',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(55000),body:JSON.stringify({url,formats:['rawHtml','markdown'],onlyMainContent:false,maxAge:0,skipTlsVerification:false,timeout:45000,storeInCache:false})});
 if(!res.ok) throw new Error('The page could not be retrieved. Please retry later.');
 const reader=res.body?.getReader();if(!reader)throw new Error('Empty scraper response.');
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>4000000)throw new Error('The page is too large to audit.');chunks.push(chunk.value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const combined=new Uint8Array(size);let offset=0;for(const chunk of chunks){combined.set(chunk,offset);offset+=chunk.byteLength;}
 const raw=new TextDecoder().decode(combined);
 const parsed=scrapeResponse.safeParse(JSON.parse(raw));if(!parsed.success)throw new Error('The scraper did not return usable HTML.');
 const {data}=parsed.data;const status=data.metadata?.statusCode;
 if(data.metadata?.error || status!==undefined && (status<200 || status>=300))throw new Error('The website returned an error or blocked the audit.');
 const finalUrl=publicPageUrl(data.metadata?.url || url);
 const report=buildEvidence(data.rawHtml,data.markdown?.slice(0,12000)||'',{name:input.name,url:finalUrl},data.metadata||{});
 report.source='Fresh Firecrawl single-page retrieval; no multi-page or Google ranking check';
 return report;
}
