import { soundManager } from '../audio/SoundManager.js';

// 遊び方説明画面。操作方法テキストとタイトルへ戻るボタンのみ
export class HowToPlayScene {
  constructor({ overlayRoot, onBackToTitle }) {
    this.overlayRoot = overlayRoot;
    this.onBackToTitle = onBackToTitle;

    this._handleBackClick = this._handleBackClick.bind(this);

    this.root = document.createElement('div');
    this.root.className = 'screen';
    this.root.innerHTML = `
      <h1>遊び方</h1>
      <p>
        画面をドラッグして狙いを定めよう。<br />
        そのまま上に引っ張ると、放物線が高く・強くなる。<br />
        指を離すと、その角度と強さで鉄球が発射される。<br />
        メールブロックは壊れない。空中に浮いた棒の上から
        <strong>落として、メール本文を粉砕しよう</strong>。<br />
        棒の上を空にするか、球を全部使い切るとゲーム終了。
      </p>
      <button class="btn btn-secondary" id="btn-back-to-title">タイトルへ戻る</button>
    `;
  }

  mount() {
    this.overlayRoot.appendChild(this.root);
    this.root.classList.add('is-active');
    this.backButton = this.root.querySelector('#btn-back-to-title');
    this.backButton.addEventListener('click', this._handleBackClick);
  }

  unmount() {
    this.backButton.removeEventListener('click', this._handleBackClick);
    this.root.remove();
  }

  _handleBackClick() {
    soundManager.play('click');
    this.onBackToTitle();
  }
}
