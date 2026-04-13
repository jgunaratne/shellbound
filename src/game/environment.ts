import * as THREE from 'three';
import { getTerrainHeight } from './terrain';

const rng = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
};

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import pineTreeUrl from '../assets/pine_tree.glb';
import treeUrl from '../assets/tree.glb';
import rockUrl from '../assets/rock.glb';

// Simple 2D circular collision registry to prevent clipping through static objects
export const colliders: { x: number; z: number; radius: number }[] = [];

export function populateEnvironment(scene: THREE.Scene) {
  const rand = rng(42);
  const SPREAD = 130;

  // Load high-quality assets asynchronously
  const loader = new GLTFLoader();
  
  Promise.all([
    new Promise<any>((resolve, reject) => loader.load(pineTreeUrl, resolve, undefined, reject)),
    new Promise<any>((resolve, reject) => loader.load(treeUrl, resolve, undefined, reject)),
    new Promise<any>((resolve, reject) => loader.load(rockUrl, resolve, undefined, reject))
  ]).then(([pineGltf, normalGltf, rockGltf]) => {
    const treeModels = [pineGltf.scene, normalGltf.scene];
    const baseRock = rockGltf.scene;

    // Enable shadows on the base models
    [...treeModels, baseRock].forEach(model => {
      model.traverse((child: any) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
    });

    // Scatter 60 high-quality rocks
    for (let i = 0; i < 60; i++) {
      const x = (rand() - 0.5) * SPREAD * 2;
      const z = (rand() - 0.5) * SPREAD * 2;
      
      const terrainY = getTerrainHeight(x, z);
      if (terrainY < -1.9) continue; // Do not spawn rocks in lakes
      
      const rock = baseRock.clone();
      const scale = 0.4 + rand() * 1.2;
      
      // Embed very deeply into the terrain to guarantee absolutely zero floating gaps on steep slopes
      rock.position.set(x, terrainY - scale * 1.8, z);
      rock.scale.setScalar(scale);
      rock.rotation.y = rand() * Math.PI * 2;
      
      colliders.push({ x, z, radius: scale * 0.8 });
      scene.add(rock);
    }

    // Scatter clones across the terrain for a beautiful dry forest
    for (let i = 0; i < 300; i++) {
      const x = (rand() - 0.5) * SPREAD * 2;
      const z = (rand() - 0.5) * SPREAD * 2;
      
      const dist = Math.sqrt(x * x + z * z);
      if (dist < 10) continue;
      
      const terrainY = getTerrainHeight(x, z);
      if (terrainY < -1.9) continue; // Do not spawn trees in lakes

      const baseTree = treeModels[Math.floor(rand() * treeModels.length)];
      const tree = baseTree.clone();
      
      const uniformScale = 0.6 + rand() * 1.4;
      
      const y = terrainY - 1.8 * uniformScale;
      tree.position.set(x, y, z);
      tree.scale.setScalar(uniformScale);
      
      tree.rotation.y = rand() * Math.PI * 2;
      
      colliders.push({ x, z, radius: 0.4 * uniformScale });
      scene.add(tree);
    }
    console.log('Trees and rocks loaded and scattered');
  }).catch(err => {
    console.error('Failed to load GLB assets:', err);
  });
}
