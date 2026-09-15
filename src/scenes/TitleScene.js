// タイトル画面。スタート / 遊び方の2ボタンのみ
export class TitleScene {
  constructor({ overlayRoot, onStart, onShowHowTo }) {
    this.overlayRoot = overlayRoot;
    this.onStart = onStart;
    this.onShowHowTo = onShowHowTo;

    this.root = document.createElement('div');
    this.root.className = 'screen';
    this.root.innerHTML = `
      <h1>ドカン！お祈りメールクラッシャー</h1>
      <p>就活の「お祈りメール」や抽選の「落選メール」を鉄球でぶっ壊せ！</p>
      <button class="btn" id="btn-start">スタート</button>
      <button class="btn btn-secondary" id="btn-howto">遊び方</button>
    `;
  }

  mount() {
    this.overlayRoot.appendChild(this.root);
    this.root.classList.add('is-active');
    this.root.querySelector('#btn-start').addEventListener('click', this.onStart);
    this.root
      .querySelector('#btn-howto')
      .addEventListener('click', this.onShowHowTo);
  }

  unmount() {
    this.root.remove();
  }
}
