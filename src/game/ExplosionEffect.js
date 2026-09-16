import * as THREE from 'three';

// 爆発を構成する各レイヤーの寿命（秒）。閃光→火球→衝撃波→火の粉→煙と
// 時間差で減衰させることで、一瞬の光ではなく「爆発が起きて収まる」流れに見せる
const FLASH_DURATION = 0.16;
const FIREBALL_DURATION = 0.42;
const SHOCKWAVE_DURATION = 0.45;
const SPARK_DURATION = 0.85;
const SMOKE_DURATION = 1.1;

// 火の粉の数。多くすると派手になるが、爆発1回ぶんのPointsは1つなので描画負荷は増えない
const SPARK_COUNT = 28;
// 火の粉にかかる重力と空気抵抗。重力だけだと真下へ素直に落ちて花火のように見えるため、
// 抵抗で初速を早めに殺し、爆風で吹き飛んだ紙片らしい動きにしている
const SPARK_GRAVITY = 16;
const SPARK_DRAG_PER_SECOND = 1.8;

// 煙の塊の数。1つずつ別方向へゆっくり広がりながら上がる
const SMOKE_PUFF_COUNT = 5;

// 炎の配色。芯は白熱色、外側ほど赤く沈む
const FLASH_COLOR = 0xfff6d8;
const FIRE_HOT_COLOR = 0xffd98a;
const FIRE_COOL_COLOR = 0xff4d1a;
const SHOCKWAVE_COLOR = 0xfff0c2;
const SMOKE_COLOR = 0x7d6e63;

