import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getTerrainHeight } from './Terrain';
import pineTreeUrl from '../assets/models/pine_tree.glb';
import treeUrl from '../assets/models/tree.glb';
import rockUrl from '../assets/models/rock.glb';
import mangoUrl from '../assets/models/mango.glb';

export type Collider = { x: number; z: number; radius: number };
type IndexedCollider = Collider & { _cellKey?: string };
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

export function populateEnvironment(scene: THREE.Scene) {
  const random = createSeededRandom(42);
  const loader = new GLTFLoader();

  Promise.all([
    loader.loadAsync(pineTreeUrl),
    loader.loadAsync(treeUrl),
    loader.loadAsync(rockUrl),
    loader.loadAsync(mangoUrl),
  ])
    .then(([pineTree, tree, rock, mango]) => {
      const treeModels = [pineTree.scene, tree.scene];
      const baseRock = rock.scene;
      const baseMango = mango.scene;

      enableShadows([...treeModels, baseRock, baseMango]);
      scatterRocks(scene, baseRock, random);
      scatterTrees(scene, treeModels, random);
      scatterMangos(scene, baseMango, random);

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
  scene: THREE.Scene,
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
    rock.position.set(x, terrainY - scale * 1.8, z);
    rock.scale.setScalar(scale);
    rock.rotation.y = random() * Math.PI * 2;

    registerCollider({ x, z, radius: scale * 0.8 });
    scene.add(rock);
  }
}

function scatterTrees(
  scene: THREE.Scene,
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
    scene.add(tree);
  }
}

function scatterMangos(
  scene: THREE.Scene,
  baseMango: THREE.Object3D,
  random: () => number,
) {
  for (let i = 0; i < MANGO_COUNT; i++) {
    const x = randomWorldCoordinate(random);
    const z = randomWorldCoordinate(random);

    const terrainY = getTerrainHeight(x, z);
    if (terrainY < WATER_LEVEL) {
      continue;
    }

    const mango = baseMango.clone();
    // Make mangos smaller
    const scale = 0.3 + random() * 0.3;
    // Raise them slightly above the terrain to sit neatly on the grass
    mango.position.set(x, terrainY + 0.3, z);
    mango.scale.setScalar(scale);
    mango.rotation.y = random() * Math.PI * 2;
    mango.rotation.x = (random() - 0.5) * 0.5;
    mango.rotation.z = (random() - 0.5) * 0.5;

    scene.add(mango);
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
