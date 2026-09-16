import * as THREE from 'three';

// 手紙をくわえた鳥。ゲーム開始時に一度だけ空を横切り、球を当てると
// 手紙を落として飛び去る。落ちた手紙がタワーを吹き飛ばす（その先はGameSceneの責務）。
//
// 飛ぶ高さ(BIRD_Y)と奥行き(BIRD_Z)は見た目の好みではなく、球が届く範囲から
// 逆算して決めてある。画面の上端は壁の面(z=0)でおよそ19.7mあるので、文字どおり
// 画面の上端に置くとどう撃っても届かない。
//
// そこで「壁の面を通過する瞬間」を狙って判定できる z=0 に置いてある。
//
// 高さ13.8mは、最大パワー100・引き量0.91(仰角32.3度)で撃った球が壁の面を
// 通過する高さ13.66mとほぼ重なる値。狙って引けば中心を撃ち抜けるが、
// 当ててしまうとゲームが一瞬で終わるので、壁を狙った外し球が偶然当たることは
// ない高さに置いてある（壁に当たるのは引き量0.20〜0.74、鳥は0.71〜1.00）。
// 6行の壁（いちばん高い構成）の上端が11.85mなので、その1.95m上を飛ぶ形になる。
// 引き切り(仰角34度)では14.85mを通過して鳥の上を越える。
//
// 当てにくさの主な源は縦ではなく横とタイミングで、狙える横のズレは
// 最大でも±2.24m（横断8秒のとき、PCでタイミング±0.37秒）。
//
// 発射地点・MAX_LAUNCH_SPEED・仰角の範囲（AimController）のどれかを変えたら、
// ここも軌道を計算し直すこと
export const BIRD_Y = 13.8;
export const BIRD_Z = 0;
// 当たり判定の半径（球の半径は含まない。GameScene側で足す）。
// 鳥の見た目の差し渡し（翼幅2.8m＝半分で1.4m）より少しだけ大きい程度で、
// 「かすったのに当たった」とは感じない範囲に収めてある。
// ワールド単位の固定値なのは、画面の大きさや文字数でカメラが引いても
// 当てる難しさが変わらないようにするため
export const BIRD_HIT_RADIUS = 1.9;

// 鳥のモデルは翼幅1.4mで組んであり、ここで実寸へ拡大する。
// 壁のブロックが1マス1.6m間隔なので、翼幅2.8m＝文字およそ2つぶん。
// カメラが引いても小さくなりすぎず、当たり判定の大きさとも釣り合う
const BIRD_SCALE = 2.0;

// 画面を渡りきるのにかける時間（秒）。速度ではなく時間を固定しているので、
// 画面の縦横比が変わっても「画面上を横切る速さ」の見え方は揃う。
// 横長の画面ほど実際の速度は上がり、球の飛行時間(約0.82秒)ぶんの「見越し」も
// 増える（PCの1280x800でおよそ秒速6.0m・見越し4.9m）。
// これが当てにくさの主な源になっている
const CROSS_SECONDS = 8;

// 画面の外から入って外へ抜けるための余白（m）
export const BIRD_OFFSCREEN_MARGIN = 3;

// はばたきの速さ(rad/s)と振り幅(rad)。ゆったり滑空して見える程度に抑えている
const FLAP_SPEED = 6.5;
const FLAP_AMPLITUDE = 0.5;
// 上下にゆれる幅(m)と速さ(rad/s)。引き切りの球と鳥の距離には0.25mしか
// 余裕がないので、ここを大きくすると当たり外れが揺れ任せになってしまう
const BOB_AMPLITUDE = 0.08;
const BOB_SPEED = 1.3;

// 命中後、驚いた鳥が飛び去るときの加速と上昇。画面外へ抜けたら消す
const ESCAPE_FORWARD_SPEED = 9;
const ESCAPE_RISE_SPEED = 5;
const ESCAPE_SECONDS = 2.5;

