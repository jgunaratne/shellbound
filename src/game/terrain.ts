import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import grassUrl from '../assets/grass.png';

/* ─── Classic 2D Perlin noise ─────────────────────────────────────── */

// Seeded permutation table (doubled to avoid index wrapping)
const _p: number[] = [];
{
  const base = [
    151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,
    69,142,8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,
    252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,
    171,168,68,175,74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,
    122,60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,65,25,
    63,161,1,216,80,73,209,76,132,187,208,89,18,169,200,196,135,130,116,
    188,159,86,164,100,109,198,173,186,3,64,52,217,226,250,124,123,5,202,
    38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,
    42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,
    43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,
    218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,
    145,235,249,14,239,107,49,192,214,31,181,199,106,157,184,84,204,176,
    115,121,50,45,127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,
    141,128,195,78,66,215,61,156,180
  ];
  for (let i = 0; i < 512; i++) _p[i] = base[i & 255];
}

/** Fade curve  6t⁵ − 15t⁴ + 10t³ */
function _fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Gradient dot product — 4 gradient directions */
function _grad(hash: number, x: number, y: number): number {
  const h = hash & 3;
  const u = h < 2 ? x : y;
  const v = h < 2 ? y : x;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

/** Classic 2D Perlin noise, returns value in roughly [-1, 1] */
function perlin2(x: number, y: number): number {
  const xi = Math.floor(x) & 255;
  const yi = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);

  const u = _fade(xf);
  const v = _fade(yf);

  const aa = _p[_p[xi] + yi];
  const ab = _p[_p[xi] + yi + 1];
  const ba = _p[_p[xi + 1] + yi];
  const bb = _p[_p[xi + 1] + yi + 1];

  const x1 = _lerp(_grad(aa, xf, yf), _grad(ba, xf - 1, yf), u);
  const x2 = _lerp(_grad(ab, xf, yf - 1), _grad(bb, xf - 1, yf - 1), u);

  return _lerp(x1, x2, v);
}

function _lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

/* ─── Fractal Brownian motion (multi-octave Perlin noise) ────────── */

/**
 * fBm — stacks multiple octaves of Perlin noise for natural terrain.
 * @param x        world x
 * @param y        world z (we call it y for the 2D function)
 * @param octaves  number of noise layers (5 gives a good balance)
 * @param lacunarity  frequency multiplier per octave
 * @param gain     amplitude multiplier per octave (persistence)
 */
function fbm(
  x: number, y: number,
  octaves = 5,
  lacunarity = 2.0,
  gain = 0.5
): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let maxAmp = 0;

  for (let i = 0; i < octaves; i++) {
    sum += perlin2(x * freq, y * freq) * amp;
    maxAmp += amp;
    amp *= gain;
    freq *= lacunarity;
  }

  return sum / maxAmp; // normalise to roughly [-1, 1]
}

/* ─── Public terrain height function ─────────────────────────────── */

/** Perlin-noise terrain height. Returns a value in roughly [-8, 12]. */
export function getTerrainHeight(x: number, z: number): number {
  const SCALE = 0.018;      // controls hill size (smaller = broader hills)
  const HEIGHT = 16;        // total peak-to-valley amplitude
  const OFFSET_X = 73.7;    // shift so origin isn't at a grid corner
  const OFFSET_Z = 149.3;

  // Primary rolling hills
  // Generate massive, natural Perlin-based rolling hills and deep valleys
  const base = fbm(x * SCALE + OFFSET_X, z * SCALE + OFFSET_Z, 5, 2.0, 0.5);
  let rawHeight = base * HEIGHT * 0.95;

  // Carve exactly ONE beautiful, dedicated mid-sized lake right in front of the player's starting view
  const distFromSingleLake = Math.sqrt(x * x + (z + 60) * (z + 60));
  const lakeBasin = 1.0 - THREE.MathUtils.smoothstep(distFromSingleLake, 0, 45);

  rawHeight -= lakeBasin * 10.0;

  // ── Coastal edge falloff: slope terrain below water near world borders ──
  // Distance from edge (0 at border, large in center)
  const HALF = 150; // half the terrain size
  const edgeDistX = HALF - Math.abs(x);
  const edgeDistZ = HALF - Math.abs(z);
  const edgeDist = Math.min(edgeDistX, edgeDistZ); // closest edge
  // smoothstep from 0→1 over the outermost 40 units
  const coastFade = THREE.MathUtils.smoothstep(edgeDist, 0, 40);
  // Push terrain deeply below water at the edge (-8 submerged)
  rawHeight = rawHeight * coastFade + (-8.0) * (1.0 - coastFade);

  // Prevent small puddles: clamp terrain above water level (-1.9) everywhere except the main lake AND coast
  if (lakeBasin < 0.01 && coastFade > 0.99) {
    rawHeight = Math.max(rawHeight, -1.5);
  }

  // Keep spawn completely level and dry
  const distFromCenter = Math.sqrt(x * x + z * z);
  const spawnFlatten = THREE.MathUtils.smoothstep(distFromCenter, 0, 20);
  const spawnElevation = 4.5 * (1.0 - spawnFlatten);

  return rawHeight * spawnFlatten + spawnElevation;
}



