import * as THREE from 'three';
import { getTerrainHeight } from './terrain';
import grassTexUrl from '../assets/grass.png';

/**
 * High-performance GPU-Instanced 3D Grass System
 * - Uses InstancedMesh for thousands of blades in minimal draw calls
 * - Procedural vertex shader wind animation based on world position + time
 * - Uses the grass tile texture for natural coloring
 * - Fake AO: base vertices are darker, tips are brighter
 */
export class InstancedGrass {
  public mesh: THREE.InstancedMesh;

  constructor(count = 25000) {
    const bladeWidth = 0.015;

    // 7 blades per cluster, each with a different short height
    const bladeHeights = [0.08, 0.12, 0.18, 0.22, 0.25, 0.15, 0.10];
    const bladeAngles = [0, 0.9, 1.8, 2.7, 0.45, 1.35, 2.25];
    const maxHeight = 0.25; // for AO normalization

    const positions: number[] = [];
    const uvs: number[] = [];
    const ao: number[] = [];

    for (let b = 0; b < bladeHeights.length; b++) {
      const h = bladeHeights[b];
      const geo = new THREE.PlaneGeometry(bladeWidth, h, 1, 3);
      geo.translate(0, h / 2, 0); // pin base at Y=0
      // Small random offset from cluster center so blades don't overlap exactly
      const offsetX = Math.sin(b * 2.3) * 0.08;
      const offsetZ = Math.cos(b * 2.3) * 0.08;
      geo.translate(offsetX, 0, offsetZ);
      geo.rotateY(bladeAngles[b]);

      const posArr = geo.attributes.position.array;
      const uvArr = geo.attributes.uv.array;
      for (let i = 0; i < posArr.length; i++) positions.push(posArr[i]);
      for (let i = 0; i < uvArr.length; i++) uvs.push(uvArr[i]);
      for (let i = 0; i < posArr.length; i += 3) {
        const y = posArr[i + 1];
        ao.push(Math.max(0.3, y / maxHeight));
      }
    }

    const clusterGeo = new THREE.BufferGeometry();
    clusterGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    clusterGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    clusterGeo.setAttribute('aAO', new THREE.Float32BufferAttribute(ao, 1));
    clusterGeo.computeVertexNormals();

    // Load grass tile texture for natural coloring
    const tex = new THREE.TextureLoader().load(grassTexUrl);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;

    const material = new THREE.MeshLambertMaterial({
      map: tex,
      color: new THREE.Color(0.65, 0.82, 0.45), // slight green tint to match terrain grass
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      alphaTest: 0.01,
    });

    // Inject custom wind animation, AO, world-UV sampling, and distance fade
    // into Three.js's built-in lighting/shadow pipeline
    material.onBeforeCompile = (shader) => {
      // Add custom uniforms
      shader.uniforms.uTime = { value: 0 };

      // ── Vertex shader modifications ──
      // Declare attribute + varyings before main()
      shader.vertexShader = shader.vertexShader.replace(
        'void main() {',
        `
        attribute float aAO;
        uniform float uTime;
        varying float vAO;
        varying vec2 vWorldUv;
        varying float vDist;
        void main() {
        `
      );

      // Inject wind displacement + varyings after #include <begin_vertex>
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>

        vAO = aAO;

        // Compute world position for wind + world UV
        vec4 grassWorldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWorldUv = grassWorldPos.xz * 0.0667; // match terrain TILE_REPEAT (20/300)

        // Camera distance for fade
        vec4 grassViewPos = viewMatrix * grassWorldPos;
        vDist = -grassViewPos.z;

        // GPU wind displacement
        float windStrength = position.y / ${maxHeight.toFixed(1)};
        windStrength *= windStrength;
        float wave1 = sin(grassWorldPos.x * 0.7 + grassWorldPos.z * 0.3 + uTime * 1.8) * 0.12;
        float wave2 = sin(grassWorldPos.x * 0.3 + grassWorldPos.z * 0.9 + uTime * 2.4) * 0.06;
        transformed.x += (wave1 + wave2) * windStrength;
        transformed.z += wave2 * windStrength;
        `
      );

      // ── Fragment shader modifications ──
      // Declare varyings before main()
      shader.fragmentShader = shader.fragmentShader.replace(
        'void main() {',
        `
        varying float vAO;
        varying vec2 vWorldUv;
        varying float vDist;
        void main() {
        `
      );

      // After diffuse color is sampled, override with world-UV sampling + AO + fade
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `
        // Sample grass texture using world-space UVs instead of mesh UVs
        vec4 texelColor = texture2D( map, vWorldUv );
        texelColor = sRGBTransferEOTF( texelColor );
        diffuseColor *= texelColor;

        // Apply AO: base of blade is slightly darker
        diffuseColor.rgb *= mix(0.7, 1.1, vAO);

        // Distance fade
        float grassFade = 1.0 - smoothstep(30.0, 80.0, vDist);
        if (grassFade < 0.01) discard;
        diffuseColor.a *= grassFade;
        `
      );

      // Store shader ref for uniform updates
      (material as any)._grassShader = shader;
    };

    // Create the InstancedMesh
    this.mesh = new THREE.InstancedMesh(clusterGeo, material, count);
    this.mesh.name = 'instanced_grass';
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;

    // Scatter across terrain using Perlin noise as a density map for natural patchy distribution
    const dummy = new THREE.Object3D();
    const SPREAD = 130;
    let placed = 0;

    // Simple inline noise for density mapping
    const densityNoise = (x: number, z: number): number => {
      const hash = (px: number, pz: number) => {
        const n = Math.sin(px * 127.1 + pz * 311.7) * 43758.5453123;
        return n - Math.floor(n);
      };
      const smooth = (px: number, pz: number) => {
        const ix = Math.floor(px), iz = Math.floor(pz);
        const fx = px - ix, fz = pz - iz;
        const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
        return (hash(ix, iz) * (1 - ux) + hash(ix + 1, iz) * ux) * (1 - uz)
             + (hash(ix, iz + 1) * (1 - ux) + hash(ix + 1, iz + 1) * ux) * uz;
      };
      // Low frequency for big patches, higher octave for ragged edges
      return smooth(x * 0.025, z * 0.025) * 0.7
           + smooth(x * 0.06, z * 0.06) * 0.3;
    };

    for (let attempt = 0; attempt < count * 5 && placed < count; attempt++) {
      const x = (Math.random() - 0.5) * SPREAD * 2;
      const z = (Math.random() - 0.5) * SPREAD * 2;
      const y = getTerrainHeight(x, z);

      // Skip lake basin
      if (y < -1.9) continue;

      // Skip very close to spawn
      const dist = Math.sqrt(x * x + z * z);
      if (dist < 15) continue;

      // Lower threshold: grass grows in broader patches (density > 0.3)
      const density = densityNoise(x, z);
      if (density < 0.3) continue;

      // Within a patch, denser areas are more likely to get grass
      const patchStrength = (density - 0.3) / 0.7;
      if (Math.random() > patchStrength * 2.0) continue;

      dummy.position.set(x, y, z);
      dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);

      // Taller grass in the densest parts of each patch
      const scale = (0.7 + patchStrength * 1.5) * (0.85 + Math.random() * 0.3);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(placed, dummy.matrix);
      placed++;
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.count = placed;
  }

  public update(time: number) {
    const mat = this.mesh.material as any;
    if (mat._grassShader?.uniforms) {
      mat._grassShader.uniforms.uTime.value = time;
    }
  }
}
