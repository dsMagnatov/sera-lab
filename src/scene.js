import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createCellGeometry, createCellMaterial, createMembraneTexture, seededRandom } from './geometry.js';
import { CellPhysics, depthScale, ENTRY_DEPTH } from './physics.js';
import { VisionOverlay } from './vision.js';
import { createStreamLane } from './flow.js';
import { CAMERA_START_DEPTH, COMPACT_HERO_QUERY, getScrollState } from './scroll.js';

const MAX_CELLS = 140;
const MAX_SMALL = 350;
const MAX_DUST = 3500;

const gradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.36 }, uGrain: { value: 0.025 },
    uSaturation: { value: 1.08 }, uChromatic: { value: 0.0006 },
    uTime: { value: 0 },
  },
  vertexShader: `varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uVignette, uGrain, uSaturation, uChromatic, uTime;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      vec2 offset = (uv - 0.5) * uChromatic;
      vec3 color = texture2D(tDiffuse, uv).rgb;
      color.r = texture2D(tDiffuse, uv + offset).r;
      color.b = texture2D(tDiffuse, uv - offset).b;
      float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(vec3(luminance), color, uSaturation);
      float vignette = smoothstep(0.18, 0.73, length((uv - 0.5) * vec2(1.05, 1.0)));
      color *= 1.0 - vignette * uVignette;
      float noise = fract(sin(dot(gl_FragCoord.xy + mod(uTime, 127.0), vec2(12.9898, 78.233))) * 43758.5453);
      color += (noise - 0.5) * uGrain * 0.25;
      gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
    }`,
};

