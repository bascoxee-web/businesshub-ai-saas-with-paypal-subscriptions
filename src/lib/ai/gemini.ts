import type { LlmClient, LlmResponse } from './run';

type Part = { text?: string; thought?: boolean; functionCall?: { id?: string; name: string; args?: unknown }; [key: string]: unknown };
type Message = { role: string; content: string | Array<Record<string, unknown>> };
/** Request-scoped adapter. Original model parts retain thought signatures during tool rounds. */
export function geminiClient(apiKey: string, send: typeof fetch = fetch): LlmClient {
  const originals = new WeakMap<object, Part[]>();
  const signal = AbortSignal.timeout(45000);
  return { messages: { async create(params): Promise<LlmResponse> {
    const model = String(params.model);
    if (!/^[a-zA-Z0-9._-]+$/.test(model)) throw new Error('Invalid Gemini model');
    const names = new Map<string, string>();
    const contents = (params.messages as Message[]).map(message => {
      if (typeof message.content === 'string') return { role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] };
      for (const block of message.content) if (block.type === 'tool_use') names.set(String(block.id), String(block.name));
      const original = originals.get(message.content);
      const parts = original ?? message.content.map(block => {
        if (block.type === 'text') return { text: String(block.text) };
        if (block.type === 'tool_use') return { functionCall: { name: String(block.name), args: block.input, id: String(block.id) } };
        if (block.type === 'tool_result') {
          const name = names.get(String(block.tool_use_id));
          if (!name) throw new Error('Unmatched tool result');
          return { functionResponse: { name, id: String(block.tool_use_id), response: { result: String(block.content), error: block.is_error === true } } };
        }
        throw new Error('Unsupported conversation block');
      });
      return { role: message.role === 'assistant' ? 'model' : 'user', parts };
    });
    const tools = (params.tools as Array<{name:string;description:string;input_schema:Record<string,unknown>}>).map(t => {
      const { $schema: _, ...schema } = t.input_schema;
      return { name: t.name, description: t.description, parametersJsonSchema: schema };
    });
    const response = await send(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, signal,
      body: JSON.stringify({ contents, systemInstruction: { parts: [{ text: String(params.system) }] }, tools: [{ functionDeclarations: tools }], generationConfig: { maxOutputTokens: 4096 } }),
    });
    if (!response.ok) throw new Error(`Gemini request failed (${response.status})`);
    const data = await response.json() as { candidates?: Array<{ finishReason?: string; content?: {parts?:Part[]} }> };
    const candidate = data.candidates?.[0];
    if (!candidate || candidate.finishReason !== 'STOP') throw new Error('Gemini did not complete the response');
    const parts = candidate.content?.parts;
    if (!parts?.length) throw new Error('Gemini returned no content');
    const content: LlmResponse['content'] = [];
    for (const p of parts) {
      if (p.functionCall) content.push({type:'tool_use',id:p.functionCall.id || crypto.randomUUID(),name:p.functionCall.name,input:p.functionCall.args ?? {}});
      else if (typeof p.text === 'string' && !p.thought) content.push({type:'text',text:p.text});
    }
    if (!content.length) throw new Error('Gemini returned no usable content');
    originals.set(content, parts);
    return {content};
  } } };
}