// 落とした手紙がタワーへ届くまでの時間（秒）
const LETTER_FALL_SECONDS = 0.75;

// 鳥の配色。空(0x8ecbf0)の上で沈まないよう、体は明るい生成り色にしている
const BODY_COLOR = 0xfaf8f3;
const WING_COLOR = 0xd5cfc3;
const BEAK_COLOR = 0xe8973c;
const EYE_COLOR = 0x2a2724;

// 手紙のテクスチャ。ブロックと同じ「紙」の見立てに揃えてある
const LETTER_PAPER_COLOR = '#f5efe0';
const LETTER_LINE_COLOR = '#c9b99a';
const LETTER_SEAL_COLOR = '#a8342a';
const LETTER_TEXTURE_WIDTH = 256;
const LETTER_TEXTURE_HEIGHT = 176;

// 封筒の絵。フラップ（三角の折り返し）と封蝋だけで「手紙」と読めるようにする
function createLetterTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = LETTER_TEXTURE_WIDTH;
  canvas.height = LETTER_TEXTURE_HEIGHT;
  const context = canvas.getContext('2d');

  context.fillStyle = LETTER_PAPER_COLOR;
  context.fillRect(0, 0, LETTER_TEXTURE_WIDTH, LETTER_TEXTURE_HEIGHT);

  context.strokeStyle = LETTER_LINE_COLOR;
  context.lineWidth = 6;
  context.strokeRect(3, 3, LETTER_TEXTURE_WIDTH - 6, LETTER_TEXTURE_HEIGHT - 6);

  // フラップ。上辺の両端から中央下へ向かう2本の線
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(LETTER_TEXTURE_WIDTH / 2, LETTER_TEXTURE_HEIGHT * 0.58);
  context.lineTo(LETTER_TEXTURE_WIDTH, 0);
  context.stroke();

  context.fillStyle = LETTER_SEAL_COLOR;
  context.beginPath();
  context.arc(
    LETTER_TEXTURE_WIDTH / 2,
    LETTER_TEXTURE_HEIGHT * 0.58,
    LETTER_TEXTURE_HEIGHT * 0.12,
    0,
    Math.PI * 2
  );
  context.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// ゲーム開始時に一度だけ空を横切る鳥。物理ボディは持たず、位置は自前で動かす。
// 当たり判定もGameScene側の距離比較だけ（cannon-esのボディにすると球が跳ね返って
// しまい、「鳥を撃ち抜いた」感が出ないため）
export class Bird {
  // onLetterArrive: 落とした手紙がタワーに届いた瞬間に、その位置で呼ばれる
  constructor(scene, { onLetterArrive } = {}) {
    this.scene = scene;
    this.onLetterArrive = onLetterArrive ?? (() => {});

    // 'idle' → start() → 'flying' → hit()で'escaping' → 'gone'
    // （当てられなければ画面外へ抜けた時点で'gone'）
    this.state = 'idle';
    this.age = 0;
    this.escapeAge = 0;
    // どちらもsetHalfSpan()が実際の値で上書きする。start()より前に
    // updateが回っても止まらないよう、仮の値を入れてある
    this.halfSpan = 20;
    this.speed = (this.halfSpan * 2) / CROSS_SECONDS;
    // +1なら左から右へ、-1なら右から左へ
    this.heading = 1;

    this.letterTexture = createLetterTexture();
    this.group = new THREE.Group();
    this.group.scale.setScalar(BIRD_SCALE);
    this.group.visible = false;
    this._buildBody();
    this.scene.add(this.group);

    // 落下中の手紙。hit()でgroupから切り離してシーン直下へ移す
    this.letterState = 'held';
    this.letterFallAge = 0;
    this.letterStart = new THREE.Vector3();
    this.letterTarget = new THREE.Vector3();
  }

