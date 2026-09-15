import * as THREE from 'three';
import './styles/main.css';
import { TitleScene } from './scenes/TitleScene.js';
import { HowToPlayScene } from './scenes/HowToPlayScene.js';
import { GameScene } from './scenes/GameScene.js';
import { ResultScene } from './scenes/ResultScene.js';

// 画面遷移の状態。文字列定数で管理するシンプルなステートマシン
const SCREEN = {
  TITLE: 'TITLE',
  HOWTO: 'HOWTO',
  GAME: 'GAME',
  RESULT: 'RESULT',
};

class App {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.overlayRoot = document.getElementById('overlay-root');
    this.currentScene = null;
    this.currentScreen = null;

    // 画面をまたいで使い回す唯一のWebGLRenderer。画面ごとに作り直すとcanvasの
    // コンテキストが競合するため、ここで一度だけ生成する
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;

    this.scenes = {
      [SCREEN.TITLE]: new TitleScene({
        canvas: this.canvas,
        renderer: this.renderer,
        overlayRoot: this.overlayRoot,
        onStart: () => this.goTo(SCREEN.GAME),
        onShowHowTo: () => this.goTo(SCREEN.HOWTO),
      }),
      [SCREEN.HOWTO]: new HowToPlayScene({
        overlayRoot: this.overlayRoot,
        onSkip: () => this.goTo(SCREEN.GAME),
      }),
      [SCREEN.GAME]: new GameScene({
        canvas: this.canvas,
        renderer: this.renderer,
        overlayRoot: this.overlayRoot,
        onGameOver: (score) => this.goTo(SCREEN.RESULT, { score }),
      }),
      [SCREEN.RESULT]: new ResultScene({
        overlayRoot: this.overlayRoot,
        onRetry: () => this.goTo(SCREEN.GAME),
        onBackToTitle: () => this.goTo(SCREEN.TITLE),
      }),
    };

    this._lastTime = performance.now();
    this._tick = this._tick.bind(this);
  }

  goTo(screen, payload = {}) {
    if (this.currentScene) {
      this.currentScene.unmount();
    }

    if (screen === SCREEN.RESULT) {
      this.scenes[SCREEN.RESULT].setScore(payload.score ?? 0);
    }

    this.currentScreen = screen;
    this.currentScene = this.scenes[screen];
    this.currentScene.mount();
  }

  start() {
    this.goTo(SCREEN.TITLE);
    requestAnimationFrame(this._tick);
  }

  _tick(now) {
    const deltaSeconds = Math.min((now - this._lastTime) / 1000, 0.1);
    this._lastTime = now;

    if (this.currentScene && typeof this.currentScene.update === 'function') {
      this.currentScene.update(deltaSeconds);
    }

    requestAnimationFrame(this._tick);
  }
}

new App().start();
