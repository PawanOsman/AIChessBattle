import assert from 'node:assert/strict';
import { test } from 'node:test';

test('muting stops current sounds immediately, blocks new sounds, and can be re-enabled', async t => {
  const audioInstances = [];
  class MockAudio {
    currentTime = 0;
    paused = true;
    playCount = 0;

    constructor(src) {
      this.src = src;
      audioInstances.push(this);
    }

    play() {
      this.paused = false;
      this.playCount += 1;
      return Promise.resolve();
    }

    pause() {
      this.paused = true;
    }
  }
  const originalAudio = Object.getOwnPropertyDescriptor(globalThis, 'Audio');
  Object.defineProperty(globalThis, 'Audio', { configurable: true, writable: true, value: MockAudio });
  t.after(() => {
    if (originalAudio) Object.defineProperty(globalThis, 'Audio', originalAudio);
    else delete globalThis.Audio;
  });
  const { chessSounds } = await import('../src/utils/sounds.ts');
  const start = audioInstances.find(audio => audio.src.endsWith('/game-start.mp3'));
  const move = audioInstances.find(audio => audio.src.endsWith('/move-self.mp3'));

  chessSounds.playGameStart();
  chessSounds.playMove();
  start.currentTime = 0.8;
  move.currentTime = 0.2;
  assert.equal(start.paused, false);
  assert.equal(move.paused, false);

  chessSounds.setEnabled(false);
  assert.equal(chessSounds.isEnabled(), false);
  assert.ok(audioInstances.every(audio => audio.paused && audio.currentTime === 0));
  chessSounds.playGameStart();
  chessSounds.playMove();
  assert.equal(start.playCount, 1);
  assert.equal(move.playCount, 1);

  chessSounds.setEnabled(true);
  assert.equal(chessSounds.isEnabled(), true);
  assert.ok(audioInstances.every(audio => audio.paused));
  chessSounds.playMove();
  assert.equal(move.playCount, 2);
  assert.equal(move.paused, false);
  assert.equal(start.paused, true);
});
