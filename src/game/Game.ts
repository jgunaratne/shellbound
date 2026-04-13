import * as THREE from 'three';
import { CameraHelper } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { InputManager } from './InputManager';
import { Player } from './Player';
import { ThirdPersonCamera } from './ThirdPersonCamera';
import { createTerrain, createWater } from './terrain';
import { populateEnvironment } from './environment';
import skyUrl from '../assets/sky.png';

export class Game {
  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;
  private input: InputManager;
  private player: Player;
  private tpCamera: ThirdPersonCamera;
  private skydome: THREE.Object3D | null = null;
  private composer!: EffectComposer;
  private bokehPass!: BokehPass;
  private ssaoPass!: SSAOPass;
  private animId = 0;
  private lastTime = 0;

  constructor(canvas: HTMLCanvasElement) {
    // --- Renderer ---
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.4;

    // --- Scene ---
    this.scene = new THREE.Scene();
    const fogColor = 0xc9d8f0; // cool sky blue haze as specified
    this.scene.fog = new THREE.FogExp2(fogColor, 0.0025);
    this.scene.background = new THREE.Color(fogColor);

    // --- Skydome ---
    this.createSkydome();

    // --- Lighting System (Realistic multi-source standard) ---
    
    // 1. Sky ambient bounce fill
    const ambientLight = new THREE.AmbientLight(0xc9d8f0, 0.4);
    this.scene.add(ambientLight);

    // 2. Primary mid-afternoon sun (warm)
    const sun = new THREE.DirectionalLight(0xfff5e0, 2.8);
    sun.position.set(100, 150, 50);
    sun.castShadow = true;
    sun.shadow.bias = -0.001;
    sun.shadow.normalBias = 0.05;
    const WORLD_HALF_SIZE = 300 / 2;
    sun.shadow.camera.left = -WORLD_HALF_SIZE;
    sun.shadow.camera.right = WORLD_HALF_SIZE;
    sun.shadow.camera.top = WORLD_HALF_SIZE;
    sun.shadow.camera.bottom = -WORLD_HALF_SIZE;
    sun.shadow.camera.near = 0.1;
    sun.shadow.camera.far = 200;
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.mapSize.width = 4096;
    sun.shadow.mapSize.height = 4096;
    this.scene.add(sun);
    this.scene.add(new CameraHelper(sun.shadow.camera));

    // 3. Secondary subtle cooler back-fill to illuminate shadowed faces naturally
    const fillLight = new THREE.DirectionalLight(0xc9d8f0, 0.5);
    fillLight.position.set(-100, 50, -50);
    this.scene.add(fillLight);

    // --- Terrain & water ---
    createTerrain(this.scene);
    createWater(this.scene);

    // --- Environment ---
    populateEnvironment(this.scene);



    // --- Player ---
    this.player = new Player(this.scene);

    // --- Camera ---
    this.tpCamera = new ThirdPersonCamera();

    // --- Input ---
    this.input = new InputManager(canvas);

    // --- Post-processing (Realistic Depth of Field) ---
    this.composer = new EffectComposer(this.renderer);
    
    const renderPass = new RenderPass(this.scene, this.tpCamera.camera);
    this.composer.addPass(renderPass);

    this.ssaoPass = new SSAOPass(this.scene, this.tpCamera.camera, window.innerWidth, window.innerHeight);
    this.ssaoPass.kernelRadius = 12;
    this.ssaoPass.minDistance = 0.0025;
    this.ssaoPass.maxDistance = 0.1;
    this.composer.addPass(this.ssaoPass);

    this.bokehPass = new BokehPass(this.scene, this.tpCamera.camera, {
      focus: 7.0,       // Focus precisely centered on the player
      aperture: 0.0002, // Extremely tight aperture for a deep, razor-sharp foreground
      maxblur: 0.01     // Controlled, beautiful soft blur for distant scenery
    });
    this.composer.addPass(this.bokehPass);

    const outputPass = new OutputPass();
    this.composer.addPass(outputPass);

    // --- Resize ---
    window.addEventListener('resize', this.onResize);
  }

  private createSkydome() {
    const loader = new THREE.TextureLoader();
    loader.load(skyUrl, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      // Tile the panorama horizontally for full 360° wrap
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.repeat.set(3, 1);

      const skyRadius = 350;
      const skyHeight = 350;
      // Open-ended cylinder — UVs map linearly: U around, V bottom-to-top
      const geo = new THREE.CylinderGeometry(
        skyRadius, skyRadius, skyHeight, 64, 1, true
      );
      const mat = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      });

      // ── Cinematic Atmospheric Sky Blur via GPU Shader ────
      // Softens the crisp panoramic image natively on the graphics card to create a beautiful, dreamy horizon background
      mat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          'vec4 sampledDiffuseColor = texture2D( map, vMapUv );',
          `
          float blurAmt = 0.008; // beautiful soft blur radius to take the digital sharpness off the clouds
          
          vec4 sampledDiffuseColor = (
            texture2D(map, vMapUv) +
            texture2D(map, vMapUv + vec2(blurAmt, 0.0)) +
            texture2D(map, vMapUv - vec2(blurAmt, 0.0)) +
            texture2D(map, vMapUv + vec2(0.0, blurAmt)) +
            texture2D(map, vMapUv - vec2(0.0, blurAmt)) +
            texture2D(map, vMapUv + vec2(blurAmt, blurAmt)) +
            texture2D(map, vMapUv - vec2(blurAmt, blurAmt))
          ) / 7.0;
          `
        );
      };

      // Group holds the cylinder + top cap together
      const skyGroup = new THREE.Group();

      const cylinder = new THREE.Mesh(geo, mat);
      skyGroup.add(cylinder);

      // Disc cap to close the top — color matched to the sky image upper edge
      const capGeo = new THREE.CircleGeometry(skyRadius, 64);
      const capMat = new THREE.MeshBasicMaterial({
        color: 0xc9a8b8, // soft pink matching cloud edge
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      });
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.rotation.x = Math.PI / 2;
      cap.position.y = skyHeight / 2;
      skyGroup.add(cap);

      // Shift the whole dome up so camera sits in the lower portion,
      // making the clouds visible above the horizon
      skyGroup.position.y = skyHeight * 0.15;

      skyGroup.renderOrder = -1;
      this.skydome = skyGroup;
      this.scene.add(skyGroup);
    });
  }



  start() {
    this.lastTime = performance.now();
    this.loop(this.lastTime);
  }

  private loop = (time: number) => {
    this.animId = requestAnimationFrame(this.loop);
    const dt = Math.min((time - this.lastTime) / 1000, 0.05);
    this.lastTime = time;

    this.player.update(dt, this.input, this.tpCamera.cameraYaw);
    this.tpCamera.update(dt, this.player.position, this.input);

    // Keep skydome centered on the camera so it appears infinitely far
    if (this.skydome) {
      const camPos = this.tpCamera.camera.position;
      this.skydome.position.set(camPos.x, 0, camPos.z);
    }

    this.composer.render();
  };

  private onResize = () => {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.tpCamera.onResize();
  };

  dispose() {
    cancelAnimationFrame(this.animId);
    this.input.dispose();
    window.removeEventListener('resize', this.onResize);
    this.bokehPass.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
