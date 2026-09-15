import * as THREE from 'three';

const DURATION_SECONDS = 0.3;
// 爆風半径に対する初期の大きさ。ここから爆風半径いっぱいまで膨らむ
const START_RADIUS_RATIO = 0.15;
const START_OPACITY = 0.8;
const COLOR = 0xffb45a;

// 爆弾が爆発したことを示す一瞬の光。半透明の球を爆心に出し、膨らみながら
// 薄くなって消える。物理には一切関与しない、見た目だけの演出。
//
// 爆風はブロックを直接壊さない仕様なので、これが無いと「なぜかブロックが
// 少し動いた」だけに見えてしまう。爆発が起きたことを伝えるのが役割
export class ExplosionEffect {
  constructor(scene) {
    this.scene = scene;
    // 短い間隔で複数の爆発が起こりうるので、再生中のものを配列で持つ
    this.bursts = [];
    // ジオメトリは全ての爆発で使い回し、大きさはメッシュのscaleで変える
    this.geometry = new THREE.SphereGeometry(1, 16, 12);
  }

  // position: x/y/zを持つもの（cannon-esのVec3をそのまま渡せる）
  // radius: 膨らみきったときの半径。GameScene側の爆風半径と揃える
  spawnAt(position, radius) {
    // 透過の重なり方が爆発ごとに独立するよう、マテリアルは1回ぶんずつ作る
    const material = new THREE.MeshBasicMaterial({
      color: COLOR,
      transparent: true,
      opacity: START_OPACITY,
      // 半透明の球で奥のブロックが欠けないようにする
      depthWrite: false,
    });

    const mesh = new THREE.Mesh(this.geometry, material);
    mesh.position.set(position.x, position.y, position.z);
    mesh.scale.setScalar(radius * START_RADIUS_RATIO);
    this.scene.add(mesh);

    this.bursts.push({ mesh, material, radius, age: 0 });
  }

  update(deltaSeconds) {
    if (this.bursts.length === 0) return;

    this.bursts = this.bursts.filter((burst) => {
      burst.age += deltaSeconds;
      const progress = burst.age / DURATION_SECONDS;
      if (progress >= 1) {
        this._disposeBurst(burst);
        return false;
      }

      const scaleRatio =
        START_RADIUS_RATIO + (1 - START_RADIUS_RATIO) * progress;
      burst.mesh.scale.setScalar(burst.radius * scaleRatio);
      burst.material.opacity = START_OPACITY * (1 - progress);
      return true;
    });
  }

  dispose() {
    this.bursts.forEach((burst) => this._disposeBurst(burst));
    this.bursts = [];
    this.geometry.dispose();
  }

  _disposeBurst(burst) {
    this.scene.remove(burst.mesh);
    burst.material.dispose();
  }
}