export class Bloodstream {
  constructor(container, settings, onStats, onError) {
    this.container = container;
    this.mobileLayout = matchMedia(COMPACT_HERO_QUERY);
    this.settings = settings;
    this.onStats = onStats;
    this.onError = onError;
    this.time = 0;
    this.paused = false;
    this.presentation = getScrollState(0);
    this.lastTime = performance.now();
    this.pointer = new THREE.Vector2();
    this.pointerSmooth = new THREE.Vector2();
    this.matrixDummy = new THREE.Object3D();
    this.colorDummy = new THREE.Color();
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(settings.effects.fogColor, settings.effects.fog);
    this.camera = new THREE.PerspectiveCamera(settings.camera.fov, 1, 0.1, 90);
    this.camera.position.set(0, 0, CAMERA_START_DEPTH);

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor('#11151d');
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = settings.effects.exposure;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute('aria-label', 'Живий тривимірний потік клітин крові');
    this.renderer.domElement.tabIndex = 0;
    container.appendChild(this.renderer.domElement);

    this.createEnvironment();
    this.createLights();
    this.createCells();
    this.physics = new CellPhysics(settings, this.cellData, this.smallData, container.clientWidth / container.clientHeight);
    this.physics.distribute();
    this.vision = new VisionOverlay(settings);
    this.createParticles();
    this.createPostprocessing();
    this.updateBackground();
    this.update('all');

    this.onResize = () => this.resize();
    this.onPointer = (event) => {
      // UI interaction should never steer the camera.
      if (event.pointerType === 'touch' || event.target !== this.renderer.domElement) return;
      const bounds = this.renderer.domElement.getBoundingClientRect();
      this.pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, (event.clientY - bounds.top) / bounds.height * 2 - 1);
    };
    this.onLeave = () => this.pointer.set(0, 0);
    this.onVisibility = () => { this.lastTime = performance.now(); };
    this.onContextLost = (event) => {
      event.preventDefault();
      this.onError('Графічний контекст перервано. Перезавантажте сторінку, щоб відновити сцену.');
    };
    addEventListener('resize', this.onResize);
    addEventListener('pointermove', this.onPointer);
    document.addEventListener('pointerleave', this.onLeave);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
    this.resize();
    this.frameCount = 0;
    this.statsTime = performance.now();
    this.renderer.setAnimationLoop((now) => this.animate(now));
  }

  createEnvironment() {
    const environment = new THREE.Scene();
    environment.background = new THREE.Color('#10151b');
    const planeGeometry = new THREE.PlaneGeometry(1, 1);
    const cards = [
      { color: '#d6f1fa', power: 3, pos: [7, 9, 4], size: [9, 5] },
      { color: '#ec2942', power: 2, pos: [-7, -3, 3], size: [7, 8] },
      { color: '#9edfea', power: 2.5, pos: [5, 4, -8], size: [5, 9] },
    ];
    for (const card of cards) {
      const mesh = new THREE.Mesh(planeGeometry, new THREE.MeshBasicMaterial({
        color: new THREE.Color(card.color).multiplyScalar(card.power), side: THREE.DoubleSide,
      }));
      mesh.position.fromArray(card.pos);
      mesh.scale.set(...card.size, 1);
      mesh.lookAt(0, 0, 0);
      environment.add(mesh);
    }
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environmentTarget = pmrem.fromScene(environment, 0.035);
    this.scene.environment = this.environmentTarget.texture;
    planeGeometry.dispose();
    environment.children.forEach((mesh) => mesh.material.dispose());
    pmrem.dispose();
  }

  createLights() {
    this.keyLight = new THREE.DirectionalLight('#dcf5ff', 4.3);
    this.fillLight = new THREE.DirectionalLight('#ed1834', 2.6);
    this.fillLight.position.set(-7, -2, 4);
    this.rimLight = new THREE.DirectionalLight('#a0e3ee', 5.2);
    this.rimLight.position.set(5, 5, -8);
    this.ambientLight = new THREE.HemisphereLight('#b4d5e6', '#370511', 0.42);
    this.scene.add(this.keyLight, this.fillLight, this.rimLight, this.ambientLight);
  }

  createCells() {
    this.membrane = createMembraneTexture();
    this.material = createCellMaterial(this.settings, this.membrane);
    this.geometry = createCellGeometry(this.settings.cell);
    this.heroGeometry = createCellGeometry(this.settings.cell, 144, 80);
    this.hero = new THREE.Mesh(this.heroGeometry, this.material);
    this.scene.add(this.hero);

    this.cells = new THREE.InstancedMesh(this.geometry, this.material, MAX_CELLS);
    this.cells.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cells.frustumCulled = false;
    this.scene.add(this.cells);
    const random = seededRandom(821);
    // Deliberately staged across focal planes, then continued as a seamless stream.
    const composition = [
      [-5.2, 1.35, -1.3, 1.07, 0.65, -0.35, -0.45],
      [3.8, 1.55, -1.7, 1.12, -0.2, 0.5, 0.45],
      [7.6, 2.7, -7, 1.22, 0.4, 0.75, -0.4],
      [1.5, -4.3, -1.5, 1.05, 1, -0.2, 0.2],
      [-7.8, -4.9, 7.6, 1.32, 0.4, 1.1, -0.4],
      [6.7, -4.3, 5, 1.16, 0.6, 0.3, 0.1],
      [-0.5, 4.6, -12, 0.9, 1.3, -0.5, 0.6],
      [-3.5, -3, -11, 1, 0.7, 0.4, 0.6],
      [3, -0.6, -17, 1.05, 0.8, -0.5, 0.3],
      [0.5, 0.2, -23, 0.7, -0.8, 0.5, 1],
      [-1.3, -0.6, -2.8, 0.64, 0.65, -0.4, 0.3],
      [0.1, 0.8, -6.5, 0.78, -0.5, 0.6, -0.2],
      [-1.8, -0.2, -10.5, 0.85, 0.4, -0.7, 0.4],
    ];
    this.cellData = Array.from({ length: MAX_CELLS }, (_, i) => {
      const staged = composition[i];
      return {
        x: staged?.[0] ?? (random() - 0.5) * 25,
        y: staged?.[1] ?? (random() - 0.5) * 16,
        z: staged?.[2] ?? -9 - random() * 28,
        scale: staged?.[3] ?? 0.35 + random() * 0.7,
        rx: staged?.[4] ?? random() * Math.PI,
        ry: staged?.[5] ?? (random() - 0.5) * 2.4,
        rz: staged?.[6] ?? random() * Math.PI * 2,
        phase: random() * Math.PI * 2,
        pace: 0.65 + random() * 0.65,
        tint: random(), spin: random() - 0.5,
        lane: createStreamLane(i),
      };
    });

    this.smallMaterial = this.material.clone();
    // Share the membrane shader; the microcells have their own base color.
    this.smallMaterial.onBeforeCompile = this.material.onBeforeCompile;
    this.smallMaterial.customProgramCacheKey = this.material.customProgramCacheKey;
    this.smallMaterial.userData.uniforms = this.material.userData.uniforms;
    this.smallGeometry = createCellGeometry(this.settings.cell, 24, 14);
    this.smallCells = new THREE.InstancedMesh(this.smallGeometry, this.smallMaterial, MAX_SMALL);
    this.smallCells.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.smallCells.frustumCulled = false;
    this.scene.add(this.smallCells);
    this.smallData = Array.from({ length: MAX_SMALL }, () => ({
      x: (random() - 0.5) * 25, y: (random() - 0.5) * 16,
      z: -30 + random() * 41, scale: 0.55 + random() * 0.95,
      phase: random() * Math.PI * 2, pace: 0.7 + random() * 0.8,
    }));
  }

  createParticles() {
    const random = seededRandom(221);
    this.dustData = Array.from({ length: MAX_DUST }, () => ({
      x: (random() - 0.5) * 31, y: (random() - 0.5) * 21,
      z: ENTRY_DEPTH + random() * 69, phase: random() * Math.PI * 2,
      scale: 0.4 + random() * 1.3, pace: 0.5 + random(),
    }));
    this.dustRandom = random;
    this.dustPositions = new Float32Array(MAX_DUST * 3);
    const scales = Float32Array.from(this.dustData, (d) => d.scale);
    this.dustGeometry = new THREE.BufferGeometry();
    this.dustGeometry.setAttribute('position', new THREE.BufferAttribute(this.dustPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.dustGeometry.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
    this.dustMaterial = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: new THREE.Color(this.settings.particles.color) },
        uSize: { value: 0.035 }, uOpacity: { value: 0.55 },
        uResolution: { value: 800 }, uFocus: { value: 14.3 }, uBlur: { value: 0.0018 },
      },
      vertexShader: `
        attribute float aScale;
        uniform float uSize, uResolution, uFocus, uBlur;
        varying float vDefocus, vDistance, vVisibility;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vDistance = -mv.z;
          vVisibility = smoothstep(-56.0, -32.0, position.z) * (1.0 - smoothstep(10.0, 16.0, position.z));
          vDefocus = min(abs(vDistance - uFocus) * uBlur * 90.0, 5.0);
          gl_PointSize = clamp(uSize * aScale * uResolution / max(vDistance, 1.0) * (1.0 + vDefocus), 1.0, 55.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vDefocus, vDistance, vVisibility;
        void main() {
          float radius = length(gl_PointCoord - 0.5) * 2.0;
          if (radius > 1.0) discard;
          float disk = smoothstep(1.0, 0.25, radius);
          float attenuation = exp(-vDistance * 0.018);
          float alpha = disk * uOpacity * attenuation * vVisibility / (1.0 + vDefocus * 0.35);
          gl_FragColor = vec4(uColor * (1.2 + disk * 0.5), alpha);
        }`,
    });
    this.dust = new THREE.Points(this.dustGeometry, this.dustMaterial);
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
  }

  createPostprocessing() {
    this.occlusionMaterial = new THREE.MeshDepthMaterial({ colorWrite: false });
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bokeh = new BokehPass(this.scene, this.camera, {
      focus: this.settings.camera.focus, aperture: this.settings.camera.aperture,
      maxblur: this.settings.camera.blur,
    });
    const originalBokehRender = this.bokeh.render.bind(this.bokeh);
    this.bokeh.render = (...args) => {
      // A textured background is not packed depth; leave it at the far plane.
      const background = this.scene.background;
      const dustVisible = this.dust.visible;
      this.scene.background = null;
      this.dust.visible = false;
      try { originalBokehRender(...args); }
      finally { this.scene.background = background; this.dust.visible = dustVisible; }
    };
    this.composer.addPass(this.bokeh);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.65, 0.85);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(gradeShader);
    this.composer.addPass(this.grade);
    this.output = new OutputPass();
    this.composer.addPass(this.output);
  }

  updateBackground() {
    const canvas = document.createElement('canvas');
    canvas.width = 1536;
    canvas.height = 864;
    const ctx = canvas.getContext('2d');
    const { effects, light } = this.settings;
    ctx.fillStyle = effects.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const glow = (x, y, radius, color, alpha) => {
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      const rgb = new THREE.Color(color);
      const srgb = rgb.clone().convertLinearToSRGB();
      const c = `${Math.round(srgb.r * 255)},${Math.round(srgb.g * 255)},${Math.round(srgb.b * 255)}`;
      gradient.addColorStop(0, `rgba(${c},${Math.min(alpha, 1)})`);
      gradient.addColorStop(0.45, `rgba(${c},${Math.min(alpha * 0.4, 1)})`);
      gradient.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    };
    glow(1450, -80, 1250, light.rimColor, light.glow * 0.95);
    glow(1630, 100, 620, light.keyColor, light.glow * 0.85);
    glow(90, 690, 820, light.fillColor, 0.26 + light.fill * 0.035);
    glow(730, 770, 550, '#0b0d15', 0.6);
    this.backgroundTexture?.dispose();
    this.backgroundTexture = new THREE.CanvasTexture(canvas);
    this.backgroundTexture.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = this.backgroundTexture;
  }

  update(path) {
    const { cell, flow, particles, light, camera, effects } = this.settings;
    const group = path.split('.')[0];
    if (path === 'all' || group === 'vision' || ['cell.radius', 'cell.thickness', 'cell.dent', 'cell.rim', 'cell.asymmetry'].includes(path)) this.vision.sync();
    if (path === 'all' || ['cell', 'flow', 'particles', 'physics'].includes(group)) this.physics.sync(path);
    if (path === 'all' || ['cell.radius', 'cell.thickness', 'cell.dent', 'cell.rim', 'cell.asymmetry'].includes(path)) {
      const previous = [this.geometry, this.heroGeometry, this.smallGeometry];
      this.geometry = createCellGeometry(cell);
      this.heroGeometry = createCellGeometry(cell, 144, 80);
      this.smallGeometry = createCellGeometry(cell, 24, 14);
      this.hero.geometry = this.heroGeometry;
      this.cells.geometry = this.geometry;
      this.smallCells.geometry = this.smallGeometry;
      previous.forEach((geometry) => geometry.dispose());
    }
    if (path === 'all' || ['cell', 'light', 'particles'].includes(group)) {
      this.material.color.set(cell.color);
      this.material.roughness = cell.roughness;
      this.material.clearcoat = cell.clearcoat;
      this.material.sheen = cell.sheen;
      this.material.envMapIntensity = light.reflection;
      this.material.userData.uniforms.uTextureScale.value = cell.textureScale;
      this.material.userData.uniforms.uTextureStrength.value = cell.texture;
      this.material.userData.uniforms.uScatter.value = cell.scatter;
      this.smallMaterial.color.set(particles.smallColor);
      this.smallMaterial.roughness = cell.roughness;
      this.smallMaterial.clearcoat = cell.clearcoat;
      this.smallMaterial.envMapIntensity = light.reflection;
      this.dustMaterial.uniforms.uColor.value.set(particles.color);
      this.dustMaterial.uniforms.uSize.value = particles.size;
      this.dustMaterial.uniforms.uOpacity.value = particles.opacity;
      for (let i = 0; i < MAX_CELLS; i++) {
        const shade = 1 - this.cellData[i].tint * cell.variation;
        this.cells.setColorAt(i, this.colorDummy.setRGB(shade, shade, shade));
      }
      if (this.cells.instanceColor) this.cells.instanceColor.needsUpdate = true;
    }
    this.cells.count = flow.single ? 0 : flow.count;
    this.smallCells.count = flow.single ? 0 : particles.smallCount;
    this.dustGeometry.setDrawRange(0, particles.count);

    if (path === 'all' || group === 'light') {
      this.keyLight.color.set(light.keyColor);
      this.keyLight.intensity = light.key;
      this.keyLight.position.set(light.keyX, light.keyY, light.keyZ);
      this.fillLight.color.set(light.fillColor);
      this.fillLight.intensity = light.fill;
      this.fillLight.position.set(light.fillX, light.fillY, light.fillZ);
      this.rimLight.color.set(light.rimColor);
      this.rimLight.intensity = light.rim;
      this.rimLight.position.set(light.rimX, light.rimY, light.rimZ);
      this.ambientLight.intensity = light.ambient;
    }
    if (path === 'all' || group === 'light' || path === 'effects.background') this.updateBackground();
    this.scene.fog.color.set(effects.fogColor);
    this.scene.fog.density = effects.fog;
    this.camera.fov = camera.fov;
    this.updateCameraFraming();
    this.bokeh.enabled = camera.dof;
    this.bokeh.uniforms.focus.value = camera.focus;
    this.bokeh.uniforms.aperture.value = camera.aperture;
    this.bokeh.uniforms.maxblur.value = camera.blur;
    this.dustMaterial.uniforms.uFocus.value = camera.focus;
    this.dustMaterial.uniforms.uBlur.value = camera.dof ? camera.aperture : 0;
    this.bloom.strength = effects.bloom;
    this.renderer.toneMappingExposure = effects.exposure;
    this.grade.uniforms.uVignette.value = effects.vignette;
    this.grade.uniforms.uGrain.value = effects.grain;
    this.grade.uniforms.uSaturation.value = effects.saturation;
    this.grade.uniforms.uChromatic.value = effects.chromatic;
    if (path === 'effects.quality' || path === 'all') this.resize();
  }

  resize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.physics.setAspect(width / height);
    const ratio = Math.min(devicePixelRatio, this.settings.effects.quality, this.mobileLayout.matches ? 1.35 : Infinity);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(width, height);
    this.camera.aspect = width / height;
    this.updateCameraFraming();
    this.dustMaterial.uniforms.uResolution.value = height * ratio;
  }

  updateCameraFraming() {
    const mobile = this.mobileLayout.matches;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.zoom = this.settings.camera.zoom * (mobile ? Math.min(1, width / height / 0.78) : 1);
    if (mobile) this.camera.setViewOffset(width, height, 0, -height * 0.15, width, height);
    else this.camera.clearViewOffset();
  }

  updateMotion(delta) {
    const { flow, particles } = this.settings;
    const t = this.time;
    const dummy = this.matrixDummy;
    const angle = flow.direction * Math.PI / 180;
    const driftX = Math.cos(angle) * 0.13;
    const driftY = Math.sin(angle) * 0.13;
    this.physics.step(delta);
    this.hero.position.copy(this.physics.hero.rendered.position);
    this.hero.quaternion.copy(this.physics.hero.rendered.rotation);
    this.hero.scale.setScalar(flow.heroScale);

    for (let i = 0; i < this.cells.count; i++) {
      const record = this.physics.cells[i];
      dummy.position.copy(record.rendered.position);
      dummy.quaternion.copy(record.rendered.rotation);
      const growth = depthScale(dummy.position.z, this.settings.physics.appearance);
      dummy.scale.setScalar(Math.max(0.00001, record.scale * growth));
      dummy.updateMatrix();
      this.cells.setMatrixAt(i, dummy.matrix);
    }
    this.cells.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < this.smallCells.count; i++) {
      const record = this.physics.smallCells[i];
      dummy.position.copy(record.rendered.position);
      dummy.quaternion.copy(record.rendered.rotation);
      const growth = depthScale(dummy.position.z, this.settings.physics.appearance);
      dummy.scale.setScalar(Math.max(0.00001, record.scale * growth));
      dummy.updateMatrix();
      this.smallCells.setMatrixAt(i, dummy.matrix);
    }
    this.smallCells.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < particles.count; i++) {
      const d = this.dustData[i];
      d.z += delta * particles.speed * d.pace * 3.6;
      d.x += delta * particles.speed * driftX;
      d.y += delta * particles.speed * driftY;
      if (d.z > 18) {
        d.z = ENTRY_DEPTH - 2 - this.dustRandom() * 5;
        d.x = (this.dustRandom() - 0.5) * 31;
        d.y = (this.dustRandom() - 0.5) * 21;
      }
      this.dustPositions[i * 3] = d.x + Math.sin(t * 0.25 + d.phase) * particles.turbulence;
      this.dustPositions[i * 3 + 1] = d.y + Math.cos(t * 0.35 + d.phase) * particles.turbulence * 0.6;
      this.dustPositions[i * 3 + 2] = d.z;
    }
    this.dustGeometry.attributes.position.needsUpdate = true;
  }

  animate(now) {
    const delta = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    if (document.hidden || !this.presentation.onScreen) return;
    const animationDelta = this.paused ? 0 : delta;
    this.time += animationDelta;
    this.updateMotion(animationDelta);
    const smoothing = this.settings.camera.parallaxSmoothing;
    const pointerBlend = smoothing > 0 ? 1 - Math.exp(-delta / smoothing) : 1;
    this.pointerSmooth.lerp(this.pointer, pointerBlend);
    const parallax = this.settings.camera.parallax * (1 - this.presentation.centering);
    this.camera.position.x = this.pointerSmooth.x * parallax;
    this.camera.position.y = -this.pointerSmooth.y * parallax * 0.6;
    this.camera.position.z = CAMERA_START_DEPTH + this.presentation.retreat;
    const anchor = this.physics.heroAnchor;
    this.camera.lookAt(anchor.x, anchor.y, anchor.z);
    this.bokeh.uniforms.focus.value = this.settings.camera.focus + this.presentation.retreat;
    this.dustMaterial.uniforms.uFocus.value = this.settings.camera.focus + this.presentation.retreat;
    this.grade.uniforms.uTime.value = this.time;
    this.renderFrame(delta);
    this.frameCount++;
    if (now - this.statsTime > 1000) {
      this.onStats(Math.round(this.frameCount * 1000 / (now - this.statsTime)));
      this.frameCount = 0;
      this.statsTime = now;
    }
  }

  setPaused(paused) { this.paused = paused; }

  setPresentation(state) { this.presentation = state; }

  resetView() {
    this.pointer.set(0, 0);
    this.pointerSmooth.set(0, 0);
  }

  renderFrame(delta = 0) {
    this.composer.render(delta);
    this.vision.update(this.hero, this.camera, this.time, this.physics.impactPulse);
    if (this.vision.root.visible) {
      this.renderOcclusionDepth();
      this.vision.render(this.renderer, this.camera);
    }
  }

  renderOcclusionDepth() {
    // Postprocessing outputs color only. Rebuild cell depth on the screen so
    // the sharp analysis overlay remains inside the same 3D space as the cells.
    const autoClear = this.renderer.autoClear;
    const background = this.scene.background;
    const overrideMaterial = this.scene.overrideMaterial;
    const dustVisible = this.dust.visible;
    this.renderer.autoClear = false;
    this.scene.background = null;
    this.scene.overrideMaterial = this.occlusionMaterial;
    this.dust.visible = false;
    try {
      this.renderer.setRenderTarget(null);
      this.renderer.clearDepth();
      this.renderer.render(this.scene, this.camera);
    } finally {
      this.renderer.autoClear = autoClear;
      this.scene.background = background;
      this.scene.overrideMaterial = overrideMaterial;
      this.dust.visible = dustVisible;
    }
  }

  capture() {
    this.renderFrame();
    return new Promise((resolve) => this.renderer.domElement.toBlob(resolve, 'image/png'));
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.physics.dispose();
    this.vision.dispose();
    removeEventListener('resize', this.onResize);
    removeEventListener('pointermove', this.onPointer);
    document.removeEventListener('pointerleave', this.onLeave);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
    [this.geometry, this.heroGeometry, this.smallGeometry, this.dustGeometry].forEach((g) => g.dispose());
    [this.material, this.smallMaterial, this.dustMaterial, this.occlusionMaterial].forEach((m) => m.dispose());
    [this.cells, this.smallCells].forEach((mesh) => mesh.dispose());
    [this.bokeh, this.bloom, this.grade, this.output].forEach((pass) => pass.dispose());
    this.composer.dispose();
    this.environmentTarget.dispose();
    this.membrane.dispose();
    this.backgroundTexture.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
