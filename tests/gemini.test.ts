import {it,expect,vi} from 'vitest';
import {geminiClient} from '../src/lib/ai/gemini';
const input={model:'test-model',system:'Use facts',tools:[{name:'list_tasks',description:'Read tasks',input_schema:{type:'object',properties:{}}}],messages:[{role:'user',content:'My tasks?'}]};
it('keeps secrets in headers and preserves signed model parts across tool rounds',async()=>{
 const parts=[{text:'private thought',thought:true,thoughtSignature:'opaque'},{functionCall:{id:'call-1',name:'list_tasks',args:{}},thoughtSignature:'signed'}];
 const send=vi.fn().mockResolvedValueOnce(Response.json({candidates:[{finishReason:'STOP',content:{parts}}]})).mockResolvedValueOnce(Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'Your tasks.'}]}}]}));
 const client=geminiClient('secret-key',send); const first=await client.messages.create(input);
 expect(first.content).toEqual([{type:'tool_use',id:'call-1',name:'list_tasks',input:{}}]);
 await client.messages.create({...input,messages:[...input.messages,{role:'assistant',content:first.content},{role:'user',content:[{type:'tool_result',tool_use_id:'call-1',content:'[]'}]}]});
 const [url,opts]=send.mock.calls[1]; expect(url).not.toContain('secret-key');expect(opts.headers['x-goog-api-key']).toBe('secret-key');
 const body=JSON.parse(opts.body);expect(body.contents[1].parts).toEqual(parts);expect(body.contents[2].parts[0].functionResponse.name).toBe('list_tasks');
});
it('fails closed on provider errors, blocked responses and truncated tool arguments',async()=>{
 for(const response of [new Response('secret upstream details',{status:429}),Response.json({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{functionCall:{name:'list_tasks'}}]}}]}),Response.json({promptFeedback:{blockReason:'SAFETY'}})]) {
  const client=geminiClient('secret-key',vi.fn().mockResolvedValue(response));
  await expect(client.messages.create(input)).rejects.toThrow();
 }
});
it('rejects model-path injection before making a request',async()=>{
 const send=vi.fn();await expect(geminiClient('key',send).messages.create({...input,model:'../../other?key=x'})).rejects.toThrow('Invalid Gemini model');expect(send).not.toHaveBeenCalled();
});
