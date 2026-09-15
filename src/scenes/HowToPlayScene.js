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
        画面をドラッグして狙いを定めよう。<br />
        そのまま上に引っ張ると、放物線が高く・強くなる。<br />
        指を離すと、その角度と強さで鉄球が発射される。<br />
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
