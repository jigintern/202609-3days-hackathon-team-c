import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PhysicsWorld } from './PhysicsWorld.js';
import { Ball } from './Ball.js';
import {
  BLOCK_SIZE,
  createBlockMaterials,
  createCharacterTexture,
} from './Block.js';
import { EMAIL_TEXTS } from '../data/emailTexts.js';
import { randomRange } from '../utils/helpers.js';

// 背景に降らせるダミー文字の種類数。文字テクスチャは1文字につき1枚
// （448x288 ≒ 0.5MB）キャッシュするため、種類が増えるほどメモリを食う。
// 背景のダミーなので語彙は絞ってよく、ここで上限を固定しておく
const DUMMY_CHAR_COUNT = 24;

// ゲーム本編で実際に壊すのと同じ語彙にするため、お祈りメールの文面から文字を拾う。
// 異なり文字は80種ほどあり、先頭から詰めると1通目の語彙だけに偏ってしまう。
// 全文面へ散るよう等間隔に間引く（結果は決定的なので起動ごとにブレない）
const DUMMY_CHARS = (() => {
  const unique = Array.from(
    new Set(Array.from(EMAIL_TEXTS.join('').replace(/\s+/g, '')))
  );
  if (unique.length <= DUMMY_CHAR_COUNT) return unique;
  const step = unique.length / DUMMY_CHAR_COUNT;
  return Array.from(
    { length: DUMMY_CHAR_COUNT },
    (_, index) => unique[Math.floor(index * step)]
  );
})();

const SPAWN_INTERVAL_BRICK = 0.8;
const SPAWN_INTERVAL_BALL = 2.2;
const MAX_BRICKS = 14;
const MAX_BALLS = 5;
const OUT_OF_BOUNDS_Y = -4;
const BALL_SPAWN_X = 10;
const OUT_OF_BOUNDS_XZ = BALL_SPAWN_X + 3;

// 台（ペデスタル）: ブロックを置くための低い横長の土台
const PEDESTAL_SIZE = new THREE.Vector3(9, 0.6, 4);
const PEDESTAL_TOP_Y = PEDESTAL_SIZE.y;
const BRICK_SPAWN_X_RANGE = [-3.5, 3.5];
const BRICK_SPAWN_Z_RANGE = [-1.5, 1.5];

