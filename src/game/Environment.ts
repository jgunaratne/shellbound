import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { getTerrainHeight } from './Terrain';
import pineTreeUrl from '../assets/models/pine_tree.glb';
import treeUrl from '../assets/models/tree.glb';
import rockUrl from '../assets/models/rock.glb';
import mangoUrl from '../assets/models/mango.glb';

export type Collider = { x: number; z: number; radius: number };
type IndexedCollider = Collider & { _cellKey?: string };
type MangoObject = THREE.Object3D & { _collected?: boolean };
const ENVIRONMENT_SPREAD = 130;
const ROCK_COUNT = 60;
const TREE_COUNT = 300;
const MANGO_COUNT = 100;
const WATER_LEVEL = -1.9;
const TREE_CLEAR_RADIUS = 60;
const TALL_TREE_CHANCE = 0.2;
const COLLIDER_CELL_SIZE = 12;

export const colliders: Collider[] = [];
const colliderGrid = new Map<string, Set<IndexedCollider>>();

function getColliderCell(value: number): number {
  return Math.floor(value / COLLIDER_CELL_SIZE);
}

function getColliderCellKey(x: number, z: number): string {
  return `${getColliderCell(x)},${getColliderCell(z)}`;
}

function insertColliderIntoGrid(collider: IndexedCollider) {
  const key = getColliderCellKey(collider.x, collider.z);
  let cell = colliderGrid.get(key);
  if (!cell) {
    cell = new Set<IndexedCollider>();
    colliderGrid.set(key, cell);
  }

  cell.add(collider);
  collider._cellKey = key;
}

function removeColliderFromGrid(collider: IndexedCollider) {
  if (!collider._cellKey) {
    return;
  }

  const cell = colliderGrid.get(collider._cellKey);
  if (!cell) {
    collider._cellKey = undefined;
    return;
  }

  cell.delete(collider);
  if (cell.size === 0) {
    colliderGrid.delete(collider._cellKey);
  }
  collider._cellKey = undefined;
}

export function registerCollider(collider: Collider) {
  const indexedCollider = collider as IndexedCollider;
  colliders.push(collider);
  insertColliderIntoGrid(indexedCollider);
}

export function updateCollider(collider: Collider, x: number, z: number) {
  const indexedCollider = collider as IndexedCollider;
  const nextCellKey = getColliderCellKey(x, z);

  if (indexedCollider._cellKey !== nextCellKey) {
    removeColliderFromGrid(indexedCollider);
    collider.x = x;
    collider.z = z;
    insertColliderIntoGrid(indexedCollider);
    return;
  }

  collider.x = x;
  collider.z = z;
}

export function queryNearbyColliders(x: number, z: number, radius: number): Collider[] {
  const minCellX = getColliderCell(x - radius);
  const maxCellX = getColliderCell(x + radius);
  const minCellZ = getColliderCell(z - radius);
  const maxCellZ = getColliderCell(z + radius);
  const nearby: Collider[] = [];

  for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
    for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
      const cell = colliderGrid.get(`${cellX},${cellZ}`);
      if (!cell) {
        continue;
      }

      for (const collider of cell) {
        nearby.push(collider);
      }
    }
  }

  return nearby;
}

function createSeededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

export function populateEnvironment(target: THREE.Object3D) {
  mangos.length = 0; // Reset on remount / HMR
  const random = createSeededRandom(42);
  const loader = new GLTFLoader();

  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
  loader.setDRACOLoader(dracoLoader);

  Promise.all([
    loader.loadAsync(pineTreeUrl),
    loader.loadAsync(treeUrl),
    loader.loadAsync(rockUrl),
    loader.loadAsync(mangoUrl),
  ])
    .then(([pineTree, tree, rock, mango]) => {
      // Normalise both tree models to a consistent height (~10 units).
      const normalizeTreeModel = (scene: THREE.Object3D): THREE.Object3D => {
        const bbox = new THREE.Box3().setFromObject(scene);
        const height = bbox.max.y - bbox.min.y;
        const TARGET_HEIGHT = 10;
        if (height > 0 && Math.abs(height - TARGET_HEIGHT) > 0.5) {
          const normScale = TARGET_HEIGHT / height;
          scene.scale.multiplyScalar(normScale);
          scene.updateMatrixWorld(true);
          const adjusted = new THREE.Box3().setFromObject(scene);
          scene.position.y -= adjusted.min.y;
          const container = new THREE.Group();
          container.add(scene);
          return container;
        }
        return scene;
      };

      const treeModels = [
        normalizeTreeModel(pineTree.scene),
        normalizeTreeModel(tree.scene),
      ];
      const baseRock = rock.scene;
      const baseMango = mango.scene;

      enableShadows([...treeModels, baseRock, baseMango]);
      scatterRocks(target, baseRock, random);
      scatterTrees(target, treeModels, random);

      mangos.length = 0; // Clear exactly before scattering to defeat any duplicate async race conditions
      cachedBaseMango = baseMango;
      cachedTarget = target;
      scatterMangos(target, baseMango, random);

      console.log('Trees, rocks, and mangos loaded and scattered');
    })
    .catch((error) => {
      console.error('Failed to load GLB assets:', error);
    });
}

