import { Howl } from 'howler';

const SOUND_CONFIG = {
  click: { src: ['/audio/click.wav'], volume: 0.7 },
  launch: { src: ['/audio/launch.wav'], volume: 0.8, maxDurationMs: 900 },
  impact: { src: ['/audio/impact.mp3'], volume: 0.9, maxDurationMs: 700 },
  gameover: { src: ['/audio/gameover.wav'], volume: 0.85 },
};

const BGM_CONFIG = {
  game: { src: ['/audio/bgm-game.ogg'], loop: true, volume: 0.35 },
};

const IMPACT_COOLDOWN_MS = 80;

class SoundManager {
  constructor() {
    this.sounds = {};
    this.bgms = {};
    this._lastImpactAt = 0;
  }

  preload() {
    for (const [name, config] of Object.entries(SOUND_CONFIG)) {
      const { maxDurationMs, ...howlConfig } = config;
      this.sounds[name] = { howl: new Howl({ ...howlConfig, preload: true }), maxDurationMs };
    }
    for (const [name, config] of Object.entries(BGM_CONFIG)) {
      this.bgms[name] = new Howl({ ...config, preload: true });
    }
  }

  play(name) {
    const entry = this.sounds[name];
    if (!entry) return;
    const id = entry.howl.play();
    if (entry.maxDurationMs) {
      setTimeout(() => entry.howl.stop(id), entry.maxDurationMs);
    }
  }

  playImpact() {
    const now = performance.now();
    if (now - this._lastImpactAt < IMPACT_COOLDOWN_MS) return;
    this._lastImpactAt = now;
    this.play('impact');
  }

  playBgm(name) {
    const bgm = this.bgms[name];
    if (!bgm || bgm.playing()) return;
    bgm.play();
  }

  stopBgm(name) {
    const bgm = this.bgms[name];
    if (!bgm) return;
    bgm.stop();
  }
}

export const soundManager = new SoundManager();