// タイトル/メール入力画面の背景で、鉄球がブロックの山へ延々と飛び込み続ける
// アトラクトモード演出。ブロックの見た目（寸法・紙色の下地・文字の焼き込み方）は
// ゲーム画面と同じものをBlock.jsから借りており、画面が切り替わっても
// 同じブロックを見ている感覚が途切れないようにしている。
export class TitleBackground {
  constructor(canvas, renderer) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.bricks = [];
    this.balls = [];
    // 同じ文字のブロックでテクスチャを使い回すためのキャッシュ（文字 -> CanvasTexture）。
    // ブロック単位で破棄すると他のブロックの文字まで消えるため、unmount()でまとめて破棄する
    this.characterTextures = new Map();
  }

  mount() {
    this.canvas.style.display = 'block';

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8ecbf0);
    this.scene.fog = new THREE.Fog(0x8ecbf0, 20, 42);

    this.camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    this.camera.position.set(0, 7, 15);
    this.camera.lookAt(0, 1, 0);

    this.renderer.setSize(window.innerWidth, window.innerHeight);

    const ambient = new THREE.AmbientLight(0xffffff, 0.9);
    this.scene.add(ambient);

    const directional = new THREE.DirectionalLight(0xfff3d6, 1.1);
    directional.position.set(6, 14, 8);
    this.scene.add(directional);

    // 芝生（地面）
    const grassGeometry = new THREE.PlaneGeometry(30, 24);
    const grassMaterial = new THREE.MeshStandardMaterial({ color: 0x5fae4a });
    this.grassMesh = new THREE.Mesh(grassGeometry, grassMaterial);
    this.grassMesh.rotation.x = -Math.PI / 2;
    this.scene.add(this.grassMesh);

    // ブロックを置くための低い台
    const pedestalGeometry = new THREE.BoxGeometry(
      PEDESTAL_SIZE.x,
      PEDESTAL_SIZE.y,
      PEDESTAL_SIZE.z
    );
    const pedestalMaterial = new THREE.MeshStandardMaterial({
      color: 0xcac2ae,
    });
    this.pedestalMesh = new THREE.Mesh(pedestalGeometry, pedestalMaterial);
    this.pedestalMesh.position.set(0, PEDESTAL_SIZE.y / 2, 0);
    this.scene.add(this.pedestalMesh);

    this.physicsWorld = new PhysicsWorld();
    this.material = this.physicsWorld.defaultMaterial;

    const floorBody = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Plane(),
      material: this.material,
    });
    floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.physicsWorld.addBody(floorBody);

    const pedestalBody = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Box(
        new CANNON.Vec3(
          PEDESTAL_SIZE.x / 2,
          PEDESTAL_SIZE.y / 2,
          PEDESTAL_SIZE.z / 2
        )
      ),
      material: this.material,
    });
    pedestalBody.position.set(0, PEDESTAL_SIZE.y / 2, 0);
    this.physicsWorld.addBody(pedestalBody);

    this._brickTimer = SPAWN_INTERVAL_BRICK;
    this._ballTimer = SPAWN_INTERVAL_BALL * 0.5;

    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);
  }

  unmount() {
    window.removeEventListener('resize', this._onResize);
    this.bricks.forEach((item) => this._disposeItem(item));
    this.balls.forEach((item) => this._disposeItem(item));
    this.bricks = [];
    this.balls = [];
    this.pedestalMesh.geometry.dispose();
    this.pedestalMesh.material.dispose();
    this.grassMesh.geometry.dispose();
    this.grassMesh.material.dispose();

    // ブロック間で共有している文字テクスチャはここでまとめて破棄する
    this.characterTextures.forEach((texture) => texture.dispose());
    this.characterTextures.clear();

    this.canvas.style.display = 'none';
  }

  update(deltaSeconds) {
    this._brickTimer += deltaSeconds;
    this._ballTimer += deltaSeconds;

    if (
      this._brickTimer >= SPAWN_INTERVAL_BRICK &&
      this.bricks.length < MAX_BRICKS
    ) {
      this._brickTimer = 0;
      this._spawnBrick();
    }
    if (
      this._ballTimer >= SPAWN_INTERVAL_BALL &&
      this.balls.length < MAX_BALLS
    ) {
      this._ballTimer = 0;
      this._spawnBall();
    }

    this.physicsWorld.step(deltaSeconds);

    this.bricks.forEach((item) => this._syncMesh(item));
    this.balls.forEach((item) => this._syncMesh(item));

    this._recycleOutOfBounds();

    this.renderer.render(this.scene, this.camera);
  }

  _spawnBrick() {
    const geometry = new THREE.BoxGeometry(
      BLOCK_SIZE.x,
      BLOCK_SIZE.y,
      BLOCK_SIZE.z
    );
    const char = DUMMY_CHARS[Math.floor(Math.random() * DUMMY_CHARS.length)];
    // 面の構成（手前と背面の2面に文字、残り4面は紙の断面色）もゲーム画面と共通
    const mesh = new THREE.Mesh(
      geometry,
      createBlockMaterials(this._getCharacterTexture(char))
    );

    const body = new CANNON.Body({
      mass: 1,
      shape: new CANNON.Box(
        new CANNON.Vec3(BLOCK_SIZE.x / 2, BLOCK_SIZE.y / 2, BLOCK_SIZE.z / 2)
      ),
      material: this.material,
    });
    body.position.set(
      randomRange(BRICK_SPAWN_X_RANGE[0], BRICK_SPAWN_X_RANGE[1]),
      randomRange(9, 13),
      randomRange(BRICK_SPAWN_Z_RANGE[0], BRICK_SPAWN_Z_RANGE[1])
    );
    body.angularVelocity.set(
      randomRange(-3, 3),
      randomRange(-3, 3),
      randomRange(-3, 3)
    );
    this.physicsWorld.addBody(body);
    this.scene.add(mesh);

    this.bricks.push({ mesh, body });
  }

  // 同じ文字は同じテクスチャを使い回す。背景のブロックは画面外へ落ちるたびに
  // 作り直されるので、キャッシュしないと同じ文字を何度も描き直すことになる
  _getCharacterTexture(character) {
    let texture = this.characterTextures.get(character);
    if (!texture) {
      texture = createCharacterTexture(character);
      this.characterTextures.set(character, texture);
    }
    return texture;
  }

  _spawnBall() {
    const fromLeft = Math.random() < 0.5;
    const ball = new Ball(this.physicsWorld, this.material);
    const originX = fromLeft ? -BALL_SPAWN_X : BALL_SPAWN_X;
    ball.spawnAt(new THREE.Vector3(originX, randomRange(2, 5), randomRange(-2, 2)));

    const direction = new THREE.Vector3(
      fromLeft ? 1 : -1,
      randomRange(0.05, 0.2),
      randomRange(-0.15, 0.15)
    ).normalize();
    ball.launch(direction, randomRange(45, 70));

    this.scene.add(ball.mesh);
    this.balls.push(ball);
  }

  _syncMesh(item) {
    if (typeof item.syncMeshToBody === 'function') {
      item.syncMeshToBody();
    } else {
      item.mesh.position.copy(item.body.position);
      item.mesh.quaternion.copy(item.body.quaternion);
    }
  }

  _recycleOutOfBounds() {
    this.bricks = this._filterOutOfBounds(this.bricks);
    this.balls = this._filterOutOfBounds(this.balls);
  }

  _filterOutOfBounds(items) {
    const survivors = [];
    items.forEach((item) => {
      const { x, y, z } = item.body.position;
      const outOfBounds =
        y < OUT_OF_BOUNDS_Y ||
        Math.abs(x) > OUT_OF_BOUNDS_XZ ||
        Math.abs(z) > OUT_OF_BOUNDS_XZ;
      if (outOfBounds) {
        this._disposeItem(item);
      } else {
        survivors.push(item);
      }
    });
    return survivors;
  }

  _disposeItem(item) {
    this.scene.remove(item.mesh);
    if (typeof item.dispose === 'function') {
      item.dispose();
    } else {
      this.physicsWorld.removeBody(item.body);
      item.mesh.geometry.dispose();
      const materials = Array.isArray(item.mesh.material)
        ? item.mesh.material
        : [item.mesh.material];
      // 側面は同じマテリアルを4面に使い回しているのでSetで重複を除いてから破棄する。
      // 文字テクスチャは他のブロックと共有しているためここでは破棄しない
      // （unmount()でまとめて破棄する）
      new Set(materials).forEach((material) => material.dispose());
    }
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
