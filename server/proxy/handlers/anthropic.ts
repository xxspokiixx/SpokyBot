import { IncomingMessage, ServerResponse } from 'node:http';
import { providerRegistry } from '../../providers/registry.ts';
import type { ChatRequest, ChatChunk } from '../../providers/types.ts';

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContent[];
}

interface AnthropicContent {
  type: 'text' | 'image' | 'tool_use' | 'tool_result';
  text?: string;
  source?: { type: 'base64'; media_type: string; data: string };
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}

interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string | { type: 'text'; text: string }[];
  max_tokens: number;
  temperature?: number;
  stream?: boolean;
  tools?: AnthropicTool[];
  tool_choice?: { type: 'auto' } | { type: 'any' } | { type: 'tool'; name: string };
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

function toChatRequest(anthropicReq: AnthropicRequest): ChatRequest {
  return {
    model: anthropicReq.model,
    messages: anthropicReq.messages.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : m.content.map(c =>
        c.type === 'text' ? { type: 'text', text: c.text } :
        c.type === 'image' ? { type: 'image', image: { data: c.source!.data, mimeType: c.source!.media_type } } :
        { type: 'text', text: JSON.stringify(c) }
      ),
      toolCalls: Array.isArray(m.content)
        ? m.content.filter(c => c.type === 'tool_use').map(c => ({
            id: c.id!, type: 'function', function: { name: c.name!, arguments: JSON.stringify(c.input) }
          }))
        : [],
    })),
    temperature: anthropicReq.temperature,
    maxTokens: anthropicReq.max_tokens,
    stream: anthropicReq.stream,
    tools: anthropicReq.tools?.map(t => ({
      type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema }
    })),
    toolChoice: anthropicReq.tool_choice?.type === 'auto' ? 'auto' :
                anthropicReq.tool_choice?.type === 'any' ? 'auto' :
                anthropicReq.tool_choice?.type === 'tool' ? { type: 'function', function: { name: anthropicReq.tool_choice.name } } : undefined,
  };
}

async function* streamAnthropic(chunks: AsyncIterable<ChatChunk>, model: string): AsyncIterable<string> {
  const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  let outputTokens = 0;
  let blockIndex = 0;

  // message_start
  yield `event: message_start\ndata: ${JSON.stringify({
    type: 'message_start',
    message: { id: messageId, type: 'message', role: 'assistant', content: [], model, stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } }
  })}\n\n`;

  // content_block_start (text)
  yield `event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`;

  for await (const chunk of chunks) {
    if (chunk.type === 'delta' && chunk.content) {
      yield `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: chunk.content } })}\n\n`;
      outputTokens += chunk.content.length / 4; // rough estimate
    }
    if (chunk.type === 'delta' && chunk.toolCalls?.length) {
      // Tool calls would need content_block_start for each
      for (const tc of chunk.toolCalls) {
        blockIndex++;
        yield `event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: blockIndex, content_block: { type: 'tool_use', id: tc.id, name: tc.function.name, input: {} } })}\n\n`;
        yield `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: blockIndex, delta: { type: 'input_json_delta', partial_json: tc.function.arguments } })}\n\n`;
        yield `event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: blockIndex })}\n\n`;
      }
    }
    if (chunk.usage) {
      outputTokens = chunk.usage.output;
    }
    if (chunk.type === 'done' || chunk.type === 'error') break;
  }

  // content_block_stop
  yield `event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`;

  // message_delta
  yield `event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: outputTokens } })}\n\n`;

  // message_stop
  yield `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`;
}

export async function handleAnthropicMessages(
  req: IncomingMessage,
  res: ServerResponse,
  registry: typeof providerRegistry
): Promise<void> {
  let body = '';
  for await (const chunk of req) body += chunk;

  const anthropicReq = JSON.parse(body) as AnthropicRequest;
  const provider = registry.get('nvidia-nim') || registry.list()[0];

  if (!provider) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { type: 'server_error', message: 'No providers available' } }));
    return;
  }

  const chatReq = toChatRequest(anthropicReq);

  if (anthropicReq.stream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    for await (const event of streamAnthropic(provider.chat(chatReq), anthropicReq.model)) {
      res.write(event);
    }
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
      id: `msg_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      content: toolCalls.length ? toolCalls.map(tc => ({ type: 'tool_use', id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments) })) : [{ type: 'text', text: finalContent }],
      model: anthropicReq.model,
      stop_reason: toolCalls.length ? 'tool_use' : 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: finalUsage.input, output_tokens: finalUsage.output }
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  }
}