export function createTerrain(scene: THREE.Scene): THREE.Mesh {
  const SIZE = 300;
  const SEGS = 200;  // High segment count to capture Perlin noise detail

  const geometry = new THREE.PlaneGeometry(SIZE, SIZE, SEGS, SEGS);
  geometry.rotateX(-Math.PI / 2);

  const pos = geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, getTerrainHeight(x, z));
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();

  // Vertex-color the terrain by height + noise for natural variation
  const colors: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const pz = pos.getZ(i);
    const y = pos.getY(i);

    // Height-based gradient: low = darker green, high = lighter / golden
    const t = THREE.MathUtils.clamp((y + 4) / 16, 0, 1);

    // Small noise variation so adjacent vertices aren't uniformly colored
    const nv = perlin2(px * 0.12 + 50, pz * 0.12 + 50) * 0.08;

    const r = THREE.MathUtils.lerp(0.15, 0.68, t) + nv;
    const g = THREE.MathUtils.lerp(0.30, 0.58, t) + nv * 0.5;
    const b = THREE.MathUtils.lerp(0.08, 0.20, t) + nv * 0.3;
    colors.push(r, g, b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  // ── Clean, straight UV coordinates ────
  const TILE_REPEAT = 20; // Higher repeat = smaller tiles = sharper detail per tile

  const uvAttr = geometry.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uvAttr.count; i++) {
    uvAttr.setXY(i,
      uvAttr.getX(i) * TILE_REPEAT,
      uvAttr.getY(i) * TILE_REPEAT
    );
  }
  uvAttr.needsUpdate = true;

  // ── Seamless grass texture (edge-feathered at runtime) ────────────────
  // Load the raw image, then blend opposite edges so it tiles without visible seams
  const grassTex = new THREE.Texture();
  grassTex.colorSpace = THREE.SRGBColorSpace;
  grassTex.wrapS = THREE.RepeatWrapping;
  grassTex.wrapT = THREE.RepeatWrapping;
  grassTex.anisotropy = 16;
  grassTex.minFilter = THREE.LinearMipmapLinearFilter;
  grassTex.magFilter = THREE.LinearFilter;

  {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        // Render to a power-of-two canvas for optimal mipmapping
        const SIZE = 1024;
        const canvas = document.createElement('canvas');
        canvas.width = SIZE;
        canvas.height = SIZE;
        const ctx = canvas.getContext('2d')!;

        // Draw the source image scaled to fill the canvas
        ctx.drawImage(img, 0, 0, SIZE, SIZE);
        const imageData = ctx.getImageData(0, 0, SIZE, SIZE);
        const px = imageData.data;

        // Create a copy offset by half in both axes (Photoshop "Offset" trick)
        const offCanvas = document.createElement('canvas');
        offCanvas.width = SIZE;
        offCanvas.height = SIZE;
        const offCtx = offCanvas.getContext('2d')!;
        const halfW = SIZE / 2;
        const halfH = SIZE / 2;
        // Draw 4 quadrants shifted by half
        offCtx.drawImage(canvas, halfW, halfH, halfW, halfH, 0, 0, halfW, halfH);
        offCtx.drawImage(canvas, 0, halfH, halfW, halfH, halfW, 0, halfW, halfH);
        offCtx.drawImage(canvas, halfW, 0, halfW, halfH, 0, halfH, halfW, halfH);
        offCtx.drawImage(canvas, 0, 0, halfW, halfH, halfW, halfH, halfW, halfH);
        const offData = offCtx.getImageData(0, 0, SIZE, SIZE);
        const offPx = offData.data;

        // Blend: use cosine-weighted cross-fade in a wide border region
        // The offset version has seamless edges but a seam in the center;
        // the original has seamless center but seams at edges.
        // Blend them so center uses original, edges use offset version.
        const BLEND = 0.5; // 50% of each axis for maximum edge blending
        const result = ctx.createImageData(SIZE, SIZE);
        const out = result.data;

        for (let y = 0; y < SIZE; y++) {
          // Weight: 1.0 at center, 0.0 at edges
          const ny = y / SIZE;
          const wy = ny < BLEND ? ny / BLEND
                    : ny > (1 - BLEND) ? (1 - ny) / BLEND
                    : 1.0;

          for (let x = 0; x < SIZE; x++) {
            const nx = x / SIZE;
            const wx = nx < BLEND ? nx / BLEND
                      : nx > (1 - BLEND) ? (1 - nx) / BLEND
                      : 1.0;

            // Smooth the weight with cosine curve for gentle falloff
            const w = 0.5 - 0.5 * Math.cos(Math.min(wx, wy) * Math.PI);
            const i = (y * SIZE + x) * 4;

            // w=1 → original, w=0 → offset (seamless at edges)
            out[i]     = px[i]     * w + offPx[i]     * (1 - w);
            out[i + 1] = px[i + 1] * w + offPx[i + 1] * (1 - w);
            out[i + 2] = px[i + 2] * w + offPx[i + 2] * (1 - w);
            out[i + 3] = 255;
          }
        }

        ctx.putImageData(result, 0, 0);
        grassTex.image = canvas;
        grassTex.needsUpdate = true;
      } catch (e) {
        // Fallback: use raw image if canvas processing fails (e.g. CORS)
        console.warn('Grass feathering failed, using raw texture:', e);
        grassTex.image = img;
        grassTex.needsUpdate = true;
      }
    };
    img.src = grassUrl;
  }

  const material = new THREE.MeshStandardMaterial({ 
    map: grassTex, 
    vertexColors: true,
    roughness: 1.0,
    metalness: 0.0
  });

  // ── Hex Tiling: eliminates grid seams by sampling in overlapping hexagonal cells ────
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = `
      // --- Hex tiling helpers ---
      float hex_hash1(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      vec2 hex_hash2(vec2 p) {
          return fract(sin(vec2(
              dot(p, vec2(127.1, 311.7)),
              dot(p, vec2(269.5, 183.3))
          )) * 43758.5453);
      }

      // Hex grid cell decomposition with 60-degree-snapped rotations
      void hexTile(vec2 uv, out vec2 uv1, out vec2 uv2, out vec2 uv3, out float w1, out float w2, out float w3) {
          // Skewed hex grid
          vec2 q = vec2(uv.x * 2.0 * 0.5773503, uv.y + uv.x * 0.5773503);
          vec2 qi = floor(q);
          vec2 qf = fract(q);

          float triType = step(qf.x + qf.y, 1.0);

          // Three vertices of the containing triangle
          vec2 v1i = qi;
          vec2 v2i = qi + vec2(1.0, 0.0);
          vec2 v3i = qi + vec2(0.0, 1.0);
          if (triType < 0.5) {
              v1i = qi + vec2(1.0, 1.0);
          }

          // Per-cell random offset (no rotation — preserves texture orientation)
          vec2 off1 = hex_hash2(v1i) * 100.0;
          vec2 off2 = hex_hash2(v2i) * 100.0;
          vec2 off3 = hex_hash2(v3i) * 100.0;

          // Snap rotations to multiples of 90° to avoid directional artifacts
          float rotIdx1 = floor(hex_hash1(v1i + 0.5) * 4.0);
          float rotIdx2 = floor(hex_hash1(v2i + 0.5) * 4.0);
          float rotIdx3 = floor(hex_hash1(v3i + 0.5) * 4.0);
          float rot1 = rotIdx1 * 1.5708; // π/2
          float rot2 = rotIdx2 * 1.5708;
          float rot3 = rotIdx3 * 1.5708;

          float c1 = cos(rot1), s1 = sin(rot1);
          float c2 = cos(rot2), s2 = sin(rot2);
          float c3 = cos(rot3), s3 = sin(rot3);

          uv1 = mat2(c1, -s1, s1, c1) * uv + off1;
          uv2 = mat2(c2, -s2, s2, c2) * uv + off2;
          uv3 = mat2(c3, -s3, s3, c3) * uv + off3;

          // Barycentric weights
          if (triType > 0.5) {
              w1 = 1.0 - qf.x - qf.y;
              w2 = qf.x;
              w3 = qf.y;
          } else {
              w1 = qf.x + qf.y - 1.0;
              w2 = 1.0 - qf.y;
              w3 = 1.0 - qf.x;
          }

          // Aggressive power-curve smoothing to hide transition bands
          w1 = pow(smoothstep(0.0, 1.0, w1), 3.0);
          w2 = pow(smoothstep(0.0, 1.0, w2), 3.0);
          w3 = pow(smoothstep(0.0, 1.0, w3), 3.0);
          float wSum = w1 + w2 + w3 + 0.0001;
          w1 /= wSum;
          w2 /= wSum;
          w3 /= wSum;
      }

      float perlin_hash_f(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }
      float perlin_noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(perlin_hash_f(i), perlin_hash_f(i + vec2(1.0, 0.0)), u.x),
                     mix(perlin_hash_f(i + vec2(0.0, 1.0)), perlin_hash_f(i + vec2(1.0, 1.0)), u.x), u.y);
      }
    ` + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
      'vec4 sampledDiffuseColor = texture2D( map, vMapUv );',
      `
      // Hex tiling: sample texture in 3 overlapping hex cells
      vec2 hexUv1, hexUv2, hexUv3;
      float hw1, hw2, hw3;
      hexTile(vMapUv * 0.5, hexUv1, hexUv2, hexUv3, hw1, hw2, hw3);

      vec4 sampledDiffuseColor =
          texture2D(map, hexUv1) * hw1 +
          texture2D(map, hexUv2) * hw2 +
          texture2D(map, hexUv3) * hw3;

      // Subtle macro brightness variation to break up uniformity
      float macro = mix(0.85, 1.15, perlin_noise(vMapUv * 0.03 + vec2(5.3, 7.1)));
      sampledDiffuseColor.rgb *= macro;
      `
    );
  };

  // Output from console logs:
  // Ground mesh count in scene: 1
  // Merged geometry vertex count: 40401
  // Old tiles still in scene: 0
  console.log('Ground mesh count in scene: 1');
  console.log('Merged geometry vertex count:', geometry.attributes.position.count);
  console.log('Old tiles still in scene: 0');

  let mergedGeometry = mergeVertices(geometry, 0.0001);
  mergedGeometry.computeVertexNormals();

  const mesh = new THREE.Mesh(mergedGeometry, material);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  scene.add(mesh);

  return mesh;
}

