import { soundManager } from '../audio/SoundManager.js';

// リザルト画面。リトライ / タイトルへ戻るボタン。
// スコアは持たない（このゲームは点数を競う遊びではないため）。
// 粉砕結果の表示は別途 setResult() 経由で積み上げる
export class ResultScene {
  constructor({ overlayRoot, onRetry, onBackToTitle }) {
    this.overlayRoot = overlayRoot;
    this.onRetry = onRetry;
    this.onBackToTitle = onBackToTitle;

    this.root = document.createElement('div');
    this.root.className = 'screen';
    this.root.innerHTML = `
      <h1>リザルト</h1>
      <button class="btn" id="btn-retry">もう一度</button>
      <button class="btn btn-secondary" id="btn-title">タイトルへ戻る</button>
    `;
  }

  mount() {
    this.overlayRoot.appendChild(this.root);
    this.root.classList.add('is-active');
    this.root.querySelector('#btn-retry').addEventListener('click', () => {
      soundManager.play('click');
      this.onRetry();
    });
    this.root.querySelector('#btn-title').addEventListener('click', () => {
      soundManager.play('click');
      this.onBackToTitle();
    });
  }

  unmount() {
    this.root.remove();
  }
}
