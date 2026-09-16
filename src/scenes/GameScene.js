import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PhysicsWorld } from '../game/PhysicsWorld.js';
import { Ball, MAX_LAUNCH_SPEED } from '../game/Ball.js';
import { Block, createCharacterTexture } from '../game/Block.js';
import { Bar, BAR_TOP_Y, BAR_Y } from '../game/Bar.js';
import { AimController } from '../game/AimController.js';
import { TrajectoryPreview } from '../game/TrajectoryPreview.js';
import { ExplosionEffect } from '../game/ExplosionEffect.js';
import { HUD } from '../ui/HUD.js';
import { getRandomEmailText } from '../data/emailTexts.js';
import { soundManager } from '../audio/SoundManager.js';
import { clamp } from '../utils/helpers.js';

const TOTAL_BALLS = 8;
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
// この高さより下に落ちたら「棒から落ちた（粉砕された）」とみなす。
// 棒の上で横滑りしただけのブロックを誤って数えないよう、棒より1m下に置いてある
const CRUSH_FALL_Y = BAR_Y - 1;
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

// 本文中にこれらの語が含まれていたら、その文字のブロックを爆弾にする。
// 語を増やすときはここへ足すだけでよい。1文字だけの語も指定できる。
//
// 落選を告げるメールの定型句から、読み手が「あっ」と思う語を選んである。
// 単漢字ではなく語で持たせているのは、「抽選」「見送」のように隣り合う
// ブロックがまとまって赤くなったほうが、何が爆弾なのかを目で読み取れるため。
// 「結果」のようにそれ自体は中立な語は、手がかりが薄れるので入れていない。
//
// 語どうしは範囲が重なってよい。検出はフラグを立てるだけなので、
// 「選」と「抽選」の両方に当たっても二重には効かない。重ねて持つ意味は
// あって、たとえば「抽」が爆弾になるのは「抽選」と続いたときだけになる
const BOMB_WORDS = [
  // 抽選・チケット系
  '抽選',
  '当選',
  '落選',
  '外れ',
  '用意',
  '希望',
  // 選考・就活系
  '選考',
  '不採用',
  '見送',
  '内定',
  '残念',
  '期待',
  '厳正',
  '慎重',
  '検討',
  // 単体でも落選を連想させる字
  '縁',
  '祈',
  '選',
  '残',
];

// 爆弾が爆発したときの爆風。半径内の動的なボディを外向きに押すだけで、
// ブロックを壊しはしない（このゲームにブロックが壊れる仕組みは無い）。
// ブロックの質量は1.5なので、中心の力積30はおよそ20m/sの初速にあたる。
//
// 力積は爆心からの距離に応じて線形に弱まり、半径の外ではゼロになる。
// つまり RADIUS は「どこまで巻き込むか」、IMPULSE は「どれだけ飛ばすか」で、
// 見た目を変えたいときはこの2つを動かす
const EXPLOSION_RADIUS = 6.0;
const EXPLOSION_IMPULSE = 30;

// 衝撃に合わせてカメラを揺らす量（m）と、揺れが収まるまでの時間（秒）。
// 揺れはカメラごとの平行移動なので、この振幅がそのまま画面上の移動量になる。
// 基準距離(28m)では画面に高さ約26mぶんが映るので、2.6mは画面高の約10%にあたる。
// 文字数が多くてカメラが引いているときは cameraDistanceScale を掛けて、
// 画面上の見かけの揺れ幅を揃える
const EXPLOSION_SHAKE_AMPLITUDE = 2.6;
const EXPLOSION_SHAKE_DURATION = 0.45;

// 球がブロックへ命中したときの揺れ。爆発の半分の強さ・短めの時間にして、
// 当たった手応えは出しつつ爆発の一撃とは区別する。
// 揺らすのは1投につき一度だけ。球はブロックのあいだで何度も跳ねるため、
// 当たるたびに揺らすと揺れっぱなしになってブロックのメール本文が読めなくなる
const HIT_SHAKE_AMPLITUDE = 1.3;
const HIT_SHAKE_DURATION = 0.3;
// これ未満の衝突は「かすった」だけとみなし、1投ぶんの揺れを使わない（m/s）
const HIT_SHAKE_MIN_SPEED = 8;

