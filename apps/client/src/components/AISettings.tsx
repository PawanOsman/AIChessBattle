import React, { useState, useEffect, useCallback } from 'react';
import type { ProviderInfo } from '../services/api';
import { apiService } from '../services/api';

interface AISettingsState {
  whiteModel: string;
  blackModel: string;
}

interface AISettingsProps {
  settings: AISettingsState;
  onSettingsChange: (settings: AISettingsState) => void;
  providers: ProviderInfo[];
}

export const AISettings: React.FC<AISettingsProps> = ({
  settings,
  onSettingsChange,
  providers,
}) => {
  const [local, setLocal] = useState(settings);
  const [whiteSearchQuery, setWhiteSearchQuery] = useState('');
  const [blackSearchQuery, setBlackSearchQuery] = useState('');
  const [whiteSearchResults, setWhiteSearchResults] = useState<{ id: string; name: string }[]>([]);
  const [blackSearchResults, setBlackSearchResults] = useState<{ id: string; name: string }[]>([]);
  const [whiteSearching, setWhiteSearching] = useState(false);
  const [blackSearching, setBlackSearching] = useState(false);

  useEffect(() => {
    setLocal(settings);
  }, [settings]);

  const handleChange = (field: keyof AISettingsState, value: string) => {
    const updated = { ...local, [field]: value };
    setLocal(updated);
    onSettingsChange(updated);
  };

  const getModels = (searchResults?: { id: string; name: string }[], selectedModelId?: string) => {
    let models: { id: string; name: string }[] = [];
    
    if (searchResults && searchResults.length > 0) {
      models = searchResults;
    } else {
      const openrouter = providers.find(p => p.id === 'openrouter');
      models = openrouter?.models || [];
    }
    
    // If a model is selected but not in the current list, add it
    if (selectedModelId && !models.some(m => m.id === selectedModelId)) {
      // Try to find it in all models (search with empty query to get all)
      models = [{ id: selectedModelId, name: selectedModelId }, ...models];
    }
    
    return models;
  };

  const searchModels = useCallback(async (query: string, isWhite: boolean) => {
    
    if (isWhite) {
      setWhiteSearching(true);
    } else {
      setBlackSearching(true);
    }

    try {
      const results = await apiService.searchModels(query);
      if (isWhite) {
        setWhiteSearchResults(results);
      } else {
        setBlackSearchResults(results);
      }
    } catch (error) {
      console.error('Failed to search models:', error);
    } finally {
      if (isWhite) {
        setWhiteSearching(false);
      } else {
        setBlackSearching(false);
      }
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (whiteSearchQuery) {
        searchModels(whiteSearchQuery, true);
      } else {
        setWhiteSearchResults([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [whiteSearchQuery, searchModels]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (blackSearchQuery) {
        searchModels(blackSearchQuery, false);
      } else {
        setBlackSearchResults([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [blackSearchQuery, searchModels]);


  return (
    <div className="ai-settings">
      <h3>AI Configuration</h3>
      
      <div className="settings-columns">
        <div className="ai-column">
          <h4>White</h4>
          
          <div className="setting-row">
            <label>Search Models</label>
            <input
              type="text"
              placeholder="Search 400+ models..."
              value={whiteSearchQuery}
              onChange={(e) => setWhiteSearchQuery(e.target.value)}
              className="search-input"
            />
            {whiteSearching && <span className="searching">Searching...</span>}
          </div>

          <div className="setting-row">
            <label>Model</label>
            <select
              value={local.whiteModel}
              onChange={(e) => handleChange('whiteModel', e.target.value)}
            >
              {getModels(whiteSearchResults, local.whiteModel).map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="ai-column">
          <h4>Black</h4>
          
          <div className="setting-row">
            <label>Search Models</label>
            <input
              type="text"
              placeholder="Search 400+ models..."
              value={blackSearchQuery}
              onChange={(e) => setBlackSearchQuery(e.target.value)}
              className="search-input"
            />
            {blackSearching && <span className="searching">Searching...</span>}
          </div>

          <div className="setting-row">
            <label>Model</label>
            <select
              value={local.blackModel}
              onChange={(e) => handleChange('blackModel', e.target.value)}
            >
              {getModels(blackSearchResults, local.blackModel).map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {providers.length === 0 && (
        <div className="warning">
          <p>No AI providers available. Configure API keys in .env</p>
        </div>
      )}
    </div>
  );
};
