export interface ModelRef {
  id: string;
  label: string;
  provider?: string;
  contextWindow?: number;
  custom?: boolean;
  loaded?: boolean;
  variants?: { id: string; label: string }[];
}

export interface ModelCatalog {
  default: string;
  options: ModelRef[];
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  tools?: Tool[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ChatContent[];
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface ChatContent {
  type: 'text' | 'image';
  text?: string;
  image?: { data: string; mimeType: string };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface Tool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatChunk {
  type: 'delta' | 'done' | 'error';
  content?: string;
  reasoning?: string;
  toolCalls?: ToolCall[];
  usage?: { input: number; output: number; cachedInput?: number };
  error?: string;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface ChatProvider {
  readonly id: string;
  readonly displayName: string;
  readonly models: ModelRef[];
  chat(request: ChatRequest): AsyncIterable<ChatChunk>;
  validateCredentials(): Promise<ValidationResult>;
  listModels(): Promise<ModelRef[]>;
}