// 揺れに混ぜる画面の傾き。平行移動だけより一撃が硬く感じられる。
// これは EXPLOSION_SHAKE_AMPLITUDE の揺れでの最大値で、弱い揺れでは比例して小さくなる。
// 角度なのでカメラ距離には依らない（cameraDistanceScale を掛けない）
const SHAKE_MAX_ROLL = THREE.MathUtils.degToRad(2);


// メインのゲームプレイ画面。three.jsの描画とcannon-esの物理更新、
// 狙い/発射/落下判定をひとつにまとめる
export class GameScene {
  constructor({ canvas, renderer, overlayRoot, onGameOver }) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.overlayRoot = overlayRoot;
    this.onGameOver = onGameOver;

    this.remainingBalls = TOTAL_BALLS;
    // まだ棒の上に残っているブロック
    this.blocks = [];
    // 棒から落ちたが、まだ床に着いていない落下中のブロック
    this.fallingBlocks = [];
    this.activeBall = null;
    this.hasEnded = false;
    // カメラを引いた比。_applyCameraFraming()が実際の値を入れる
    this.cameraDistanceScale = 1;
    // カメラの揺れの状態。cameraShakeTime が cameraShakeDuration 以上なら揺れていない。
    // 実際の値は _shakeCamera() が入れる
    this.cameraShakeTime = 0;
    this.cameraShakeDuration = 0;
    this.cameraShakeAmplitude = 0;
    // 揺れているあいだの注視点を組み立てる作業用。毎フレーム生成しないよう使い回す
    this.shakeLookAt = new THREE.Vector3();
    // MailInputScene経由で渡された文章。未設定(null)ならランダム文面にフォールバックする
    this.mailText = null;
    // 同じ文字のブロックでテクスチャを使い回すためのキャッシュ（文字 -> CanvasTexture）。
    // ブロック単位で破棄すると他のブロックの文字まで消えるため、unmount()でまとめて破棄する
    this.characterTextures = new Map();
  }

  // MailInputScene.onStartGame(mailText) から main.js を通じて渡される入力文字列を受け取る。
  // mount()より前に呼ばれる想定（結果を渡すsetterをmount前に呼ぶのは他の画面も同じ作法）
  setMailText(mailText) {
    this.mailText = mailText;
  }

  mount() {
    this.hasEnded = false;
    this.remainingBalls = TOTAL_BALLS;
    this.cameraShakeTime = 0;
    this.cameraShakeDuration = 0;
    this.cameraShakeAmplitude = 0;
    this.blocks = [];
    this.fallingBlocks = [];
    this.activeBall = null;
    this.characterTextures = new Map();
    // 回収用の床に着いたボディの置き場。床のcollideイベントから積まれ、
    // 毎フレームの _resolveLandedBlocks() で消化する
    this.landedBodies = new Set();
    // 粉砕済み（棒から落ちた）文字の、元のメール本文でのインデックス集合。
    // リザルト画面へそのまま渡し、本文のどこを粉砕したかを表示する
    this.crushedIndices = new Set();

    this.canvas.style.display = 'block';

    // 行構成は棒の長さ・カメラ距離・壁のグリッドの全てに効くので、ここで一度だけ
    // 確定させて使い回す（_buildRowsはランダム文面へのフォールバックを含み、
    // 呼ぶたびに結果が変わり得るため二重に呼ばない）。
    // 各行は同じ幅に揃え、足りない分は空白ブロックで埋めてあるので、
    // どの段にも必ず下の支えがある
    const { rows, positions, wrapWidth } = this._buildRows();
    this.rows = rows;
    this.blockPositions = positions;
    this.maxCols = wrapWidth;
    this.wallWidth = this.maxCols * BLOCK_WIDTH;
    this.wallHeight = this.rows.length * BLOCK_HEIGHT;

    this._setupThree();
    this._setupPhysics();
    this._setupBar();
    this._setupWall();

    this.hud = new HUD(this.overlayRoot);
    this.hud.show();
    this.hud.setRemainingBalls(this.remainingBalls);

    this.aimController = new AimController(
      this.canvas,
      this.camera,
      LAUNCH_ORIGIN,
      (direction, power) => this._launchBall(direction, power)
    );
    this.trajectoryPreview = new TrajectoryPreview(this.scene);
    this.trajectoryPreview.setCameraDistanceScale(this.cameraDistanceScale);
    // 衝撃波の輪をカメラへ正対させるため、カメラを渡す（_setupThree()で生成済み）
    this.explosionEffect = new ExplosionEffect(this.scene, this.camera);

    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);
  }

  unmount() {
    window.removeEventListener('resize', this._onResize);
    this.aimController.dispose();
    this.trajectoryPreview.dispose();
    this.explosionEffect.dispose();
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

    // 揺れはこの位置からのずれとして毎フレーム作り直すので、素の姿勢を覚えておく
    this.cameraBasePosition = this.camera.position.clone();
    this.cameraLookAt = lookAt.clone();

    const distanceScale = distance / CAMERA_BASE_DISTANCE;
    this.scene.fog.near = FOG_NEAR * distanceScale;
    this.scene.fog.far = FOG_FAR * distanceScale;

    // 予測線のドットもカメラが引いたぶん小さくなるので、同じ比で大きくして
    // 見かけの大きさを保つ。mount()中は生成前に呼ばれるので値も覚えておく
    this.cameraDistanceScale = distanceScale;
    this.trajectoryPreview?.setCameraDistanceScale(distanceScale);
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
    const bombFlags = this._markBombs(this.rows);
    this.rows.forEach((rowChars, row) => {
      rowChars.forEach((character, col) => {
        this._spawnBlock(
          character,
          row,
          col,
          bombFlags[row][col],
          this.blockPositions[row][col]
        );
      });
    });
  }

  // どの位置のブロックを爆弾にするかを、rowsと同じ形のboolean配列で返す。
  //
  // 行に分割し終えた文字を平坦に並べ直してから語を探している。こうすると
  // 元の本文で間にスペースが入っていた場合（空白は行分割の時点で除去済み）も、
  // 折り返しや改行で語が行をまたいだ場合も、同じように拾える。
  // 行をまたいだときは離れた位置の2ブロックがそれぞれ爆弾になる。
  //
  // 結合した文字列に対する indexOf ではなく要素単位で比較しているのは、
  // サロゲートペア（絵文字など）で文字列上の位置と要素の添字がずれるため。
  // 右端を埋めている空白ブロック('')は語の一部にならないので探索から外す
  _markBombs(rows) {
    const flat = rows.flat();
    const flags = flat.map(() => false);

    const chars = [];
    const flatIndexes = [];
    flat.forEach((character, index) => {
      if (character.length === 0) return;
      chars.push(character);
      flatIndexes.push(index);
    });

    BOMB_WORDS.forEach((word) => {
      const wordChars = Array.from(word);
      if (wordChars.length === 0) return;
      for (let i = 0; i + wordChars.length <= chars.length; i += 1) {
        if (!wordChars.every((char, k) => chars[i + k] === char)) continue;
        wordChars.forEach((_, k) => {
          flags[flatIndexes[i + k]] = true;
        });
        i += wordChars.length - 1;
      }
    });

    let cursor = 0;
    return rows.map((row) => row.map(() => flags[cursor++]));
  }

  // 壁に積む行（文字の配列の配列）を作る。「1文字=1ブロック」の組み方を
  // ここ1箇所に集約し、メール本文が渡されなかった場合（遊び方からゲームへ
  // 直行した場合など）もランダムな文面を同じ手順で行分解する。
  //
  // 実際に壁として採用した文面（入力 or ランダムのフォールバック）を
  // resolvedMailText / totalCrushableChars として控えておく。リザルト画面で
  // 「本文のどこを粉砕したか」を復元するには、積んだブロックの元になった
  // 文面そのものが要る
  _buildRows() {
    const source = this.mailText ?? '';
    const primary = this._splitIntoRows(source);
    // 空白だけの入力でブロックが0個になると開始直後にゲームが終わってしまうため、
    // 行が1つも残らなければランダム文面に退避する
    if (primary.rows.length > 0) {
      this.resolvedMailText = source;
      this.totalCrushableChars = this._countCrushableChars(primary.positions);
      return primary;
    }
    const fallback = getRandomEmailText();
    const fallbackRows = this._splitIntoRows(fallback);
    this.resolvedMailText = fallback;
    this.totalCrushableChars = this._countCrushableChars(fallbackRows.positions);
    return fallbackRows;
  }

  // positions（rowsと同じ形の、元の本文でのインデックスかnullの配列）のうち、
  // 実際にブロックになった（=nullではない）ものの数を数える
  _countCrushableChars(positions) {
    return positions.reduce(
      (sum, row) => sum + row.filter((index) => index !== null).length,
      0
    );
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
  //
  // 各文字には元のtext（Array.from基準）でのインデックスを持たせ、rowsと
  // 同じ形のpositionsとして返す。空白パディングのぶんはnullになる。
  // リザルト画面で本文を復元するには「空白除去後の配列でのインデックス」ではなく
  // 「元のtextでの位置」が要るため、改行・空白を読み飛ばす間もインデックスは
  // 元のtext基準のまま進める
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

    const fullChars = Array.from(text);
    const lines = [];
    let currentLine = [];
    for (let i = 0; i < fullChars.length; ) {
      const character = fullChars[i];
      if (character === '\r' || character === '\n') {
        lines.push(currentLine);
        currentLine = [];
        // \r\n はまとめて1つの改行として扱う（textの分割規則を\r|\n|\r\nに揃える）
        i += character === '\r' && fullChars[i + 1] === '\n' ? 2 : 1;
        continue;
      }
      if (/\s/.test(character)) {
        i += 1;
        continue;
      }
      currentLine.push({ character, index: i });
      i += 1;
    }
    lines.push(currentLine);

    const rows = [];
    const positions = [];
    let remaining = MAX_MAIL_BLOCKS;

    outer: for (const line of lines) {
      for (let start = 0; start < line.length; start += wrapWidth) {
        if (remaining <= 0) break outer;
        const chunk = line.slice(start, start + wrapWidth).slice(0, remaining);
        rows.push(chunk.map((cell) => cell.character));
        positions.push(chunk.map((cell) => cell.index));
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
    const paddedPositions = positions.map((row) => {
      const padded = row.slice();
      while (padded.length < wrapWidth) {
        padded.push(null);
      }
      return padded;
    });

    return { rows: paddedRows, positions: paddedPositions, wrapWidth };
  }

  // 同じ文字は同じテクスチャを使い回す。ブロック数ぶん毎回描き直す必要はなく、
  // 「の」「ご」のように頻出する文字ほど効く
  _getCharacterTexture(character, isBomb) {
    // 同じ文字でも爆弾かどうかで配色が違う。文字だけをキーにすると、
    // 先に作られた方の色がもう一方にも使い回されてしまうので種別を混ぜる
    const key = `${isBomb ? 'bomb' : 'normal'}:${character}`;
    let texture = this.characterTextures.get(key);
    if (!texture) {
      texture = createCharacterTexture(character, { isBomb });
      this.characterTextures.set(key, texture);
    }
    return texture;
  }

  _spawnBlock(character, row, col, isBomb, sourceIndex) {
    const block = new Block(
      this.physicsWorld,
      this.material,
      this._getCharacterTexture(character, isBomb),
      { isBomb, sourceIndex }
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
    // この投擲でもう揺らしたか。1投=1回に絞るためのフラグ
    let hasShakenOnHit = false;
    ball.body.addEventListener('collide', (event) => {
      if (!event.body.isBlock) return;
      soundManager.play('impact');

      if (hasShakenOnHit) return;
      // めり込む向きの相対速度。かすっただけの接触ではこれが小さくなるので、
      // 手応えのある最初の一撃だけを拾える
      const impactSpeed = Math.abs(
        event.contact?.getImpactVelocityAlongNormal() ?? 0
      );
      if (impactSpeed < HIT_SHAKE_MIN_SPEED) return;
      hasShakenOnHit = true;

      // 最大速度で当たれば HIT_SHAKE_AMPLITUDE、弱い当たりはそのぶん控えめに
      const strength = clamp(impactSpeed / MAX_LAUNCH_SPEED, 0, 1);
      this._shakeCamera(HIT_SHAKE_AMPLITUDE * strength, HIT_SHAKE_DURATION);
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

    this._resolveBombs();
    this._resolveFallenBlocks();
    this._resolveLandedBlocks();
    this._resolveActiveBall(deltaSeconds);
    this.explosionEffect.update(deltaSeconds);
    this._updateCameraShake(deltaSeconds);
    this._checkGameOver();

    this.renderer.render(this.scene, this.camera);
  }

  // 棒から取り除かれた（落ちた／爆発した）ブロックの元の文字位置を記録する。
  // 行を揃えるための空白パディングのブロックはsourceIndexを持たないので、
  // ここには入らない＝粉砕数に数えない
  _markCrushed(block) {
    if (block.sourceIndex !== null) {
      this.crushedIndices.add(block.sourceIndex);
    }
  }

  // 球が当たった爆弾を爆発させる。爆弾自身はその場で消え、棒から落ちたときと
  // 同じように扱う。ブロックが壊れる仕組みは無いので、爆風は周囲のブロックを
  // 棒から吹き飛ばして落とすことで効いてくる
  _resolveBombs() {
    const remaining = [];
    const origins = [];

    this.blocks.forEach((block) => {
      if (!block.hitByBall) {
        remaining.push(block);
        return;
      }
      origins.push(block.body.position.clone());
      this._markCrushed(block);
      this.scene.remove(block.mesh);
      block.dispose();
    });

    if (origins.length === 0) return;

    this.blocks = remaining;
    // 爆風は爆弾を取り除いたあとに当てる。自分自身を吹き飛ばそうとしないため
    origins.forEach((origin) => this._explode(origin));
  }

  // 棒より下へ落ちたブロックを見つけて fallingBlocks へ移す。ブロックは壊れないので、
  // 「落とす」ことだけが棒から取り除く手段。二重に数えないよう、移した後は
  // blocks 側から除く
  _resolveFallenBlocks() {
    const remaining = [];
    this.blocks.forEach((block) => {
      if (block.body.position.y < CRUSH_FALL_Y) {
        this._markCrushed(block);
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

  // 爆心から半径内にある動的なボディ（ブロックと、飛んでいる球の両方）を
  // 外向きに吹き飛ばす。力は距離に応じて線形に弱まり、外周でゼロになる。
  // 間に何があるかは見ていない（遮蔽判定は入れていない）。
  //
  // 爆弾の引き金は球との衝突だけなので、この爆風が他の爆弾を誘爆させることはない。
  // ただし爆風で弾かれた球が別の爆弾に当たれば、そちらは普通に爆発する
  _explode(origin) {
    this.explosionEffect.spawnAt(origin, EXPLOSION_RADIUS);
    // 同時に複数が爆発しても揺れは重ねず、最初から振り直す
    this._shakeCamera(EXPLOSION_SHAKE_AMPLITUDE, EXPLOSION_SHAKE_DURATION);

    const targets = [...this.blocks, this.activeBall].filter(Boolean);

    targets.forEach((target) => {
      const { body } = target;
      const offset = new CANNON.Vec3(
        body.position.x - origin.x,
        body.position.y - origin.y,
        body.position.z - origin.z
      );
      const distance = offset.length();
      if (distance > EXPLOSION_RADIUS) return;

      // 爆心とまったく同じ位置にいると向きが決まらないので、その時だけ真上へ逃がす
      const direction =
        distance > 1e-4 ? offset.scale(1 / distance) : new CANNON.Vec3(0, 1, 0);
      const strength = EXPLOSION_IMPULSE * (1 - distance / EXPLOSION_RADIUS);

      // スリープ中のブロックは力を加えても起きないので先に起こす
      body.wakeUp();
      body.applyImpulse(direction.scale(strength));
    });
  }

  // 揺れを起こす。すでに揺れている最中なら、その瞬間の残り振幅と比べて
  // 強いほうを採る。命中と同時に爆弾が起爆したとき、弱い命中の揺れで
  // 爆発の一撃が上書きされてしまうのを防ぐため
  _shakeCamera(amplitude, durationSeconds) {
    if (amplitude <= this._currentShakeAmplitude()) return;

    this.cameraShakeTime = 0;
    this.cameraShakeDuration = durationSeconds;
    this.cameraShakeAmplitude = amplitude;
  }

  // 減衰を織り込んだ、いまこの瞬間の揺れ幅（m）。揺れていなければ0
  _currentShakeAmplitude() {
    if (this.cameraShakeTime >= this.cameraShakeDuration) return 0;

    const progress = this.cameraShakeTime / this.cameraShakeDuration;
    // 残り時間の2乗で減衰させて「一撃が強く、すぐ収まる」形にする。
    // progressが1になったフレームで0になり、素の位置へぴたりと戻る
    return this.cameraShakeAmplitude * (1 - progress) ** 2;
  }

  // 衝撃をカメラの揺れで伝える。周波数の違う2つの振動を縦横に当て、
  // さらに周期の違う傾きを重ねて一撃を硬くする。
  //
  // 大事なのはカメラと注視点を「同じだけ」ずらす点。位置だけ動かして注視点を
  // 固定すると、注視点と同じ奥行きにある壁は画面上でほとんど動かず（壁の端が
  // わずかに流れるだけで）、揺れがほとんど伝わらない。見せたいのは壁が画面内で
  // 揺れる絵なので、カメラごと平行移動させる
  _updateCameraShake(deltaSeconds) {
    if (this.cameraShakeTime >= this.cameraShakeDuration) return;

    this.cameraShakeTime += deltaSeconds;
    const shake = this._currentShakeAmplitude();
    const amplitude = shake * this.cameraDistanceScale;

    const time = this.cameraShakeTime;
    const offsetX = Math.sin(time * 54) * amplitude;
    const offsetY = Math.sin(time * 43 + 1.7) * amplitude * 0.8;

    this.camera.position.copy(this.cameraBasePosition);
    this.camera.position.x += offsetX;
    this.camera.position.y += offsetY;

    this.shakeLookAt.copy(this.cameraLookAt);
    this.shakeLookAt.x += offsetX;
    this.shakeLookAt.y += offsetY;
    this.camera.lookAt(this.shakeLookAt);

    // lookAt() が姿勢を作り直した後に、視線を軸として画面を傾ける
    const rollRatio = Math.min(1, shake / EXPLOSION_SHAKE_AMPLITUDE);
    this.camera.rotateZ(Math.sin(time * 31 + 0.8) * SHAKE_MAX_ROLL * rollRatio);
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
      // リザルト画面の背景に「球を撃ち切った直後のゲーム画面」をそのまま
      // 使うため、シーンが破棄される前にここでスナップショットを撮る。
      // rendererにpreserveDrawingBufferを立てていないため、直前の描画から
      // 時間が経つとバッファが失われている恐れがある。撮る直前にもう一度
      // 描画しておくことで、このタイミングの見た目を確実に残す
      this.renderer.render(this.scene, this.camera);
      const backgroundImage = this.canvas.toDataURL('image/jpeg', 0.85);
      this.onGameOver({
        mailText: this.resolvedMailText,
        crushedIndices: this.crushedIndices,
        totalCrushableChars: this.totalCrushableChars,
        backgroundImage,
      });
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