  // モデルは+X方向を向いた状態で組む。右から左へ飛ぶときは group.rotation.y を
  // 反転させるだけで向きが揃う
  _buildBody() {
    // 空に浮かぶ小さな的なので、遠くの壁と同じくフォグで色が濁らないようにする
    const makeMaterial = (color) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.75, fog: false });

    this.bodyMaterial = makeMaterial(BODY_COLOR);
    this.wingMaterial = makeMaterial(WING_COLOR);
    this.beakMaterial = makeMaterial(BEAK_COLOR);
    this.eyeMaterial = makeMaterial(EYE_COLOR);

    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 16, 12),
      this.bodyMaterial
    );
    body.scale.set(1.5, 0.85, 0.85);
    body.castShadow = true;
    this.group.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 14, 10),
      this.bodyMaterial
    );
    head.position.set(0.36, 0.16, 0);
    head.castShadow = true;
    this.group.add(head);

    // くちばし。ConeGeometryは+Yを向いて生えるので、+Xへ倒す
    const beak = new THREE.Mesh(
      new THREE.ConeGeometry(0.07, 0.22, 8),
      this.beakMaterial
    );
    beak.rotation.z = -Math.PI / 2;
    beak.position.set(0.58, 0.11, 0);
    this.group.add(beak);

    [0.12, -0.12].forEach((z) => {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.035, 8, 6),
        this.eyeMaterial
      );
      eye.position.set(0.45, 0.21, z);
      this.group.add(eye);
    });

    const tail = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.05, 0.24),
      this.wingMaterial
    );
    tail.position.set(-0.46, 0.08, 0);
    tail.rotation.z = 0.22;
    tail.castShadow = true;
    this.group.add(tail);

    // 翼は根元に軸(pivot)を置き、そこを中心に上下へ振る。
    // 翼そのものを回すと付け根ごと動いてしまい、羽ばたきに見えない
    this.wingPivots = [1, -1].map((side) => {
      const pivot = new THREE.Group();
      pivot.position.set(0, 0.12, 0);
      const wing = new THREE.Mesh(
        new THREE.BoxGeometry(0.44, 0.05, 0.62),
        this.wingMaterial
      );
      wing.position.set(-0.02, 0, side * 0.38);
      wing.castShadow = true;
      pivot.add(wing);
      pivot.userData.side = side;
      this.group.add(pivot);
      return pivot;
    });

    // 手紙はくちばしの先に吊るす。命中時にここから切り離して落とす
    this.letterMaterial = new THREE.MeshStandardMaterial({
      map: this.letterTexture,
      roughness: 0.9,
      fog: false,
      side: THREE.DoubleSide,
    });
    this.letterMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.32, 0.02),
      this.letterMaterial
    );
    this.letterMesh.position.set(0.6, -0.14, 0);
    this.letterMesh.rotation.z = -0.25;
    this.letterMesh.castShadow = true;
    this.group.add(this.letterMesh);
  }

  // 画面の横幅（の半分＋余白）。GameSceneがカメラの画角から計算して渡す
  setHalfSpan(halfSpan) {
    this.halfSpan = halfSpan;
    this.speed = (halfSpan * 2) / CROSS_SECONDS;
    // 飛び始める前なら、入場位置も新しい幅に合わせ直す
    if (this.state === 'idle') this._placeAtStart();
  }

  _placeAtStart() {
    this.group.position.set(-this.heading * this.halfSpan, BIRD_Y, BIRD_Z);
    this.group.rotation.y = this.heading > 0 ? 0 : Math.PI;
  }

  // 左右どちらから飛んでくるかは毎回ランダム。隠し要素なので、
  // 同じ方向から出続けて作業的に見えないようにする
  start() {
    this.heading = Math.random() < 0.5 ? 1 : -1;
    this._placeAtStart();
    this.group.visible = true;
    this.state = 'flying';
    this.age = 0;
  }

  // 球を当てられる状態か。飛び去ったあとや命中後は対象外
  get isTargetable() {
    return this.state === 'flying';
  }

  // 当たり判定に使う機体の中心（THREE.Vector3。呼び出し側で書き換えないこと）
  get position() {
    return this.group.position;
  }

  // 命中。手紙を切り離してtargetPositionへ落とし、鳥自身は驚いて飛び去る
  hit(targetPosition) {
    if (this.state !== 'flying') return;
    this.state = 'escaping';
    this.escapeAge = 0;

    // 手紙はgroupの子なので、外すとローカル座標になる。
    // 先にワールド座標を取ってからシーン直下へ移し、その位置を入れ直す
    this.letterStart = this.letterMesh.getWorldPosition(new THREE.Vector3());
    this.letterTarget = targetPosition.clone();
    this.group.remove(this.letterMesh);
    this.letterMesh.scale.setScalar(BIRD_SCALE);
    this.letterMesh.position.copy(this.letterStart);
    this.scene.add(this.letterMesh);
    this.letterState = 'falling';
    this.letterFallAge = 0;
  }

  update(deltaSeconds) {
    if (this.letterState === 'falling') this._updateLetterFall(deltaSeconds);
    if (this.state === 'idle' || this.state === 'gone') return;

    this.age += deltaSeconds;

    if (this.state === 'flying') {
      this.group.position.x += this.heading * this.speed * deltaSeconds;
      this.group.position.y = BIRD_Y + Math.sin(this.age * BOB_SPEED) * BOB_AMPLITUDE;
      // 渡りきったら退場。一度きりの登場なので、ここで飛行は終わる
      if (Math.abs(this.group.position.x) > this.halfSpan) {
        this.state = 'gone';
        this.group.visible = false;
        return;
      }
    } else {
      this.escapeAge += deltaSeconds;
      this.group.position.x +=
        this.heading * ESCAPE_FORWARD_SPEED * deltaSeconds;
      this.group.position.y += ESCAPE_RISE_SPEED * deltaSeconds;
      if (this.escapeAge >= ESCAPE_SECONDS) {
        this.state = 'gone';
        this.group.visible = false;
        return;
      }
    }

    // はばたき。逃げている間は必死に見えるよう速く振る
    const flapSpeed = this.state === 'escaping' ? FLAP_SPEED * 2.2 : FLAP_SPEED;
    const flap = Math.sin(this.age * flapSpeed) * FLAP_AMPLITUDE;
    this.wingPivots.forEach((pivot) => {
      pivot.rotation.x = -pivot.userData.side * flap;
    });
  }

  // 落ちていく手紙。物理ボディは使わず、始点から目標へ二次曲線で寄せる。
  // 紙が空気を受けてひらひら揺れる動きを、横のサインと回転で足している
  _updateLetterFall(deltaSeconds) {
    this.letterFallAge += deltaSeconds;
    const progress = Math.min(1, this.letterFallAge / LETTER_FALL_SECONDS);
    // 落下は等速ではなく加速する。p^2で自由落下らしい溜めを作る
    this.letterMesh.position.lerpVectors(
      this.letterStart,
      this.letterTarget,
      progress * progress
    );
    const sway = (1 - progress) * 0.45;
    this.letterMesh.position.x += Math.sin(this.letterFallAge * 11) * sway;
    this.letterMesh.rotation.z = Math.sin(this.letterFallAge * 8) * 0.6;
    this.letterMesh.rotation.y = this.letterFallAge * 4;

    if (progress < 1) return;

    this.letterState = 'landed';
    this.letterMesh.visible = false;
    this.onLetterArrive(this.letterTarget.clone());
  }

  dispose() {
    this.scene.remove(this.group);
    this.scene.remove(this.letterMesh);
    // ジオメトリは鳥1体ぶんしか作っていないので、まとめて破棄してよい
    this.group.traverse((object) => object.geometry?.dispose());
    this.letterMesh.geometry.dispose();
    [
      this.bodyMaterial,
      this.wingMaterial,
      this.beakMaterial,
      this.eyeMaterial,
      this.letterMaterial,
    ].forEach((material) => material.dispose());
    this.letterTexture.dispose();
  }
}
