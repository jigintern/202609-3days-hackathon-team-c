import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PhysicsWorld } from '../game/PhysicsWorld.js';
import { Ball } from '../game/Ball.js';
import { Block, createCharacterTexture } from '../game/Block.js';
import { Bar, BAR_TOP_Y, BAR_Y } from '../game/Bar.js';
import { AimController } from '../game/AimController.js';
import { TrajectoryPreview } from '../game/TrajectoryPreview.js';
import { HUD } from '../ui/HUD.js';
import { getRandomEmailText } from '../data/emailTexts.js';
import { soundManager } from '../audio/SoundManager.js';

const TOTAL_BALLS = 8;
const SCORE_PER_BLOCK = 100;
// 発射地点。z がブロックの壁(z=0)までの距離そのもの。
// 空中(y=6)の棒に積んだ壁は幅7.8m・高さ4.7mあり、これを縦画面に収めるにはカメラを
// 21m以上引く必要がある。カメラを引くぶん球も届かなくなるので、発射地点と
// Ball の MAX_LAUNCH_SPEED（届く距離は速度の2乗に比例）はセットで見直すこと
const LAUNCH_ORIGIN = new THREE.Vector3(0, 1.5, 25);
const BALL_MAX_LIFETIME_SECONDS = 3; // 稀に物理演算が収束しないケースの保険
const BALL_REST_SPEED = 0.8; // 棒の上でわずかに転がり続けるだけの状態を「静止」とみなす閾値
// 外したボールを消す高さ。画面下端(z=0面で約-6.6m)より下で消して、
// 消える瞬間がプレイヤーに見えないようにする
const BALL_DESPAWN_Y = -8;

// 回収用の床の高さ。プレイヤーには見えない位置（画面下端よりはるか下・フォグの中）に置き、
// 落ちたブロックがここへ着いた時点で破棄する。無限に落ち続けるボディを作らないための受け皿
const FLOOR_Y = -20;
// 床に着いたとみなす高さ。床との衝突イベントが主で、これは取りこぼし用の保険
// （落ちたブロックの上に別のブロックが重なって着地した場合など）
const FLOOR_LANDED_Y = FLOOR_Y + 2;
// この高さより下に落ちたら「棒から落ちた」とみなして加点する。
// 棒の上で横滑りしただけのブロックを誤って数えないよう、棒より1m下に置いてある
const SCORE_FALL_Y = BAR_Y - 1;
// 落下音を鳴らすまでの遅延。実際の着地（画面外の回収床）は数秒かかり体感が遅いため、
// 棒から落ちた瞬間を起点に短い遅延だけ置いて鳴らす
const LAND_SOUND_DELAY_MS = 1000;

// メール本文からブロックの壁を組む際の文字数上限
// （MailInputScene側のMAX_MAIL_LENGTHと揃えてある）
const MAX_MAIL_BLOCKS = 100;

const BLOCK_WIDTH = 1.6;
const BLOCK_HEIGHT = 0.95;

// 縦に積みすぎると棒の上で自重に負けて開始直後に崩れる。行数はここで頭打ちにし、
// それ以上は列を増やして横に広げる（棒とカメラがその幅に追従する）
const MAX_ROWS = 6;

const CAMERA_FOV_DEG = 50;
// 24文字（5行5列・幅8m）の壁を映していたときの位置と注視点。ここから向きと
// 最短距離だけを取り出し、壁がこれより大きいときにカメラを後ろへ下げる
const CAMERA_BASE_POSITION = new THREE.Vector3(0, 9, 28);
const CAMERA_BASE_LOOK_AT = new THREE.Vector3(0, 7, 0);
const CAMERA_BASE_DISTANCE =
  CAMERA_BASE_POSITION.distanceTo(CAMERA_BASE_LOOK_AT);
const CAMERA_DIRECTION = CAMERA_BASE_POSITION.clone()
  .sub(CAMERA_BASE_LOOK_AT)
  .normalize();
// 壁の中心そのものではなく少し下を見る。壁を画面の上寄りに置いて、その下に
// ブロックが落ちていく空間を残すため（元の lookAt y=7 を再現する差分）
const CAMERA_LOOK_BELOW_WALL_CENTER = 1.5;
// カメラは見下ろす角度がついているため、単純な視野角の計算では必要な距離を
// 少し過小評価する。画面端で壁が切れないよう余裕を持たせておく
const CAMERA_FRAME_PADDING = 1.3;

