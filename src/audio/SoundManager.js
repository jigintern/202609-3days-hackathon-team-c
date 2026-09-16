import { Howl, Howler } from 'howler';

const MUTE_STORAGE_KEY = 'sound-muted';

const SOUND_CONFIG = {
  click: { src: ['/audio/click.wav'], volume: 0.7 },
  launch: { src: ['/audio/launch.wav'], volume: 0.8, maxDurationMs: 900 },
  impact: { src: ['/audio/impact.mp3'], volume: 0.9, maxDurationMs: 700, cooldownMs: 80 },
  // 元ファイルは8秒あり、3秒手前の無音に近い区間で切って1つ目の山だけを使う
  land: { src: ['/audio/land.mp3'], volume: 0.7, maxDurationMs: 3000, cooldownMs: 150 },
  gameover: { src: ['/audio/gameover.wav'], volume: 0.85 },
};

const BGM_CONFIG = {
  game: { src: ['/audio/bgm-game.ogg'], loop: true, volume: 0.2 },
};

class SoundManager {
  constructor() {
    this.sounds = {};
    this.bgms = {};
    this._lastPlayedAt = {};
    // Howler.mute()はグローバルなスイッチなので、Howlインスタンスがまだ無い
    // このタイミングで呼んでも、以後生成される効果音・BGMすべてに効く
    this.setMuted(localStorage.getItem(MUTE_STORAGE_KEY) === 'true');
  }

  preload() {
    for (const [name, config] of Object.entries(SOUND_CONFIG)) {
      const { maxDurationMs, cooldownMs, ...howlConfig } = config;
      this.sounds[name] = {
        howl: new Howl({ ...howlConfig, preload: true }),
        maxDurationMs,
        cooldownMs,
      };
    }
    for (const [name, config] of Object.entries(BGM_CONFIG)) {
      this.bgms[name] = new Howl({ ...config, preload: true });
    }
  }

  play(name) {
    const entry = this.sounds[name];
    if (!entry) return;
    if (entry.cooldownMs) {
      const now = performance.now();
      if (now - (this._lastPlayedAt[name] ?? -Infinity) < entry.cooldownMs) return;
      this._lastPlayedAt[name] = now;
    }
    const id = entry.howl.play();
    if (entry.maxDurationMs) {
      setTimeout(() => entry.howl.stop(id), entry.maxDurationMs);
    }
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

  setMuted(muted) {
    this._muted = muted;
    Howler.mute(muted);
    localStorage.setItem(MUTE_STORAGE_KEY, String(muted));
  }

  get isMuted() {
    return this._muted;
  }
}

export const soundManager = new SoundManager();
