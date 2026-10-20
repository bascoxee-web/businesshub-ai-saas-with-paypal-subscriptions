import type {ToolDefinition} from '@/lib/builder';
export function ToolFields({definition,disabled=false}:{definition:ToolDefinition;disabled?:boolean}){
 return <>{definition.fields.map(f=><div className="field" key={f.id}><label htmlFor={'tool-'+f.id}>{f.label}{f.required?' *':''}</label>{f.type==='select'?<select id={'tool-'+f.id} name={f.id} required={f.required} disabled={disabled} defaultValue=""><option value="">Choose an option</option>{f.options.map(o=><option key={o} value={o}>{o}</option>)}</select>:<input id={'tool-'+f.id} name={f.id} type={f.type} required={f.required} disabled={disabled} maxLength={f.type==='text'?2000:undefined} step={f.type==='number'?'any':undefined} style={f.type==='checkbox'?{width:'auto'}:undefined}/>}</div>)}</>;
}
