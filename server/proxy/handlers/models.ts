import { IncomingMessage, ServerResponse } from 'node:http';
import { providerRegistry } from '../../providers/registry.ts';

interface OpenAIModel {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
}

export async function handleModels(
  _req: IncomingMessage,
  res: ServerResponse,
  registry: typeof providerRegistry
): Promise<void> {
  const models = registry.getAllModels();

  const response = {
    object: 'list',
    data: models.map(m => ({
      id: m.id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: m.provider || 'nvidia-nim',
    } as OpenAIModel)),
  };

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(response));
}
