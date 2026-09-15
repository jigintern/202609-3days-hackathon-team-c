import * as THREE from 'three';
import './styles/main.css';
import { TitleScene } from './scenes/TitleScene.js';
import { GameScene } from './scenes/GameScene.js';
import { ResultScene } from './scenes/ResultScene.js';

// 画面遷移の状態。文字列定数で管理するシンプルなステートマシン
// TITLE（タイトル表示とメール本文の入力を兼ねる）→「スタート」→ GAME という流れ
const SCREEN = {
  TITLE: 'TITLE',
  GAME: 'GAME',
  RESULT: 'RESULT',
};

class App {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.overlayRoot = document.getElementById('overlay-root');
    this.currentScene = null;
    this.currentScreen = null;
    // 直前に遊んだメール本文。タイトルへ戻ったときの入力欄の復元と、
    // リザルトの「もう一度」で同じ文面を積み直すために画面をまたいで保持する
    this.mailText = '';

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
        // 入力されたメール本文をGAME画面へ渡す。ブロック生成はGameScene側の責務
        onStart: (mailText) => this.goTo(SCREEN.GAME, { mailText }),
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
    if (screen === SCREEN.GAME) {
      // 「もう一度」のようにペイロードなしで来た場合も、直前と同じ文面で遊べるようにする。
      // 一度も入力されていなければ空文字のままで、GameScene側が
      // ランダム文面フォールバックに切り替わる
      this.mailText = payload.mailText ?? this.mailText;
      this.scenes[SCREEN.GAME].setMailText(this.mailText);
    }
    if (screen === SCREEN.TITLE) {
      // 貼り直さずにもう一度遊べるよう、直前の本文を入力欄へ書き戻す
      this.scenes[SCREEN.TITLE].setMailText(this.mailText);
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
