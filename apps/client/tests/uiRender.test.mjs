import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const noop = () => {};
const render = (Component, props) => renderToStaticMarkup(createElement(Component, props));
const textOnly = markup => markup.replace(/<[^>]*>/g, '').trim();

function button(markup, label) {
  const result = [...markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
    .find(match => textOnly(match[2]) === label);
  assert.ok(result, `Expected a ${label} button`);
  return { attributes: result[1], disabled: /\bdisabled(?:=|\s|$)/.test(result[1]) };
}

test('UI components render the setup, controls, and timing states without browser or API access', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('UI rendering must not call a live API');
  });
  const server = await createServer({
    root,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  const audioDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Audio');
  try {
    const [{ AISettings }, { GameControls }, { GameStats }] = await Promise.all([
      server.ssrLoadModule('/src/components/AISettings.tsx'),
      server.ssrLoadModule('/src/components/GameControls.tsx'),
      server.ssrLoadModule('/src/components/GameStats.tsx'),
    ]);
    const models = [
      { id: 'test/white-model', name: 'White model name' },
      { id: 'test/black-model', name: 'Black model name' },
    ];
    const providers = [{ id: 'openrouter', name: 'OpenRouter', models }];

    await t.test('model setup exposes selected names, exact IDs, and accessible side labels', () => {
      const markup = render(AISettings, {
        settings: { whiteModel: models[0].id, blackModel: models[1].id },
        providers,
        onSettingsChange: noop,
      });
      assert.match(markup, /aria-labelledby="ai-settings-title"/);
      assert.match(markup, /id="ai-settings-title"/);
      for (const [side, model] of [['white', models[0]], ['black', models[1]]]) {
        assert.ok(markup.includes(`aria-label="Choose ${side} model, ${model.name}"`));
        assert.ok(markup.includes(model.id));
      }
      assert.equal((markup.match(/aria-haspopup="listbox"/g) || []).length, 2);
      assert.equal((markup.match(/aria-expanded="false"/g) || []).length, 2);
      assert.equal(button(markup, 'Swap').disabled, false);
    });

    await t.test('same-model setup stays explicit and unavailable models retain their selected IDs', () => {
      const markup = render(AISettings, {
        settings: { whiteModel: 'unknown/my-model', blackModel: 'unknown/my-model' },
        providers,
        onSettingsChange: noop,
      });
      assert.match(markup, /Mirror match/);
      assert.equal(button(markup, 'Swap').disabled, true);
      assert.equal((markup.match(/title="unknown\/my-model"/g) || []).length, 2);
      const empty = render(AISettings, {
        settings: { whiteModel: '', blackModel: '' }, providers: [], onSettingsChange: noop,
      });
      assert.match(empty, /Choose white model, Choose a model/);
      assert.match(empty, /Choose black model, Choose a model/);
      for (const match of empty.matchAll(/<button\b([^>]*)>/g)) assert.match(match[1], /disabled/);
    });

    const controlProps = {
      onNewGame: noop, onFlip: noop, onPauseResume: noop, onStep: noop, onRematch: noop,
      onExport: noop, onExportStats: noop, onSoundChange: noop, onDelayChange: noop,
      isPaused: true, isThinking: false, gameOver: false, hasMoves: true, hasStats: true,
      soundEnabled: false, moveDelayMs: 1500,
    };
    await t.test('paused, playing, thinking, and completed games expose the correct controls', () => {
      const paused = render(GameControls, controlProps);
      assert.equal(button(paused, 'Resume').disabled, false);
      assert.equal(button(paused, 'One move').disabled, false);
      assert.equal(button(paused, 'PGN').disabled, false);
      assert.equal(button(paused, 'Stats').disabled, false);
      assert.match(paused, /aria-label="Enable sounds" aria-pressed="false"/);
      assert.match(paused, /<label for="move-delay">Between moves<\/label>/);
      assert.match(paused, /<option value="1500" selected="">1\.5 seconds<\/option>/);

      const playing = render(GameControls, { ...controlProps, isPaused: false });
      assert.equal(button(playing, 'Pause').disabled, false);
      assert.equal(button(playing, 'One move').disabled, true);
      const thinking = render(GameControls, { ...controlProps, isThinking: true });
      assert.equal(button(thinking, 'One move').disabled, true);
      const over = render(GameControls, { ...controlProps, gameOver: true });
      assert.equal(button(over, 'Resume').disabled, true);
      assert.equal(button(over, 'One move').disabled, true);
      assert.equal(button(over, 'Rematch').disabled, false);
      const empty = render(GameControls, { ...controlProps, hasMoves: false, hasStats: false });
      assert.equal(button(empty, 'PGN').disabled, true);
      assert.equal(button(empty, 'Stats').disabled, true);
      const failedOpening = render(GameControls, { ...controlProps, hasMoves: false, hasStats: true });
      assert.equal(button(failedOpening, 'Stats').disabled, false);
    });

    await t.test('statistics show each model and distinguish move averages from all request time', () => {
      const markup = render(GameStats, {
        whiteModel: models[0].id, blackModel: models[1].id, activeRequest: null,
        moveRecords: [
          { ply: 1, color: 'w', model: models[0].id, san: 'e4', uci: 'e2e4', fenBefore: '', fenAfter: '', durationMs: 1000 },
          { ply: 2, color: 'b', model: models[1].id, san: 'e5', uci: 'e7e5', fenBefore: '', fenAfter: '', durationMs: 2000 },
          { ply: 3, color: 'w', model: models[0].id, san: 'Nf3', uci: 'g1f3', fenBefore: '', fenAfter: '', durationMs: 3000 },
        ],
        requestRecords: [
          { color: 'w', model: models[0].id, status: 'completed', durationMs: 1000 },
          { color: 'b', model: models[1].id, status: 'completed', durationMs: 2000 },
          { color: 'w', model: models[0].id, status: 'failed', durationMs: 500 },
          { color: 'w', model: models[0].id, status: 'completed', durationMs: 3000 },
          { color: 'b', model: models[1].id, status: 'cancelled', durationMs: 250 },
        ],
      });
      assert.match(markup, /3 plies/);
      assert.match(markup, /title="test\/white-model"/);
      assert.match(markup, /title="test\/black-model"/);
      assert.match(markup, /Request time: White 4\.5 s, Black 2\.3 s/);
      assert.equal((markup.match(/<dt>Average \/ move<\/dt><dd>2\.0 s<\/dd>/g) || []).length, 2);
      assert.match(markup, /Failed requests<\/th><td>1<\/td><td>0<\/td>/);
      assert.match(markup, /Cancelled requests<\/th><td>0<\/td><td>1<\/td>/);
      assert.match(markup, /Pauses and move delay are excluded/);
    });

    await t.test('empty statistics display zero totals and no invented move durations', () => {
      const markup = render(GameStats, {
        whiteModel: '', blackModel: '', activeRequest: null, moveRecords: [], requestRecords: [],
      });
      assert.match(markup, /0 plies/);
      assert.match(markup, /Request time: White 0 ms, Black 0 ms/);
      assert.equal((markup.match(/No model selected/g) || []).length, 2);
      assert.equal((markup.match(/<dt>Average \/ move<\/dt><dd>—<\/dd>/g) || []).length, 2);
      assert.doesNotMatch(markup, /NaN|Infinity/);
    });

    await t.test('the complete app renders its initial setup and both players', async () => {
      Object.defineProperty(globalThis, 'Audio', {
        configurable: true,
        value: class AudioStub { play() { return Promise.resolve(); } },
      });
      const { default: App } = await server.ssrLoadModule('/src/App.tsx');
      const markup = render(App, {});
      assert.match(markup, /Set up a match/);
      assert.match(markup, /aria-label="Chess board"/);
      assert.match(markup, /aria-label="Match setup"/);
      assert.match(markup, /Loading available models/);
      assert.equal(button(markup, 'Start match').disabled, true);
      assert.equal((markup.match(/Choose a model/g) || []).length, 2);
      assert.equal(fetch.mock.callCount(), 0);
    });
  } finally {
    if (audioDescriptor) Object.defineProperty(globalThis, 'Audio', audioDescriptor);
    else delete globalThis.Audio;
    await server.close();
  }
});