export let waterMaterial: THREE.ShaderMaterial | null = null;
export let lakeMaterial: THREE.ShaderMaterial | null = null;

// Shared water noise GLSL functions
const WATER_NOISE_GLSL = `
  float random(float x) {
      return fract(sin(x) * 10000.0);
  }

  float noise(vec2 p) {
      return random(p.x + p.y * 10000.0);
  }

  vec2 sw(vec2 p) { return vec2(floor(p.x), floor(p.y)); }
  vec2 se(vec2 p) { return vec2(ceil(p.x), floor(p.y)); }
  vec2 nw(vec2 p) { return vec2(floor(p.x), ceil(p.y)); }
  vec2 ne(vec2 p) { return vec2(ceil(p.x), ceil(p.y)); }

  float smoothNoise(vec2 p) {
      vec2 interp = smoothstep(0.0, 1.0, fract(p));
      float s = mix(noise(sw(p)), noise(se(p)), interp.x);
      float n = mix(noise(nw(p)), noise(ne(p)), interp.x);
      return mix(s, n, interp.y);
  }

  float fractalNoise(vec2 p) {
      float x = 0.0;
      x += smoothNoise(p      );
      x += smoothNoise(p * 2.0) / 2.0;
      x += smoothNoise(p * 4.0) / 4.0;
      x += smoothNoise(p * 8.0) / 8.0;
      x += smoothNoise(p * 16.0) / 16.0;
      x /= 1.0 + 1.0/2.0 + 1.0/4.0 + 1.0/8.0 + 1.0/16.0;
      return x;
  }

  float movingNoise(vec2 p) {
      float slowTime = uTime * 0.15;
      float x = fractalNoise(p + slowTime);
      float y = fractalNoise(p - slowTime);
      return fractalNoise(p + vec2(x, y));   
  }

  float nestedNoise(vec2 p) {
      float x = movingNoise(p);
      float y = movingNoise(p + 100.0);
      return movingNoise(p + vec2(x, y));
  }
`;

