export async function handleModels(_req, res, registry) {
    const models = registry.getAllModels();
    const response = {
        object: 'list',
        data: models.map(m => ({
            id: m.id,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: m.provider || 'nvidia-nim',
        })),
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
}
