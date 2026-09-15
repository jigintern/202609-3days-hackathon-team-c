import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PhysicsWorld } from '../game/PhysicsWorld.js';
import { Ball } from '../game/Ball.js';
import { Block, createCharacterTexture } from '../game/Block.js';
import { AimController } from '../game/AimController.js';
import { TrajectoryPreview } from '../game/TrajectoryPreview.js';
import { HUD } from '../ui/HUD.js';
import { getRandomEmailText } from '../data/emailTexts.js';

const TOTAL_BALLS = 8;
const SCORE_PER_BLOCK = 100;
const LAUNCH_ORIGIN = new THREE.Vector3(0, 1.5, 11);
const BALL_MAX_LIFETIME_SECONDS = 3; // 稀に物理演算が収束しないケースの保険
const BALL_REST_SPEED = 0.8; // 着地後わずかに転がり続けるだけの状態を「静止」とみなす閾値

// メール本文からブロックタワーを組む際の文字数上限（タワーが発散しないための目安。
// MailInputScene側のMAX_MAIL_LENGTH（textareaのmaxlength）と揃えてある）
const MAX_MAIL_BLOCKS = 100;

// ブロックはサイズを変えない（小さくすると距離を引いた分と相殺してかえって
// 読みにくくなることを実機確認したため）。間隔もブロックサイズと同じ元の値のまま
const BLOCK_WIDTH = 1.6;
const BLOCK_HEIGHT = 0.95;

// 縦に積みすぎると自重で崩れて開始直後にブロックが壊れてしまう（実機で10行の
// 正方形タワーが自壊するのを確認済み）。行数はここで頭打ちにし、それ以上は
// 列を増やして横に広げる
const MAX_ROWS = 6;

const CAMERA_FOV_DEG = 50;
const CAMERA_LOOK_AT = new THREE.Vector3(0, 2, 0);
const CAMERA_BASE_POSITION = new THREE.Vector3(0, 9, 14);
const CAMERA_BASE_DISTANCE = CAMERA_BASE_POSITION.distanceTo(CAMERA_LOOK_AT);
const CAMERA_DIRECTION = CAMERA_BASE_POSITION.clone()
  .sub(CAMERA_LOOK_AT)
  .normalize();
// カメラが見下ろす角度になっている分、単純な視野角の計算だけでは必要な距離を
// 少し過小評価してしまうため、余裕を持たせておく（スマホの縦画面で
// タワーが画面端で切れるのを実機確認して調整した値）
const CAMERA_FRAME_PADDING = 1.3;


// メインのゲームプレイ画面。three.jsの描画とcannon-esの物理更新、
// 狙い/発射/スコア判定をひとつにまとめる
export class GameScene {
  constructor({ canvas, renderer, overlayRoot, onGameOver }) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.overlayRoot = overlayRoot;
    this.onGameOver = onGameOver;

