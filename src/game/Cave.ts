import * as THREE from 'three';

export const CAVE_SPAWN = new THREE.Vector3(0, 4.5, 0);
export const CAVE_BOUNDS = {
  minX: -16,
  maxX: 16,
  minZ: -18,
  maxZ: 18,
};

const CAVE_RADIUS = 22;
const CAVE_HEIGHT = 18;

function createRockGeometry(radius: number, height: number) {
  const geometry = new THREE.DodecahedronGeometry(radius, 0);
  const position = geometry.attributes.position as THREE.BufferAttribute;

  for (let i = 0; i < position.count; i++) {
    const scale = 0.82 + Math.sin(i * 1.7) * 0.08 + Math.cos(i * 0.9) * 0.06;
    position.setXYZ(
      i,
      position.getX(i) * scale,
      position.getY(i) * (height / radius) * scale,
      position.getZ(i) * scale,
    );
  }

  geometry.computeVertexNormals();
  return geometry;
}

function createRockMaterial(color: number) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.96,
    metalness: 0.02,
    flatShading: true,
  });
}

export function createCaveScene(floorY: number): THREE.Group {
  const cave = new THREE.Group();
  cave.name = 'cave_world';

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(CAVE_RADIUS, 32),
    new THREE.MeshStandardMaterial({
      color: 0x4a4033,
      roughness: 1,
      metalness: 0.02,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = floorY - 0.02;
  floor.receiveShadow = true;
  cave.add(floor);

  const wallMaterial = createRockMaterial(0x2d2926);
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(CAVE_RADIUS, CAVE_RADIUS + 2, CAVE_HEIGHT, 18, 5, true),
    wallMaterial,
  );
  wall.position.y = floorY + CAVE_HEIGHT * 0.5 - 1;
  wall.castShadow = true;
  wall.receiveShadow = true;
  cave.add(wall);

  const ceiling = new THREE.Mesh(
    new THREE.SphereGeometry(CAVE_RADIUS * 0.92, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2.2),
    createRockMaterial(0x221f1b),
  );
  ceiling.position.y = floorY + CAVE_HEIGHT - 2;
  ceiling.scale.y = 0.65;
  ceiling.castShadow = true;
  ceiling.receiveShadow = true;
  cave.add(ceiling);

  const stalagmiteGeometry = createRockGeometry(1.4, 4.8);
  const stalactiteGeometry = createRockGeometry(1.2, 5.2);
  const accentMaterial = createRockMaterial(0x615347);
  const count = 12;

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const radius = 13 + (i % 3) * 2.3;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;

    const groundRock = new THREE.Mesh(stalagmiteGeometry, accentMaterial);
    groundRock.position.set(x, floorY + 1.4, z);
    groundRock.rotation.y = angle * 0.7;
    groundRock.scale.setScalar(0.8 + (i % 4) * 0.18);
    groundRock.castShadow = true;
    groundRock.receiveShadow = true;
    cave.add(groundRock);

    const ceilingRock = new THREE.Mesh(stalactiteGeometry, wallMaterial);
    ceilingRock.position.set(x * 0.75, floorY + CAVE_HEIGHT - 2.4, z * 0.75);
    ceilingRock.rotation.set(Math.PI, angle * 0.5, 0);
    ceilingRock.scale.setScalar(0.65 + (i % 5) * 0.12);
    ceilingRock.castShadow = true;
    ceilingRock.receiveShadow = true;
    cave.add(ceilingRock);
  }

  const emberGeometry = new THREE.SphereGeometry(0.45, 12, 12);
  const emberMaterial = new THREE.MeshStandardMaterial({
    color: 0xffa14a,
    emissive: 0xff7a1a,
    emissiveIntensity: 1.8,
    roughness: 0.6,
  });
  const emberOffsets = [
    new THREE.Vector3(-4, floorY + 0.4, -3),
    new THREE.Vector3(-2.6, floorY + 0.3, -1.8),
    new THREE.Vector3(-3.2, floorY + 0.25, -4.6),
  ];

  for (const offset of emberOffsets) {
    const ember = new THREE.Mesh(emberGeometry, emberMaterial);
    ember.position.copy(offset);
    cave.add(ember);
  }

  cave.visible = false;
  return cave;
}
