import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { apiService } from '../services/api';
import { uniqueModels } from '../utils/modelUtils';
import type { ModelOption } from '../utils/modelUtils';

interface ModelPickerProps {
  side: 'White' | 'Black';
  selectedId: string;
  selectedModel?: ModelOption;
  models: ModelOption[];
  providerName: string;
  disabled?: boolean;
  onSelect: (model: ModelOption) => void;
}

interface SearchResult {
  query: string;
  models: ModelOption[];
  error?: string;
}

export function ModelPicker({ side, selectedId, selectedModel, models, providerName, disabled = false, onSelect }: ModelPickerProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [retry, setRetry] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const normalizedQuery = query.trim();
  const expanded = open && !disabled;
  const searching = Boolean(normalizedQuery && result?.query !== normalizedQuery);
  const searchError = normalizedQuery && result?.query === normalizedQuery ? result.error : undefined;
  const options = useMemo(() => uniqueModels(normalizedQuery
    ? result?.query === normalizedQuery ? result.models : []
    : models), [models, normalizedQuery, result]);
  const currentModel = selectedModel?.id === selectedId ? selectedModel : models.find(model => model.id === selectedId);
  const selectedName = currentModel?.name || selectedId.split('/').at(-1) || 'Choose a model';
  const boundedIndex = options.length ? Math.min(activeIndex, options.length - 1) : -1;

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  useEffect(() => {
    if (!expanded || !normalizedQuery) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const found = await apiService.searchModels(normalizedQuery, controller.signal);
        // Abort-aware fetch plus this check also covers a late parsing response.
        if (!controller.signal.aborted) setResult({ query: normalizedQuery, models: found });
      } catch {
        if (!controller.signal.aborted) {
          setResult({ query: normalizedQuery, models: [], error: 'Could not search models. Try again.' });
        }
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [expanded, normalizedQuery, retry]);

  useEffect(() => {
    if (expanded && boundedIndex >= 0) {
      const option = listRef.current?.children.item(boundedIndex);
      option?.scrollIntoView({ block: 'nearest' });
    }
  }, [expanded, boundedIndex, options]);

  const close = (restoreFocus = false) => {
    setOpen(false);
    setQuery('');
    setActiveIndex(0);
    if (restoreFocus) triggerRef.current?.focus();
  };
  const select = (model: ModelOption) => {
    onSelect(model);
    close(true);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (options.length) setActiveIndex((boundedIndex + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
    } else if (event.key === 'Enter' && boundedIndex >= 0) {
      event.preventDefault();
      select(options[boundedIndex]);
    }
  };

  return (
    <div
      className={`model-picker${expanded ? ' is-open' : ''}`}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
    >
      <div className="model-picker-label" id={`${id}-label`}>
        <span className={`model-side-dot model-side-${side.toLowerCase()}`} aria-hidden="true" />
        <span>{side}</span>
        <span className="model-provider">{providerName}</span>
      </div>
      <button
        type="button"
        ref={triggerRef}
        className="model-picker-trigger"
        aria-label={`Choose ${side.toLowerCase()} model, ${selectedName}`}
        aria-haspopup="listbox"
        aria-expanded={expanded}
        aria-controls={expanded ? `${id}-list` : undefined}
        disabled={disabled}
        onClick={() => {
          if (expanded) close();
          else {
            setOpen(true);
            setActiveIndex(Math.max(0, options.findIndex(model => model.id === selectedId)));
          }
        }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
            setActiveIndex(Math.max(0, options.findIndex(model => model.id === selectedId)));
          }
        }}
      >
        <span className="model-picker-current">
          <strong>{selectedName}</strong>
          {selectedId && <span title={selectedId}>{selectedId}</span>}
        </span>
        <svg className="model-picker-chevron" width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="m5 8 5 5 5-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {expanded && (
        <div className="model-picker-menu">
          <div className="model-picker-search-row">
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.6" />
              <path d="m13 13 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <input
              ref={inputRef}
              role="combobox"
              aria-label={`Search ${side.toLowerCase()} models`}
              aria-expanded="true"
              aria-autocomplete="list"
              aria-controls={`${id}-list`}
              aria-activedescendant={boundedIndex >= 0 ? `${id}-option-${boundedIndex}` : undefined}
              autoComplete="off"
              spellCheck={false}
              maxLength={256}
              value={query}
              placeholder="Search by name or model ID"
              onChange={event => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={handleKeyDown}
            />
            {query && (
              <button type="button" className="model-search-clear" aria-label="Clear model search" onClick={() => {
                setQuery('');
                setActiveIndex(0);
                inputRef.current?.focus();
              }}>×</button>
            )}
          </div>
          <div className="model-picker-status" role="status" aria-live="polite">
            {searching ? 'Searching models…' : searchError ? searchError : normalizedQuery
              ? `${options.length} ${options.length === 1 ? 'model' : 'models'} found`
              : `${options.length} available · Search the full catalog`}
          </div>
          {searchError && (
            <button type="button" className="model-search-retry" onClick={() => {
              setResult(null);
              setRetry(value => value + 1);
              inputRef.current?.focus();
            }}>Retry search</button>
          )}
          <ul ref={listRef} id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`} aria-busy={searching} className="model-picker-options">
            {options.map((model, index) => (
              <li
                key={model.id}
                id={`${id}-option-${index}`}
                role="option"
                aria-selected={model.id === selectedId}
                className={`model-picker-option${index === boundedIndex ? ' is-active' : ''}${model.id === selectedId ? ' is-selected' : ''}`}
                onMouseDown={event => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => select(model)}
              >
                <span><strong>{model.name}</strong><small>{model.id}</small></span>
                {model.id === selectedId && <span className="model-option-check" aria-label="Selected">✓</span>}
              </li>
            ))}
          </ul>
          {!searching && !searchError && options.length === 0 && (
            <p className="model-picker-empty">{normalizedQuery ? 'No matching models. Try a different name or provider.' : 'Search to find a model in the full catalog.'}</p>
          )}
          <p className="model-picker-keyhint">↑↓ navigate · Enter select · Esc close</p>
        </div>
      )}
    </div>
  );
}
