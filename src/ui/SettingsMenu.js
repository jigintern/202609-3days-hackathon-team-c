import { soundManager } from '../audio/SoundManager.js';

// 歯車アイコンの固定ボタン。特定のシーンには属さず、overlay-root直下に
// 常駐させることでmount/unmountのたびに消えないようにする。
// クリックで音量/ミュート/スタート画面への復帰をまとめたパネルを開閉する
export class SettingsMenu {
  constructor(container, { onBackToTitle } = {}) {
    this.onBackToTitle = onBackToTitle;

    this.root = document.createElement('div');
    this.root.className = 'settings-widget';
    container.appendChild(this.root);

    this.toggleButton = document.createElement('button');
    this.toggleButton.type = 'button';
    this.toggleButton.id = 'settings-toggle';
    this.toggleButton.className = 'settings-toggle';
    this.toggleButton.textContent = '⚙️';
    this.toggleButton.setAttribute('aria-label', '設定を開く');
    this.root.appendChild(this.toggleButton);

    this.panel = document.createElement('div');
    this.panel.className = 'settings-panel';
    this.root.appendChild(this.panel);

    this._buildPanel();

    this.toggleButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this._setOpen(!this._isOpen);
    });
    document.addEventListener('click', (event) => {
      if (this._isOpen && !this.root.contains(event.target)) {
        this._setOpen(false);
      }
    });

    this._setOpen(false);
    this._render();
  }

  _buildPanel() {
    const muteRow = document.createElement('div');
    muteRow.className = 'settings-row';
    this.muteButton = document.createElement('button');
    this.muteButton.type = 'button';
    this.muteButton.className = 'settings-mute-btn';
    this.muteButton.addEventListener('click', () => {
      soundManager.setMuted(!soundManager.isMuted);
      this._render();
    });
    muteRow.appendChild(this.muteButton);
    this.panel.appendChild(muteRow);

    const volumeRow = document.createElement('div');
    volumeRow.className = 'settings-row';
    const volumeLabel = document.createElement('label');
    volumeLabel.className = 'settings-volume-label';
    volumeLabel.textContent = '音量';
    volumeLabel.htmlFor = 'settings-volume-slider';
    this.volumeSlider = document.createElement('input');
    this.volumeSlider.type = 'range';
    this.volumeSlider.id = 'settings-volume-slider';
    this.volumeSlider.className = 'settings-volume-slider';
    this.volumeSlider.min = '0';
    this.volumeSlider.max = '100';
    this.volumeSlider.addEventListener('input', () => {
      soundManager.setVolume(Number(this.volumeSlider.value) / 100);
    });
    volumeRow.appendChild(volumeLabel);
    volumeRow.appendChild(this.volumeSlider);
    this.panel.appendChild(volumeRow);

    this.backButton = document.createElement('button');
    this.backButton.type = 'button';
    this.backButton.className = 'settings-back-btn';
    this.backButton.textContent = 'スタート画面に戻る';
    this.backButton.addEventListener('click', () => {
      this._setOpen(false);
      this.onBackToTitle?.();
    });
    this.panel.appendChild(this.backButton);
  }

  _setOpen(open) {
    this._isOpen = open;
    this.panel.classList.toggle('is-open', open);
    this.toggleButton.setAttribute('aria-expanded', String(open));
  }

  _render() {
    const muted = soundManager.isMuted;
    this.muteButton.textContent = muted ? '🔇 ミュート中' : '🔊 サウンドON';
    this.muteButton.classList.toggle('is-muted', muted);
    this.muteButton.setAttribute('aria-pressed', String(muted));
    this.volumeSlider.value = String(Math.round(soundManager.volume * 100));
  }
}
