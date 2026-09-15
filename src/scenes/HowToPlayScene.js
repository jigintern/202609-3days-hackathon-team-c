// 遊び方説明画面。操作方法テキストとスキップボタンのみ
export class HowToPlayScene {
  constructor({ overlayRoot, onSkip }) {
    this.overlayRoot = overlayRoot;
    this.onSkip = onSkip;

    this.root = document.createElement('div');
    this.root.className = 'screen';
    this.root.innerHTML = `
      <h1>遊び方</h1>
      <p>
        マウスを動かして狙いを定めよう。<br />
        クリックを長押しするとパワーゲージが往復するので、<br />
        好きなタイミングで指を離すと鉄球が発射される。<br />
        タワー状に積まれたメールブロックを全部壊すか、
        球を全部使い切るとゲーム終了。
      </p>
      <button class="btn" id="btn-skip">はじめる</button>
    `;
  }

  mount() {
    this.overlayRoot.appendChild(this.root);
    this.root.classList.add('is-active');
    this.root.querySelector('#btn-skip').addEventListener('click', this.onSkip);
  }

  unmount() {
    this.root.remove();
  }
}