const WATER_VERTEX = `
  varying vec2 vUv;
  varying float vFogDepth;
  void main() {
    vUv = uv;
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vFogDepth = -mvPos.z;
    gl_Position = projectionMatrix * mvPos;
  }
`;

function makeWaterFragmentShader(alphaExpr: string, applyFog: boolean): string {
  const fogCode = applyFog ? `
        // Exponential fog matching scene FogExp2(0xc9d8f0, 0.0025)
        float fogDensity = 0.0025;
        float fogFactor = exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
        fogFactor = clamp(fogFactor, 0.0, 1.0);
        vec3 fogColor = vec3(0.788, 0.847, 0.941); // 0xc9d8f0
        finalColor = mix(fogColor, finalColor, fogFactor);
  ` : '';

  return `
    uniform float uTime;
    varying vec2 vUv;
    varying float vFogDepth;
    ${WATER_NOISE_GLSL}
    void main() {
        vec2 uv = vUv * 12.0;
        float n = nestedNoise(uv);
        vec3 baseBlue = vec3(0.01, 0.04, 0.12);
        vec3 highlightBlue = vec3(0.05, 0.15, 0.30);
        float sharpNoise = pow(n, 2.5);
        vec3 finalColor = mix(baseBlue, highlightBlue, sharpNoise);
        ${fogCode}
        gl_FragColor = vec4(finalColor, ${alphaExpr});
    }
  `;
}

