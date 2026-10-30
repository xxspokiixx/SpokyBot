import { createServer } from 'node:http';
import '../providers/nvidia-nim.ts';
import { providerRegistry } from '../providers/registry.ts';
import { handleAnthropicMessages } from './handlers/anthropic.ts';
import { handleOpenAIChat } from './handlers/openai.ts';
import { handleModels } from './handlers/models.ts';

let cachedPort: number | null = null;
let serverRef: ReturnType<typeof createServer> | null = null;

export async function startProxyServer(): Promise<number> {
  if (cachedPort !== null && serverRef) {
    return cachedPort;
  }

  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      // CORS for local CLI tools
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Anthropic-Version, X-Request-ID');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url!, `http://localhost`);

      try {
        // Anthropic Messages API (for `claude` CLI)
        if (url.pathname === '/v1/messages' && req.method === 'POST') {
          await handleAnthropicMessages(req, res, providerRegistry);
          return;
        }

        // OpenAI Chat Completions (for `opencode`, `codex` CLI)
        if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
          await handleOpenAIChat(req, res, providerRegistry);
          return;
        }

        // Model listing (both CLIs call this)
        if (url.pathname === '/v1/models' && req.method === 'GET') {
          await handleModels(req, res, providerRegistry);
          return;
        }

        // Health check
        if (url.pathname === '/health' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', providers: providerRegistry.list().map(p => p.id) }));
          return;
        }

        res.writeHead(404);
        res.end('Not found');
      } catch (error) {
        console.error('[Proxy] Error:', error);
        res.writeHead(500);
        res.end('Internal server error');
      }
    });

    server.on('error', (err) => reject(err));

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        cachedPort = address.port;
        serverRef = server;
        console.log(`[Proxy] Started on http://127.0.0.1:${cachedPort}`);
        resolve(cachedPort);
      } else {
        reject(new Error('Failed to get server address'));
      }
    });
  });
}

export function getProxyPort(): number | null {
  return cachedPort;
}

export async function stopProxyServer(): Promise<void> {
  if (serverRef) {
    await new Promise<void>((resolve) => serverRef!.close(() => resolve()));
    serverRef = null;
    cachedPort = null;
  }
}
