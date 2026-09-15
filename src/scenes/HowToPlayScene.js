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
        画面下の <strong>&lt;</strong> <strong>&gt;</strong> を長押しすると、狙いが左右に振れる。<br />
        画面をどこでもいいので触って、<strong>手前に引く</strong>ほど放物線が高くなる。<br />
        <strong>右に引く</strong>ほど威力が上がり、速い球ほどブロックを大きく削る。<br />
        点線が着弾点を教えてくれるので、指を離す前に確かめよう。<br />
        壁状に積まれたメールブロックを全部壊すか、
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