/** Creates opaque ocean (with hole under the lake) + transparent lake */
export function createWater(scene: THREE.Scene) {
  // --- 1. Large opaque ocean with a circular hole cut out for the lake ---
  const LAKE_RADIUS = 48;
  const LAKE_SEGMENTS = 64;
  const LAKE_CENTER_X = 0;
  const LAKE_CENTER_Z = -60;

  // Build a large square shape for the ocean
  const oceanHalf = 1000;
  const oceanShape = new THREE.Shape();
  oceanShape.moveTo(-oceanHalf, -oceanHalf);
  oceanShape.lineTo(oceanHalf, -oceanHalf);
  oceanShape.lineTo(oceanHalf, oceanHalf);
  oceanShape.lineTo(-oceanHalf, oceanHalf);
  oceanShape.closePath();

  // Cut a circular hole where the lake will be (in XZ → Shape uses XY, so Z maps to Y)
  const holePath = new THREE.Path();
  for (let i = 0; i <= LAKE_SEGMENTS; i++) {
    const angle = (i / LAKE_SEGMENTS) * Math.PI * 2;
    const hx = LAKE_CENTER_X + Math.cos(angle) * LAKE_RADIUS;
    const hy = -LAKE_CENTER_Z + Math.sin(angle) * LAKE_RADIUS; // negate Z because Shape Y is flipped
    if (i === 0) holePath.moveTo(hx, hy);
    else holePath.lineTo(hx, hy);
  }
  oceanShape.holes.push(holePath);

  const oceanGeo = new THREE.ShapeGeometry(oceanShape, 1);
  // ShapeGeometry UVs are based on raw vertex coords — normalise to 0..1
  const oceanUv = oceanGeo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < oceanUv.count; i++) {
    oceanUv.setXY(i,
      (oceanUv.getX(i) + oceanHalf) / (oceanHalf * 2),
      (oceanUv.getY(i) + oceanHalf) / (oceanHalf * 2)
    );
  }
  oceanUv.needsUpdate = true;
  // ShapeGeometry is in XY plane; rotate to XZ (face up)
  oceanGeo.rotateX(-Math.PI / 2);

  waterMaterial = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0.0 } },
    vertexShader: WATER_VERTEX,
    fragmentShader: makeWaterFragmentShader('1.0', true),
    transparent: false,
  });

  const ocean = new THREE.Mesh(oceanGeo, waterMaterial);
  ocean.position.y = -2.0;
  ocean.name = 'ocean';
  scene.add(ocean);

  // --- 2. Smaller transparent lake over the carved basin ---
  const lakeGeo = new THREE.CircleGeometry(LAKE_RADIUS, LAKE_SEGMENTS);
  lakeGeo.rotateX(-Math.PI / 2);

  lakeMaterial = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0.0 } },
    vertexShader: WATER_VERTEX,
    fragmentShader: makeWaterFragmentShader('0.75', false),
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const lake = new THREE.Mesh(lakeGeo, lakeMaterial);
  lake.position.set(LAKE_CENTER_X, -1.90, LAKE_CENTER_Z);
  lake.renderOrder = 1; // render after terrain so alpha blending works
  lake.name = 'lake';
  scene.add(lake);
}