// 火の粉に貼る、中心が明るい丸のテクスチャ。四角いままだと点が板に見えてしまう
function createSparkTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2
  );
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,205,120,0.95)');
  gradient.addColorStop(1, 'rgba(255,90,20,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// 単位球面上のランダムな向き。極に偏らないよう、高さを一様に取ってから円周へ広げる
function randomDirection() {
  const y = Math.random() * 2 - 1;
  const theta = Math.random() * Math.PI * 2;
  const r = Math.sqrt(1 - y * y);
  return new THREE.Vector3(r * Math.cos(theta), y, r * Math.sin(theta));
}

// 爆弾が爆発したことを示す演出。爆心に閃光・火球・衝撃波の輪・火の粉・煙を
// 重ねて出す。物理には一切関与しない、見た目だけの演出。
//
// 爆風はブロックを直接壊さない仕様なので、これが無いと「なぜかブロックが
// 少し動いた」だけに見えてしまう。爆発が起きたことを伝えるのが役割
export class ExplosionEffect {
  // camera: 衝撃波の輪を常にカメラへ正対させる（ビルボード）ために使う。
  // 渡さない場合は輪の向きは初期姿勢のまま
  constructor(scene, camera = null) {
    this.scene = scene;
    this.camera = camera;
    // 短い間隔で複数の爆発が起こりうるので、再生中のものを配列で持つ
    this.bursts = [];
    // ジオメトリは全ての爆発で使い回し、大きさはメッシュのscaleで変える
    this.sphereGeometry = new THREE.SphereGeometry(1, 16, 12);
    this.ringGeometry = new THREE.RingGeometry(0.76, 1, 48);
    this.sparkTexture = createSparkTexture();
  }

  // position: x/y/zを持つもの（cannon-esのVec3をそのまま渡せる）
  // radius: 演出全体の基準になる大きさ。GameScene側の爆風半径と揃える
  spawnAt(position, radius) {
    const origin = new THREE.Vector3(position.x, position.y, position.z);
    // レイヤーごとに寿命が違うので、短いものから順に消えていく
    const parts = [
      this._createFlash(origin, radius),
      this._createFireball(origin, radius),
      this._createShockwave(origin, radius),
      this._createSparks(origin, radius),
      ...this._createSmoke(origin, radius),
    ];
    this.bursts.push({ parts, age: 0 });
  }

  update(deltaSeconds) {
    if (this.bursts.length === 0) return;

    this.bursts = this.bursts.filter((burst) => {
      burst.age += deltaSeconds;
      burst.parts = burst.parts.filter((part) => {
        if (part.update(burst.age, deltaSeconds)) return true;
        this._disposePart(part);
        return false;
      });
      // 全レイヤーが寿命を迎えたら、その爆発ごと畳む
      return burst.parts.length > 0;
    });
  }

  dispose() {
    this.bursts.forEach((burst) =>
      burst.parts.forEach((part) => this._disposePart(part))
    );
    this.bursts = [];
    this.sphereGeometry.dispose();
    this.ringGeometry.dispose();
    this.sparkTexture.dispose();
  }

  // 爆発の瞬間だけ強く光る芯。加算合成で、背景より確実に明るく抜ける
  _createFlash(origin, radius) {
    const material = new THREE.MeshBasicMaterial({
      color: FLASH_COLOR,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(this.sphereGeometry, material);
    mesh.position.copy(origin);
    this.scene.add(mesh);

    return {
      object: mesh,
      material,
      update: (age) => {
        const progress = age / FLASH_DURATION;
        if (progress >= 1) return false;
        // 立ち上がりを一気に、消えぎわを速く。sqrtとp^2でその非対称を作る
        mesh.scale.setScalar(radius * 0.55 * (0.3 + 0.7 * Math.sqrt(progress)));
        material.opacity = 1 - progress * progress;
        return true;
      },
    };
  }

  // 爆風半径いっぱいまで膨らむ火の玉。白熱色から赤へ落としながら薄くなる
  _createFireball(origin, radius) {
    const material = new THREE.MeshBasicMaterial({
      color: FIRE_HOT_COLOR,
      transparent: true,
      opacity: 0.95,
      // 半透明の球で奥のブロックが欠けないようにする
      depthWrite: false,
    });
    const hot = new THREE.Color(FIRE_HOT_COLOR);
    const cool = new THREE.Color(FIRE_COOL_COLOR);

    const mesh = new THREE.Mesh(this.sphereGeometry, material);
    mesh.position.copy(origin);
    mesh.scale.setScalar(radius * 0.15);
    this.scene.add(mesh);

    return {
      object: mesh,
      material,
      update: (age) => {
        const progress = age / FIREBALL_DURATION;
        if (progress >= 1) return false;
        // 膨らみは最初が速く、終盤は止まりぎみ（ease-out）
        const eased = 1 - (1 - progress) ** 3;
        mesh.scale.setScalar(radius * (0.15 + 0.85 * eased));
        material.color.copy(hot).lerp(cool, progress);
        material.opacity = 0.95 * (1 - progress) ** 1.5;
        return true;
      },
    };
  }

  // 外へ走り抜ける衝撃波の輪。爆風がどこまで届いたかが目で追えるようにする
  _createShockwave(origin, radius) {
    const material = new THREE.MeshBasicMaterial({
      color: SHOCKWAVE_COLOR,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(this.ringGeometry, material);
    mesh.position.copy(origin);
    if (this.camera) mesh.quaternion.copy(this.camera.quaternion);
    this.scene.add(mesh);

    return {
      object: mesh,
      material,
      update: (age) => {
        const progress = age / SHOCKWAVE_DURATION;
        if (progress >= 1) return false;
        // カメラが動いても輪が横を向かないよう、毎フレーム正対させ直す
        if (this.camera) mesh.quaternion.copy(this.camera.quaternion);
        const eased = 1 - (1 - progress) ** 2;
        mesh.scale.setScalar(radius * (0.2 + 1.5 * eased));
        material.opacity = 0.9 * (1 - progress) ** 2;
        return true;
      },
    };
  }

  // 四散する火の粉。位置は毎フレームCPU側で積分してattributeへ書き戻す
  _createSparks(origin, radius) {
    const positions = new Float32Array(SPARK_COUNT * 3);
    const velocities = [];

    for (let i = 0; i < SPARK_COUNT; i += 1) {
      const direction = randomDirection();
      // 真横だけでなく上へも散らしたいので、上向き成分を少し足す
      direction.y += 0.35;
      direction.normalize();
      const speed = radius * (1.4 + Math.random() * 2.2);
      velocities.push(direction.clone().multiplyScalar(speed));
      // 全部が同じ1点から出ると噴水に見えるため、初期位置も少しばらす
      const offset = direction.clone().multiplyScalar(radius * 0.12);
      positions[i * 3] = origin.x + offset.x;
      positions[i * 3 + 1] = origin.y + offset.y;
      positions[i * 3 + 2] = origin.z + offset.z;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positions, 3)
    );

    const material = new THREE.PointsMaterial({
      size: radius * 0.3,
      map: this.sparkTexture,
      color: FIRE_HOT_COLOR,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geometry, material);
    this.scene.add(points);

    return {
      object: points,
      material,
      geometry,
      update: (age, deltaSeconds) => {
        const progress = age / SPARK_DURATION;
        if (progress >= 1) return false;

        const drag = Math.max(0, 1 - SPARK_DRAG_PER_SECOND * deltaSeconds);
        for (let i = 0; i < SPARK_COUNT; i += 1) {
          const velocity = velocities[i];
          velocity.y -= SPARK_GRAVITY * deltaSeconds;
          velocity.multiplyScalar(drag);
          positions[i * 3] += velocity.x * deltaSeconds;
          positions[i * 3 + 1] += velocity.y * deltaSeconds;
          positions[i * 3 + 2] += velocity.z * deltaSeconds;
        }
        geometry.attributes.position.needsUpdate = true;

        // 飛び始めは明るいまま、後半で急に冷めて消える
        material.opacity = Math.min(1, (1 - progress) * 2.2);
        material.size = radius * 0.3 * (1 - progress * 0.6);
        return true;
      },
    };
  }

  // 後に残る煙。火が消えたあとも少し漂わせて、爆発の余韻を作る
  _createSmoke(origin, radius) {
    return Array.from({ length: SMOKE_PUFF_COUNT }, () => {
      const material = new THREE.MeshBasicMaterial({
        color: SMOKE_COLOR,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(this.sphereGeometry, material);
      mesh.position.copy(origin);
      this.scene.add(mesh);

      const direction = randomDirection();
      const spread = radius * (0.3 + Math.random() * 0.5);
      const rise = radius * (0.4 + Math.random() * 0.5);
      // 塊ごとに出るタイミングをずらし、ひと塊が分裂したように見せる
      const delay = Math.random() * 0.12;
      const maxScale = radius * (0.3 + Math.random() * 0.3);
      const peakOpacity = 0.32 + Math.random() * 0.12;

      return {
        object: mesh,
        material,
        update: (age) => {
          const progress = (age - delay) / SMOKE_DURATION;
          if (progress >= 1) return false;
          if (progress < 0) return true;

          const eased = 1 - (1 - progress) ** 2;
          mesh.position.set(
            origin.x + direction.x * spread * eased,
            origin.y + direction.y * spread * eased + rise * eased,
            origin.z + direction.z * spread * eased
          );
          mesh.scale.setScalar(maxScale * (0.25 + 0.75 * eased));
          // 立ち上がりで濃くなり、そのあと時間をかけて薄れる
          material.opacity =
            peakOpacity * Math.min(1, progress * 5) * (1 - progress) ** 1.2;
          return true;
        },
      };
    });
  }

  _disposePart(part) {
    this.scene.remove(part.object);
    part.material.dispose();
    // 共有ジオメトリ（球・輪）は消さない。火の粉のように自前で持つものだけ破棄する
    part.geometry?.dispose();
  }
}
