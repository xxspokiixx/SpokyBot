class ProviderRegistry {
    providers = new Map();
    register(provider) {
        this.providers.set(provider.id, provider);
    }
    get(id) {
        return this.providers.get(id);
    }
    list() {
        return Array.from(this.providers.values());
    }
    getAllModels() {
        return this.list().flatMap((p) => p.models);
    }
}
export const providerRegistry = new ProviderRegistry();