function enableShadows(models: THREE.Object3D[]) {
  for (const model of models) {
    model.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) {
        return;
      }

      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
  }
}

function scatterRocks(
  target: THREE.Object3D,
  baseRock: THREE.Object3D,
  random: () => number,
) {
  for (let i = 0; i < ROCK_COUNT; i++) {
    const x = randomWorldCoordinate(random);
    const z = randomWorldCoordinate(random);
    const terrainY = getTerrainHeight(x, z);

    if (terrainY < WATER_LEVEL) {
      continue;
    }

    const rock = baseRock.clone();
    const scale = 0.4 + random() * 1.2;
    rock.position.set(x, terrainY - scale * 0.8, z);
    rock.scale.setScalar(scale);
    rock.rotation.y = random() * Math.PI * 2;

    registerCollider({ x, z, radius: scale * 0.8 });
    target.add(rock);
  }
}

function scatterTrees(
  target: THREE.Object3D,
  treeModels: THREE.Object3D[],
  random: () => number,
) {
  for (let i = 0; i < TREE_COUNT; i++) {
    const x = randomWorldCoordinate(random);
    const z = randomWorldCoordinate(random);

    if (Math.hypot(x, z) < TREE_CLEAR_RADIUS) {
      continue;
    }

    const terrainY = getTerrainHeight(x, z);
    if (terrainY < WATER_LEVEL) {
      continue;
    }

    const tree = treeModels[Math.floor(random() * treeModels.length)].clone();
    const scale = getTreeScale(random);
    tree.position.set(x, terrainY - 1.8 * scale, z);
    tree.scale.setScalar(scale);
    tree.rotation.y = random() * Math.PI * 2;

    registerCollider({ x, z, radius: 0.4 * scale });
    target.add(tree);
  }
}

export const mangos: MangoObject[] = [];

// Cached for respawning
let cachedBaseMango: THREE.Object3D | null = null;
let cachedTarget: THREE.Object3D | null = null;
let respawnSeed = 100;

export function respawnMangos() {
  if (!cachedBaseMango || !cachedTarget) return;

  // Remove any leftover mango meshes
  for (const m of mangos) {
    if (m.parent) m.parent.remove(m);
  }
  mangos.length = 0;

  // Re-scatter with a different seed each round
  respawnSeed += 1;
  const random = createSeededRandom(respawnSeed);
  scatterMangos(cachedTarget, cachedBaseMango, random);
}

export function collectMango(index: number, scene: THREE.Scene): boolean {
  const mango = mangos[index];
  if (!mango || mango._collected) return false;
  mango._collected = true;

  mango.visible = false;
  mango.traverse((child) => {
    child.visible = false;
  });

  if (mango.parent) {
    mango.parent.remove(mango);
  } else {
    scene.remove(mango);
  }

  mangos.splice(index, 1);
  return true;
}

function scatterMangos(
  target: THREE.Object3D,
  baseMango: THREE.Object3D,
  random: () => number,
) {
  const PLAYER_R = 2.0; // must match Player's PLAYER_RADIUS
  for (let i = 0; i < MANGO_COUNT; i++) {
    const x = randomWorldCoordinate(random);
    const z = randomWorldCoordinate(random);

    const terrainY = getTerrainHeight(x, z);
    if (terrainY < WATER_LEVEL) {
      continue;
    }

    // Skip positions inside or too close to tree/rock colliders — the player's
    // collision resolution would push them away before the pickup check runs.
    const nearby = queryNearbyColliders(x, z, PLAYER_R + 4);
    let blocked = false;
    for (const c of nearby) {
      if (Math.hypot(x - c.x, z - c.z) < c.radius + PLAYER_R + 1.0) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;

    const mango = baseMango.clone() as MangoObject;
    const scale = 0.3 + random() * 0.3;
    mango.position.set(x, terrainY + 0.3, z);
    mango.scale.setScalar(scale);
    mango.rotation.y = random() * Math.PI * 2;
    mango.rotation.x = (random() - 0.5) * 0.5;
    mango.rotation.z = (random() - 0.5) * 0.5;

    target.add(mango);
    mangos.push(mango);
  }
}

function randomWorldCoordinate(random: () => number): number {
  return (random() - 0.5) * ENVIRONMENT_SPREAD * 2;
}

function getTreeScale(random: () => number): number {
  if (random() < TALL_TREE_CHANCE) {
    return 2.5 + random() * 2.0;
  }

  return 0.6 + random() * 1.4;
}