// フォグはカメラ距離が CAMERA_BASE_DISTANCE のときの値。カメラを引くぶん
// 比例して伸ばさないと、壁がフォグに沈んで見えなくなる
const FOG_NEAR = 35;
const FOG_FAR = 50;


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
    // まだ棒の上に残っていて加点していないブロック
    this.blocks = [];
    // 棒から落ちて加点済みだが、まだ床に着いていない落下中のブロック
    this.fallingBlocks = [];
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
    this.fallingBlocks = [];
    this.activeBall = null;
    this.characterTextures = new Map();
    // 回収用の床に着いたボディの置き場。床のcollideイベントから積まれ、
    // 毎フレームの _resolveLandedBlocks() で消化する
    this.landedBodies = new Set();

    this.canvas.style.display = 'block';

    // 行構成は棒の長さ・カメラ距離・壁のグリッドの全てに効くので、ここで一度だけ
    // 確定させて使い回す（_buildRowsはランダム文面へのフォールバックを含み、
    // 呼ぶたびに結果が変わり得るため二重に呼ばない）。
    // 各行は同じ幅に揃え、足りない分は空白ブロックで埋めてあるので、
    // どの段にも必ず下の支えがある
    const { rows, wrapWidth } = this._buildRows();
    this.rows = rows;
    this.maxCols = wrapWidth;
    this.wallWidth = this.maxCols * BLOCK_WIDTH;
    this.wallHeight = this.rows.length * BLOCK_HEIGHT;

    this._setupThree();
    this._setupPhysics();
    this._setupBar();
    this._setupWall();

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
    this.fallingBlocks.forEach((block) => block.dispose());
    this.bar.dispose();
    if (this.activeBall) this.activeBall.dispose();
    this.groundMesh.geometry.dispose();
    this.groundMesh.material.dispose();

    // ブロック間で共有している文字テクスチャはここでまとめて破棄する
    this.characterTextures.forEach((texture) => texture.dispose());
    this.characterTextures.clear();

    this.canvas.style.display = 'none';
  }

  _setupThree() {
    this.scene = new THREE.Scene();
    // タイトル画面(TitleBackground)と同じ水色。同じ紙色ブロックの見た目が
    // この背景で視認性を確保できることは既にタイトル画面で確認済み
    this.scene.background = new THREE.Color(0x8ecbf0);
    // 回収用の床(y=-20)がフォグに沈む距離から掛ける。カメラからそこまでは約40mある
    this.scene.fog = new THREE.Fog(0x8ecbf0, 35, 50);

    this.camera = new THREE.PerspectiveCamera(
      CAMERA_FOV_DEG,
      window.innerWidth / window.innerHeight,
      0.1,
      // 文字数が多いとカメラが100m近くまで下がるので、far も一緒に伸ばしておく
      300
    );
    this._applyCameraFraming();

    this.renderer.setSize(window.innerWidth, window.innerHeight);

    const ambient = new THREE.AmbientLight(0xffffff, 0.9);
    this.scene.add(ambient);

    const directional = new THREE.DirectionalLight(0xfff3d6, 1.1);
    directional.position.set(6, 18, 8);
    directional.castShadow = true;
    // 影を落とす対象が原点付近から空中の壁(y=6〜11)へ移ったので、
    // ライトの注視点とシャドウカメラの範囲も一緒に持ち上げる。
    // これを忘れると壁がシャドウカメラの外に出て影が消える
    directional.target.position.set(0, BAR_Y + 2, 0);
    this.scene.add(directional.target);
    // 壁が横に広がるとシャドウカメラの外に出て影が消えるので、幅に追従させる
    const shadowExtent = Math.max(8, this.wallWidth / 2 + 2);
    directional.shadow.camera.left = -shadowExtent;
    directional.shadow.camera.right = shadowExtent;
    directional.shadow.camera.top = shadowExtent;
    directional.shadow.camera.bottom = -shadowExtent;
    directional.shadow.camera.updateProjectionMatrix();
    this.scene.add(directional);

    // タイトル画面と同じ緑の地面（見た目だけの背景装飾で、当たり判定は持たない）。
    // カメラがやや見下ろす角度のため、深度を書き込むと落下中のブロックが
    // y=0を過ぎた瞬間に地面の奥へ隠れてしまう（画面外に出る前に消えて見える）。
    // それを避けるため、地面は深度バッファに書き込まない＝他のオブジェクトを
    // 一切隠さない背景扱いにし、ブロックは画面外に出るまで手前に描画され続ける
    const groundGeometry = new THREE.PlaneGeometry(120, 120);
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x5fae4a });
    groundMaterial.depthWrite = false;
    this.groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
    this.groundMesh.renderOrder = -1;
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.receiveShadow = true;
    this.scene.add(this.groundMesh);
  }

  // 壁の実寸が画面（の視野角）にちょうど収まるカメラ距離を、現在のアスペクト比から
  // 逆算する。スマホの縦画面のように横方向の視野が狭いときは横幅基準の距離が、
  // 横長画面では高さ基準の距離が効いてくる。
  // 24文字のときは基準距離(28m)が下限として効くので、従来の見え方のまま変わらない
  _applyCameraFraming() {
    const verticalFov = THREE.MathUtils.degToRad(CAMERA_FOV_DEG);
    const horizontalFov =
      2 * Math.atan(Math.tan(verticalFov / 2) * this.camera.aspect);

    const halfWidth = (this.wallWidth / 2) * CAMERA_FRAME_PADDING;
    const halfHeight = (this.wallHeight / 2) * CAMERA_FRAME_PADDING;
    const distance = Math.max(
      CAMERA_BASE_DISTANCE,
      halfWidth / Math.tan(horizontalFov / 2),
      halfHeight / Math.tan(verticalFov / 2)
    );

    const lookAt = new THREE.Vector3(
      0,
      BAR_TOP_Y + this.wallHeight / 2 - CAMERA_LOOK_BELOW_WALL_CENTER,
      0
    );
    this.camera.position
      .copy(lookAt)
      .addScaledVector(CAMERA_DIRECTION, distance);
    this.camera.lookAt(lookAt);

    const distanceScale = distance / CAMERA_BASE_DISTANCE;
    this.scene.fog.near = FOG_NEAR * distanceScale;
    this.scene.fog.far = FOG_FAR * distanceScale;
  }

  _setupPhysics() {
    this.physicsWorld = new PhysicsWorld();
    this.material = this.physicsWorld.defaultMaterial;

    // ステージには地面が無く、棒から落ちたブロックはどこまでも落ちていく。
    // 物理ボディを無限に走らせ続けないよう、画面に映らない高さに回収用の床を敷き、
    // ここへ着いたブロックを破棄する
    const floorBody = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Plane(),
      material: this.material,
    });
    floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    floorBody.position.set(0, FLOOR_Y, 0);
    floorBody.addEventListener('collide', (event) => {
      this.landedBodies.add(event.body);
    });
    this.physicsWorld.addBody(floorBody);
  }

  // 棒の長さは壁の幅ぴったりにする。短いと端のブロックが棒に乗らず開始直後に
  // 落ちてしまい、長いと端に何も乗っていない余りが見えてしまう
  _setupBar() {
    this.bar = new Bar(this.physicsWorld, this.material, this.wallWidth);
    this.scene.add(this.bar.mesh);
  }

  // 空中に浮いた棒の上にメールブロックの壁を積む。
  // 壁そのものの組み方（行・列）は床に積んでいた頃と同じで、
  // 積み始める高さが棒の上面になった点だけが違う
  _setupWall() {
    this.rows.forEach((rowChars, row) => {
      rowChars.forEach((character, col) => {
        this._spawnBlock(character, row, col);
      });
    });
  }

  // 壁に積む行（文字の配列の配列）を作る。「1文字=1ブロック」の組み方を
  // ここ1箇所に集約し、メール本文が渡されなかった場合（遊び方からゲームへ
  // 直行した場合など）もランダムな文面を同じ手順で行分解する。
  _buildRows() {
    const primary = this._splitIntoRows(this.mailText ?? '');
    // 空白だけの入力でブロックが0個になると開始直後にゲームが終わってしまうため、
    // 行が1つも残らなければランダム文面に退避する
    return primary.rows.length > 0
      ? primary
      : this._splitIntoRows(getRandomEmailText());
  }

  // 行の組み方をここ1箇所に集約している。
  //
  // - メール本文中の改行はそのまま新しい行の区切りとして扱う
  // - 改行のない長い行は自動で折り返す。折り返し幅は総文字数の平方根から決め、
  //   MAX_ROWS を超えて積み上がりそうなときは行を増やさず折り返し幅を広げる
  // - 行内のスペース（全角含む）はブロックにしても意味がないため取り除く
  // - サロゲートペア（絵文字など）を割らないよう Array.from で分割する
  // - 全行を折り返し幅と同じ列数に揃え、足りない行は右側を空白ブロック
  //   （文字なしのBlock）で埋める。行ごとに実際の文字数で中央寄せすると、
  //   短い行の上に長い行が乗ったときに支えのないオーバーハングができて
  //   自重で崩れてしまうため、必ず全行同じ列数・左詰めで配置する
  // - MAX_MAIL_BLOCKS を超える入力は先頭から切り詰める（空白ブロックは数えない）
  _splitIntoRows(text) {
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
        const chunk = lineChars
          .slice(start, start + wrapWidth)
          .slice(0, remaining);
        rows.push(chunk);
        remaining -= chunk.length;
      }
    }

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
    // 行の並びは本文の先頭から順（row=0が最初の行）だが、壁は下から積み上がる
    // 構造のため、そのままだと最初の行が最下段になり、上から下に読むと文章が
    // 逆順になってしまう。段の高さを反転させて、最初の行が一番上に来るようにする
    const y =
      BAR_TOP_Y +
      BLOCK_HEIGHT / 2 +
      (this.rows.length - 1 - row) * BLOCK_HEIGHT;
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
    ball.body.addEventListener('collide', (event) => {
      if (event.body.isBlock) soundManager.play('impact');
    });
    this.scene.add(ball.mesh);
    this.activeBall = ball;
    this.activeBallAge = 0;
    soundManager.play('launch');
  }

  _isBallAtRest(ball, age) {
    const speed = ball.body.velocity.length();
    const fellOffStage = ball.body.position.y < BALL_DESPAWN_Y;
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
    this.fallingBlocks.forEach((block) => block.syncMeshToBody());
    if (this.activeBall) this.activeBall.syncMeshToBody();

    this._resolveFallenBlocks();
    this._resolveLandedBlocks();
    this._resolveActiveBall(deltaSeconds);
    this._checkGameOver();

    this.renderer.render(this.scene, this.camera);
  }

  // 棒より下へ落ちたブロックを見つけて加点する。ブロックは壊れないので、
  // 得点手段はこの「落とす」だけ。加点したブロックは fallingBlocks へ移し、
  // 二重に数えないようにする
  _resolveFallenBlocks() {
    const remaining = [];
    this.blocks.forEach((block) => {
      if (block.body.position.y < SCORE_FALL_Y) {
        this.score += SCORE_PER_BLOCK;
        this.hud.setScore(this.score);
        this.fallingBlocks.push(block);
        // 実際に画面外の回収床へ着地するまで待つと数秒かかり体感が遅いため、
        // 棒から落ちた時点を起点に一定時間後の「着地したはず」のタイミングで鳴らす
        setTimeout(() => soundManager.play('land'), LAND_SOUND_DELAY_MS);
      } else {
        remaining.push(block);
      }
    });

    // 落ち着いた壁はcannon-esのスリープに入っていて、下のブロックが落ちても
    // 目を覚まさず宙に浮いたままになる。落ちたぶんだけ残りを起こして自然に崩落させる
    if (remaining.length !== this.blocks.length) {
      remaining.forEach((block) => block.body.wakeUp());
    }

    this.blocks = remaining;
  }

  // 回収用の床まで落ちたブロックを破棄する。床のcollideイベントが主で、
  // 先に落ちたブロックの上に着地してしまった場合に備えて高さでも拾う
  _resolveLandedBlocks() {
    if (this.fallingBlocks.length === 0) return;

    this.fallingBlocks = this.fallingBlocks.filter((block) => {
      const landed =
        this.landedBodies.has(block.body) ||
        block.body.position.y < FLOOR_LANDED_Y;
      if (!landed) return true;

      this.landedBodies.delete(block.body);
      this.scene.remove(block.mesh);
      block.dispose();
      return false;
    });
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
    // 落下中のブロックが残っているうちに結果画面へ飛ぶと、最後の一撃が
    // 落ちきる前に画面が切り替わってしまう。球と落下中のブロックが
    // 片付いてから終了する
    const settled = !this.activeBall && this.fallingBlocks.length === 0;
    const cleared = this.blocks.length === 0 && settled;
    const outOfAmmo = this.remainingBalls <= 0 && settled;
    if (cleared || outOfAmmo) {
      this.hasEnded = true;
      soundManager.play('gameover');
      this.onGameOver(this.score);
    }
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    // 画面回転などでアスペクト比が変わると壁が収まる距離も変わるため引き直す
    this._applyCameraFraming();
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
