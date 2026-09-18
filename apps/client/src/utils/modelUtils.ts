import type { ProviderInfo } from '../services/api';

export interface ModelOption {
  id: string;
  name: string;
}

export function getModelName(modelId: string, providers: ProviderInfo[]): string {
  for (const provider of providers) {
    const model = provider.models.find(item => item.id === modelId);
    if (model) return model.name;
  }
  return modelId.split('/').at(-1) || 'Choose a model';
}

export function uniqueModels(models: ModelOption[]): ModelOption[] {
  const seen = new Set<string>();
  return models.filter(model => {
    if (seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
}
