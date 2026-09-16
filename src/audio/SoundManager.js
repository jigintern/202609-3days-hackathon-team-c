import { Howl, Howler } from 'howler';

const MUTE_STORAGE_KEY = 'sound-muted';
// 保存キーに世代(-v2)を付けている。以前は起動時の既定値もそのまま保存していたため、
// キーを据え置くと「一度でも開いたことのあるブラウザだけ以前の既定値(最大音量)のまま」
// になってしまう。既定値を変えたこの回で世代を上げ、全員が新しい既定値から始まるようにする
const VOLUME_STORAGE_KEY = 'sound-volume-v2';
const LEGACY_VOLUME_STORAGE_KEY = 'sound-volume';

// 初期音量。いきなり最大で鳴ると驚くので半分から始める。
// 設定メニューでユーザーが動かした値は保存され、次回以降そちらが優先される
const DEFAULT_VOLUME = 0.5;

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
    // Howler.mute()/volume()はグローバルなスイッチなので、Howlインスタンスがまだ無い
    // このタイミングで呼んでも、以後生成される効果音・BGMすべてに効く。
    // ここでは保存はしない（set系と違って、ユーザーが選んだ値ではないため）。
    // 既定値をそのまま保存してしまうと、次に既定値を変えたときに
    // 「前に開いたことのある人にだけ効かない」変更になってしまう
    this._applyMuted(localStorage.getItem(MUTE_STORAGE_KEY) === 'true');
    const savedVolume = Number.parseFloat(localStorage.getItem(VOLUME_STORAGE_KEY));
    this._applyVolume(Number.isFinite(savedVolume) ? savedVolume : DEFAULT_VOLUME);
    // 使わなくなった旧キーは残しておいても意味がないので消す
    localStorage.removeItem(LEGACY_VOLUME_STORAGE_KEY);
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
    this._applyMuted(muted);
    localStorage.setItem(MUTE_STORAGE_KEY, String(this._muted));
  }

  get isMuted() {
    return this._muted;
  }

  setVolume(volume) {
    this._applyVolume(volume);
    localStorage.setItem(VOLUME_STORAGE_KEY, String(this._volume));
  }

  get volume() {
    return this._volume;
  }

  // 保存を伴わない反映。起動時（既定値の適用）と set系（保存あり）で共用する
  _applyMuted(muted) {
    this._muted = muted;
    Howler.mute(muted);
  }

  _applyVolume(volume) {
    this._volume = Math.min(1, Math.max(0, volume));
    Howler.volume(this._volume);
  }
}

export const soundManager = new SoundManager();
