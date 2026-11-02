import { IncomingMessage, ServerResponse } from 'node:http';
import { providerRegistry } from '../../providers/registry.ts';
import type { ChatRequest, ChatChunk } from '../../providers/types.ts';

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | OpenAIContent[];
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIContent {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string; detail?: 'auto' | 'low' | 'high' };
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  stream?: boolean;
  tools?: OpenAITool[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
}

function toChatRequest(openaiReq: OpenAIRequest): ChatRequest {
  return {
    model: openaiReq.model,
    messages: openaiReq.messages.map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : m.content.map(c =>
        c.type === 'text' ? { type: 'text', text: c.text } :
        c.type === 'image_url' ? { type: 'image', image: { data: c.image_url!.url.split(',')[1] || '', mimeType: 'image/jpeg' } } :
        { type: 'text', text: JSON.stringify(c) }
      ),
      toolCalls: m.tool_calls?.map(tc => ({
        id: tc.id, type: 'function', function: { name: tc.function.name, arguments: tc.function.arguments }
      })),
      toolCallId: m.tool_call_id,
    })),
    temperature: openaiReq.temperature,
    maxTokens: openaiReq.max_completion_tokens ?? openaiReq.max_tokens,
    stream: openaiReq.stream,
    tools: openaiReq.tools?.map(t => ({
      type: 'function', function: { name: t.function.name, description: t.function.description, parameters: t.function.parameters }
    })),
    toolChoice: openaiReq.tool_choice === 'auto' ? 'auto' :
                openaiReq.tool_choice === 'none' ? 'none' :
                openaiReq.tool_choice?.type === 'function' ? { type: 'function', function: { name: openaiReq.tool_choice.function.name } } : 'auto',
  };
}

function toOpenAIChunk(chunk: ChatChunk, model: string, requestId: string): string {
  const base = { id: requestId, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model };

  if (chunk.type === 'delta') {
    const delta: Record<string, unknown> = { role: 'assistant' };
    if (chunk.content) delta.content = chunk.content;
    if (chunk.reasoning) delta.reasoning = chunk.reasoning;
    if (chunk.toolCalls) {
      delta.tool_calls = chunk.toolCalls.map((tc, idx) => ({
        index: idx, id: tc.id, type: 'function', function: { name: tc.function.name, arguments: tc.function.arguments }
      }));
    }
    return `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`;
  }

  if (chunk.type === 'done' || chunk.type === 'error') {
    return `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: chunk.type === 'error' ? 'error' : 'stop' }] })}\n\n`;
  }

  return '';
}

export async function handleOpenAIChat(
  req: IncomingMessage,
  res: ServerResponse,
  registry: typeof providerRegistry
): Promise<void> {
  let body = '';
  for await (const chunk of req) body += chunk;

  const openaiReq = JSON.parse(body) as OpenAIRequest;
  const provider = registry.get('nvidia-nim') || registry.list()[0];

  if (!provider) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'No providers available', type: 'server_error' } }));
    return;
  }

  const chatReq = toChatRequest(openaiReq);
  const requestId = `chatcmpl-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  if (openaiReq.stream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    for await (const chunk of provider.chat(chatReq)) {
      const event = toOpenAIChunk(chunk, openaiReq.model, requestId);
      if (event) res.write(event);
      if (chunk.type === 'done' || chunk.type === 'error') break;
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } else {
    let finalContent = '';
    let finalUsage = { input: 0, output: 0 };
    let toolCalls: ChatChunk['toolCalls'] = [];

    for await (const chunk of provider.chat(chatReq)) {
      if (chunk.content) finalContent += chunk.content;
      if (chunk.toolCalls) toolCalls = chunk.toolCalls;
      if (chunk.usage) finalUsage = chunk.usage;
      if (chunk.type === 'done' || chunk.type === 'error') break;
    }

    const response = {
      id: requestId,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: openaiReq.model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: toolCalls.length ? null : finalContent,
          tool_calls: toolCalls?.map(tc => ({
            id: tc.id, type: 'function', function: { name: tc.function.name, arguments: tc.function.arguments }
          })),
        },
        finish_reason: toolCalls.length ? 'tool_calls' : 'stop',
      }],
      usage: { prompt_tokens: finalUsage.input, completion_tokens: finalUsage.output, total_tokens: finalUsage.input + finalUsage.output },
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  }
}
