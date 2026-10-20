import {z} from 'zod';

const field = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,29}$/).refine(v=>!['constructor','prototype','__proto__','tool_id'].includes(v)),
  label: z.string().trim().min(1).max(60),
  type: z.enum(['text','number','date','select','checkbox']),
  required: z.boolean(),
  options: z.array(z.string().trim().min(1).max(60)).max(12),
}).strict().refine(f=>f.type!=='select'||f.options.length>0,'Select fields need options');
export const toolDefinition = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(400),
  fields: z.array(field).min(1).max(12),
}).strict().refine(t=>new Set(t.fields.map(f=>f.id)).size===t.fields.length,'Field IDs must be unique');
export type ToolDefinition = z.infer<typeof toolDefinition>;
export function parseToolRecord(definition:ToolDefinition, form:FormData) {
  return Object.fromEntries(definition.fields.map(f=>{
    const raw=form.get(f.id); const v=typeof raw==='string'?raw.trim():'';
    if(f.type==='checkbox'){if(f.required&&v!=='on')throw new Error(`${f.label} is required`);return [f.id,v==='on'];}
    if(f.required&&!v)throw new Error(`${f.label} is required`);
    if(!v)return [f.id,null];
    if(v.length>2000)throw new Error(`${f.label} is too long`);
    if(f.type==='number'){const n=Number(v);if(!Number.isFinite(n)||Math.abs(n)>1e12)throw new Error(`${f.label} must be a valid number`);return [f.id,n];}
    if(f.type==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v+'T00:00:00Z'))||!new Date(v+'T00:00:00Z').toISOString().startsWith(v)))throw new Error(`${f.label} needs a valid date`);
    if(f.type==='select'&&!f.options.includes(v))throw new Error(`Choose an option for ${f.label}`);
    return [f.id,v];
  }));
}

/** The model returns data only. No generated scripts, SQL, URLs or executable code are run. */
export async function generateTool(request:string, send:typeof fetch=fetch):Promise<ToolDefinition>{
  const key=process.env.GEMINI_API_KEY,model=process.env.GEMINI_MODEL;
  if(!key||!model||!/^[a-zA-Z0-9._-]+$/.test(model))throw new Error('AI Builder is not configured');
  const response=await send(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{
    method:'POST',signal:AbortSignal.timeout(45000),headers:{'Content-Type':'application/json','x-goog-api-key':key},
    body:JSON.stringify({systemInstruction:{parts:[{text:'Design a simple internal business form and record tracker. Return only JSON with name, description and fields. Each field has id (lowercase snake_case), label, type (text, number, date, select, checkbox), required (boolean), options (string array, empty unless select). Maximum 12 fields. Never generate executable code, integrations, automations, formulas, URLs or claims of sending messages or taking payments. If the request needs unsupported capabilities, describe only the supported tracker in description.'}]},contents:[{role:'user',parts:[{text:request}]}],generationConfig:{responseMimeType:'application/json',maxOutputTokens:3000}}),
  });
  if(!response.ok)throw new Error('AI Builder could not complete the request');
  const body=await response.text();if(body.length>100000)throw new Error('AI response is too large');
  const data=JSON.parse(body);const candidate=data.candidates?.[0];
  if(candidate?.finishReason!=='STOP')throw new Error('AI response was incomplete');
  const text=(candidate.content?.parts??[]).filter((p:{text?:string;thought?:boolean})=>typeof p.text==='string'&&!p.thought).map((p:{text:string})=>p.text).join('');
  return toolDefinition.parse(JSON.parse(text));
}
