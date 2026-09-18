// Chess sound effects utility
class ChessSounds {
  private sounds: Map<string, HTMLAudioElement> = new Map();
  private enabled: boolean = true;

  constructor() {
    this.loadSounds();
  }

  private loadSounds() {
    const soundFiles = [
      'move-self',
      'move-opponent',
      'capture',
      'move-check',
      'castle',
      'promote',
      'game-start',
      'game-end',
      'notify',
    ];

    soundFiles.forEach(name => {
      const audio = new Audio(`/sounds/${name}.mp3`);
      audio.preload = 'auto';
      this.sounds.set(name, audio);
    });
  }

  private play(name: string) {
    if (!this.enabled) return;
    
    const sound = this.sounds.get(name);
    if (sound) {
      sound.currentTime = 0;
      sound.play().catch(err => {
        console.warn(`Failed to play sound ${name}:`, err);
      });
    }
  }

  playMove() {
    this.play('move-self');
  }

  playCapture() {
    this.play('capture');
  }

  playCheck() {
    this.play('move-check');
  }

  playCastle() {
    this.play('castle');
  }

  playPromote() {
    this.play('promote');
  }

  playGameStart() {
    this.play('game-start');
  }

  playGameEnd() {
    this.play('game-end');
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  isEnabled() {
    return this.enabled;
  }
}

export const chessSounds = new ChessSounds();
