import { useMemo, useState } from 'react';
import type { ProviderInfo } from '../services/api';
import { ModelPicker } from './ModelPicker';
import type { ModelOption } from '../utils/modelUtils';
import './model-picker.css';

interface AISettingsState {
  whiteModel: string;
  blackModel: string;
}

interface AISettingsProps {
  settings: AISettingsState;
  onSettingsChange: (settings: AISettingsState) => void;
  providers: ProviderInfo[];
  disabled?: boolean;
}

export function AISettings({ settings, onSettingsChange, providers, disabled = false }: AISettingsProps) {
  // Remember the actual names returned by search, including after swapping sides.
  const [chosenModels, setChosenModels] = useState<Record<string, ModelOption>>({});
  const provider = providers.find(item => item.id === 'openrouter');
  const models = useMemo(() => provider?.models ?? [], [provider]);
  const selectModel = (field: keyof AISettingsState, model: ModelOption) => {
    setChosenModels(current => ({ ...current, [model.id]: model }));
    onSettingsChange({ ...settings, [field]: model.id });
  };
  const sameModel = Boolean(settings.whiteModel && settings.whiteModel === settings.blackModel);

  return (
    <section className="ai-settings" aria-labelledby="ai-settings-title">
      <div className="model-settings-heading">
        <h3 id="ai-settings-title">The matchup</h3>
        <button
          type="button"
          className="model-swap"
          title="Swap White and Black models"
          aria-label="Swap White and Black models"
          disabled={disabled || !settings.whiteModel || !settings.blackModel || sameModel}
          onClick={() => onSettingsChange({ whiteModel: settings.blackModel, blackModel: settings.whiteModel })}
        >
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M3 6h14m0 0-3-3m3 3-3 3M17 14H3m0 0 3 3m-3-3 3-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Swap
        </button>
      </div>
      <div className="model-settings-pickers">
        {(['whiteModel', 'blackModel'] as const).map(field => (
          <ModelPicker
            key={field}
            side={field === 'whiteModel' ? 'White' : 'Black'}
            selectedId={settings[field]}
            selectedModel={chosenModels[settings[field]]}
            models={models}
            providerName="OpenRouter"
            disabled={disabled || !provider}
            onSelect={model => selectModel(field, model)}
          />
        ))}
      </div>
      <p className="model-settings-note">
        {sameModel ? 'Mirror match · Same model, both sides.' : 'Choose a model for each side to compare their play.'}
      </p>
    </section>
  );
}
