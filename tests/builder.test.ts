import {it,expect,afterEach,vi} from 'vitest';
import {toolDefinition,parseToolRecord,generateTool} from '../src/lib/builder';
const definition={name:'Inventory',description:'Track stock',fields:[{id:'quantity',label:'Quantity',type:'number' as const,required:true,options:[]},{id:'status',label:'Status',type:'select' as const,required:true,options:['Available','Ordered']}]};
afterEach(()=>vi.unstubAllEnvs());
it('rejects scripts, unknown fields, duplicate IDs and unsafe property names',()=>{
 expect(toolDefinition.safeParse({...definition,script:'alert(1)'}).success).toBe(false);
 expect(toolDefinition.safeParse({...definition,fields:[definition.fields[0],definition.fields[0]]}).success).toBe(false);
 expect(toolDefinition.safeParse({...definition,fields:[{...definition.fields[0],id:'constructor'}]}).success).toBe(false);
});
it('validates fields and ignores submitted unknown properties',()=>{
 const form=new FormData();form.set('quantity','3');form.set('status','Ordered');form.set('workspace_id','other');
 expect(parseToolRecord(definition,form)).toEqual({quantity:3,status:'Ordered'});
 for(const bad of ['Infinity','NaN','1e99']){form.set('quantity',bad);expect(()=>parseToolRecord(definition,form)).toThrow();}
 form.set('quantity','3');form.set('status','fake');expect(()=>parseToolRecord(definition,form)).toThrow();
});
it('rejects blocked or incomplete model output and validates finished JSON',async()=>{
 vi.stubEnv('GEMINI_API_KEY','test-key');vi.stubEnv('GEMINI_MODEL','test-model');
 const send=(reason:string,data:unknown)=>vi.fn(async()=>Response.json({candidates:[{finishReason:reason,content:{parts:[{text:JSON.stringify(data)}]}}]}));
 await expect(generateTool('Build inventory',send('MAX_TOKENS',definition))).rejects.toThrow();
 await expect(generateTool('Build inventory',send('STOP',{...definition,script:'bad'}))).rejects.toThrow();
 await expect(generateTool('Build inventory',send('STOP',definition))).resolves.toEqual(definition);
});