    this.score = 0;
    this.remainingBalls = TOTAL_BALLS;
    this.blocks = [];
    this.activeBall = null;
    this.hasEnded = false;
    // MailInputScene経由で渡された文章。未設定(null)ならランダム文面にフォールバックする
    this.mailText = null;
    // 同じ文字のブロックでテクスチャを使い回すためのキャッシュ（文字 -> CanvasTexture）。
    // ブロック単位で破棄すると他のブロックの文字まで消えるため、unmount()でまとめて破棄する
    this.characterTextures = new Map();
  }

  // MailInputScene.onStartGame(mailText) から main.js を通じて渡される入力文字列を受け取る。
  // mount()より前に呼ばれる想定（ResultScene.setScoreと同じ使い方）
  setMailText(mailText) {
    this.mailText = mailText;
  }

  mount() {
    this.hasEnded = false;
    this.score = 0;
    this.remainingBalls = TOTAL_BALLS;
    this.blocks = [];
    this.activeBall = null;
    this.characterTextures = new Map();

    this.canvas.style.display = 'block';

    // 行構成（＝ブロック数）はカメラ距離とタワーのグリッド両方に影響するため、
    // ここで一度だけ確定させて両方に使い回す（_buildRowsはランダム文面への
    // フォールバックを含み呼ぶたびに結果が変わり得るため、二重に呼ばない）。
    // 各行は同じ幅（wrapWidth）に揃えてあり、足りない分は空白ブロックで埋めて
    // あるので、行をまたいでも同じ列には必ず支えがある（自重で崩れない）
    const { rows, wrapWidth } = this._buildRows();
    this.rows = rows;
    this.maxCols = wrapWidth;
    this.towerWidth = this.maxCols * BLOCK_WIDTH;
    this.towerHeight = this.rows.length * BLOCK_HEIGHT;

    this._setupThree();
    this._setupPhysics();
    this._setupTower();

    this.hud = new HUD(this.overlayRoot);
    this.hud.show();
    this.hud.setScore(this.score);
    this.hud.setRemainingBalls(this.remainingBalls);

    this.aimController = new AimController(
      this.canvas,
      this.camera,
      LAUNCH_ORIGIN,
      (direction, power) => this._launchBall(direction, power)
    );
    this.trajectoryPreview = new TrajectoryPreview(this.scene);

    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);
  }

  unmount() {
    window.removeEventListener('resize', this._onResize);
    this.aimController.dispose();
    this.trajectoryPreview.dispose();
    this.hud.hide();
    this.hud.root.remove();

    this.blocks.forEach((block) => block.dispose());
    if (this.activeBall) this.activeBall.dispose();

    // ブロック間で共有している文字テクスチャはここでまとめて破棄する
    this.characterTextures.forEach((texture) => texture.dispose());
    this.characterTextures.clear();

    this.canvas.style.display = 'none';
  }

  _setupThree() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1d2e);
    this.scene.fog = new THREE.Fog(0x1a1d2e, 20, 40);

    this.camera = new THREE.PerspectiveCamera(
      CAMERA_FOV_DEG,
      window.innerWidth / window.innerHeight,
      0.1,
      300
    );
    this._applyCameraFraming();

    this.renderer.setSize(window.innerWidth, window.innerHeight);

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);

    const directional = new THREE.DirectionalLight(0xffffff, 1.0);
    directional.position.set(6, 12, 8);
    directional.castShadow = true;
    this.scene.add(directional);

    const floorGeometry = new THREE.PlaneGeometry(40, 40);
    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2e42 });
    this.floorMesh = new THREE.Mesh(floorGeometry, floorMaterial);
    this.floorMesh.rotation.x = -Math.PI / 2;
    this.floorMesh.receiveShadow = true;
    this.scene.add(this.floorMesh);
  }

  // タワーの実際の幅・高さが画面（の視野角）にちょうど収まるカメラ距離を、
  // 現在のアスペクト比から逆算する。スマホの縦画面のように横方向の視野が狭い
  // ときは横幅基準の距離が、通常の横長画面では高さ基準の距離が効いてくる。
  // カメラは見下ろす角度がついているため正確な計算ではないが、
  // CAMERA_FRAME_PADDINGで余裕を持たせて画面端で切れないようにしている
  _applyCameraFraming() {
    const aspect = this.camera.aspect;
    const verticalFov = THREE.MathUtils.degToRad(CAMERA_FOV_DEG);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);

    const halfWidth = (this.towerWidth / 2) * CAMERA_FRAME_PADDING;
    const halfHeight = (this.towerHeight / 2) * CAMERA_FRAME_PADDING;
    const distanceForWidth = halfWidth / Math.tan(horizontalFov / 2);
    const distanceForHeight = halfHeight / Math.tan(verticalFov / 2);
    const distance = Math.max(
      CAMERA_BASE_DISTANCE,
      distanceForWidth,
      distanceForHeight
    );

    this.camera.position
      .copy(CAMERA_LOOK_AT)
      .addScaledVector(CAMERA_DIRECTION, distance);
    this.camera.lookAt(CAMERA_LOOK_AT);

    // フォグの範囲（元は20〜40）はカメラ距離が基準のときの値。カメラを遠ざける
    // 分だけフォグも比例して遠くに伸ばさないと、タワーがフォグに沈んで見えなくなる
    const cameraDistanceScale = distance / CAMERA_BASE_DISTANCE;
    this.scene.fog.near = 20 * cameraDistanceScale;
    this.scene.fog.far = 40 * cameraDistanceScale;
  }

  _setupPhysics() {
    this.physicsWorld = new PhysicsWorld();
    this.material = this.physicsWorld.defaultMaterial;

    const floorBody = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Plane(),
      material: this.material,
    });
    floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.physicsWorld.addBody(floorBody);
  }

  _setupTower() {
    // 各行は改行または自動折り返しで区切られた文字配列。全行共通のmaxColsを
    // 基準に左詰めで配置する（行ごとに中央寄せすると物理的に不安定になるため）
    this.rows.forEach((rowChars, row) => {
      rowChars.forEach((character, col) => {
        this._spawnBlock(character, row, col);
      });
    });
  }

  // タワーに積む行（文字の配列の配列）を作る。「1文字=1ブロック」の組み方を
  // ここ1箇所に集約し、メール本文が渡されなかった場合（遊び方からゲームへ直行した
  // 場合など）もランダムな文面を同じ手順で行分解する。
  //
  // - メール本文中の改行はそのまま新しい行の区切りとして扱う（改行のたびに新しい行）
  // - 改行のない長い行は自動で折り返す（折り返し幅は_splitIntoRows参照）
  // - 行内のスペース（全角含む）はブロックにしても意味がないため取り除く
  // - サロゲートペア（絵文字など）を割らないよう Array.from で分割する
  // - 全体の文字数が MAX_MAIL_BLOCKS を超える分は切り詰めてタワーが発散しないようにする
  // - 短い行は空白ブロック（''）で右側を埋め、全行を同じ幅に揃える
  _buildRows() {
    const primary = this._splitIntoRows(this.mailText ?? '');
    // 空白だけの入力でブロックが0個になると開始直後にゲームが終わってしまうため、
    // 行が1つも残らなければランダム文面に退避する
    return primary.rows.length > 0
      ? primary
      : this._splitIntoRows(getRandomEmailText());
  }

  _splitIntoRows(text) {
    // 折り返し幅は総文字数の平方根（正方形に近い形）から決める。これは
    // 「読みやすさを確認済みの基準」である元の実装のcols計算
    // （Math.ceil(Math.sqrt(文字数))）を踏襲したもの。改行のない1本の長文でも
    // 極端に横長にならず、行数・列数がバランスよく増えていく。
    // ただしMAX_ROWSを超えて積み上がりそうな文字数になったら、行を増やさず
    // 折り返し幅（列数）だけを増やして横に広げる
    const totalChars = Math.min(
      MAX_MAIL_BLOCKS,
      Array.from(text.replace(/\s+/g, '')).length
    );
    const wrapWidth = Math.max(
      1,
      Math.ceil(Math.sqrt(totalChars)),
      Math.ceil(totalChars / MAX_ROWS)
    );

    const rows = [];
    let remaining = MAX_MAIL_BLOCKS;

    outer: for (const line of text.split(/\r\n|\r|\n/)) {
      const lineChars = Array.from(line.replace(/\s+/g, ''));
      for (let start = 0; start < lineChars.length; start += wrapWidth) {
        if (remaining <= 0) break outer;
        const chunk = lineChars.slice(start, start + wrapWidth).slice(0, remaining);
        rows.push(chunk);
        remaining -= chunk.length;
      }
    }

    // 行ごとに実際の文字数で中央寄せすると、短い行の上に長い行が乗ったときに
    // 支えのないオーバーハングができて自重で崩れてしまう（実機で確認済み）。
    // 全行をwrapWidthに揃えて空白ブロックで埋めることで、どの行も必ず
    // 下の行に支えられるようにする
    const paddedRows = rows.map((row) => {
      const padded = row.slice();
      while (padded.length < wrapWidth) {
        padded.push('');
      }
      return padded;
    });

    return { rows: paddedRows, wrapWidth };
  }

  // 同じ文字は同じテクスチャを使い回す。ブロック数ぶん毎回描き直す必要はなく、
  // 「の」「ご」のように頻出する文字ほど効く
  _getCharacterTexture(character) {
    let texture = this.characterTextures.get(character);
    if (!texture) {
      texture = createCharacterTexture(character);
      this.characterTextures.set(character, texture);
    }
    return texture;
  }

  _spawnBlock(character, row, col) {
    const block = new Block(
      this.physicsWorld,
      this.material,
      this._getCharacterTexture(character)
    );
    this.scene.add(block.mesh);

    const x = (col - (this.maxCols - 1) / 2) * BLOCK_WIDTH;
    const y = BLOCK_HEIGHT / 2 + row * BLOCK_HEIGHT;
    const z = 0;
    block.spawnAt(new THREE.Vector3(x, y, z));

    this.blocks.push(block);
  }

  _launchBall(direction, power) {
    if (this.hasEnded) return;
    if (this.activeBall || this.remainingBalls <= 0) return;

    this.remainingBalls -= 1;
    this.hud.setRemainingBalls(this.remainingBalls);

    const ball = new Ball(this.physicsWorld, this.material);
    ball.spawnAt(LAUNCH_ORIGIN);
    ball.launch(direction, power);
    this.scene.add(ball.mesh);
    this.activeBall = ball;
    this.activeBallAge = 0;
  }

  _isBallAtRest(ball, age) {
    const speed = ball.body.velocity.length();
    const fellOffStage = ball.body.position.y < -5;
    const tookTooLong = age >= BALL_MAX_LIFETIME_SECONDS;
    return fellOffStage || speed < BALL_REST_SPEED || tookTooLong;
  }

  update(deltaSeconds) {
    if (this.hasEnded) return;

    this.hud.setPower(this.aimController.powerPercent);

    const canLaunch = !this.activeBall && this.remainingBalls > 0;
    if (this.aimController.isDragging && canLaunch) {
      this.trajectoryPreview.show();
      this.trajectoryPreview.update(
        LAUNCH_ORIGIN,
        this.aimController.direction,
        this.aimController.powerPercent
      );
    } else {
      this.trajectoryPreview.hide();
    }

    this.physicsWorld.step(deltaSeconds);

    this.blocks.forEach((block) => block.syncMeshToBody());
    if (this.activeBall) this.activeBall.syncMeshToBody();

    this._resolveBrokenBlocks();
    this._resolveActiveBall(deltaSeconds);
    this._checkGameOver();

    this.renderer.render(this.scene, this.camera);
  }

  _resolveBrokenBlocks() {
    const survivors = [];
    this.blocks.forEach((block) => {
      if (block.shouldBreak) {
        this.scene.remove(block.mesh);
        block.dispose();
        this.score += SCORE_PER_BLOCK;
        this.hud.setScore(this.score);
      } else {
        survivors.push(block);
      }
    });

    // 落ち着いたタワーはcannon-esのスリープに入っていて、下のブロックが消えても
    // 目を覚まさず宙に浮いたままになる。壊れたぶんだけ残りを起こして自然に崩落させる
    if (survivors.length !== this.blocks.length) {
      survivors.forEach((block) => block.body.wakeUp());
    }

    this.blocks = survivors;
  }

  _resolveActiveBall(deltaSeconds) {
    if (!this.activeBall) return;
    this.activeBallAge += deltaSeconds;
    if (this._isBallAtRest(this.activeBall, this.activeBallAge)) {
      this.scene.remove(this.activeBall.mesh);
      this.activeBall.dispose();
      this.activeBall = null;
    }
  }

  _checkGameOver() {
    const cleared = this.blocks.length === 0;
    const outOfAmmo = this.remainingBalls <= 0 && !this.activeBall;
    if (cleared || outOfAmmo) {
      this.hasEnded = true;
      this.onGameOver(this.score);
    }
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    // 画面回転などでアスペクト比が変わるとタワーが収まる距離も変わるため、
    // カメラ位置も引き直す
    this._applyCameraFraming();
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
