import * as THREE from 'three';
import { seededRandom } from './geometry.js';

const MAX_MARKERS = 16;
const MAX_GLYPHS = 700;
const signed = (value) => `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(2)}`;

class Lines {
  constructor(capacity, color, opacity) {
    this.data = new Float32Array(capacity * 6);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.data, 3).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: true, depthWrite: false, toneMapped: false });
    this.object = new THREE.LineSegments(this.geometry, this.material);
    this.object.frustumCulled = false;
    this.count = 0;
  }
  clear() { this.count = 0; }
  segment(x1, y1, x2, y2, z = 0) {
    const i = this.count * 6;
    if (i + 6 > this.data.length) return;
    this.data.set([x1, y1, z, x2, y2, z], i);
    this.count++;
  }
  commit() {
    this.geometry.setDrawRange(0, this.count * 2);
    this.geometry.attributes.position.needsUpdate = true;
  }
}

function makeGlyphs() {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ+-./:_%()[]?';
  const cols = 16;
  const rows = Math.ceil(chars.length / cols);
  const canvas = document.createElement('canvas');
  canvas.width = cols * 32;
  canvas.height = rows * 64;
  const context = canvas.getContext('2d');
  context.font = '600 48px "Courier New", monospace';
  context.textAlign = 'center';
  context.fillStyle = '#ffffff';
  for (let i = 0; i < chars.length; i++) context.fillText(chars[i], i % cols * 32 + 16, Math.floor(i / cols) * 64 + 48);
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const positions = new Float32Array(MAX_GLYPHS * 12);
  const uvs = new Float32Array(MAX_GLYPHS * 8);
  const indices = new Uint16Array(MAX_GLYPHS * 6);
  for (let i = 0; i < MAX_GLYPHS; i++) indices.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2).setUsage(THREE.DynamicDrawUsage));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  const material = new THREE.MeshBasicMaterial({ map: texture, color: '#c2d2d5', transparent: true, opacity: 0.7,
    depthTest: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return { chars, cols, rows, positions, uvs, geometry, material, mesh, texture, count: 0 };
}

/** A real perspective plane sharing the cell's pose, drawn crisply after lens effects. */
export class VisionOverlay {
  constructor(settings) {
    this.settings = settings;
    this.scene = new THREE.Scene();
    this.root = new THREE.Group();
    this.plane = new THREE.Group();
    this.scene.add(this.root);
    this.root.add(this.plane);
    this.random = seededRandom(513);
    this.nodes = [];
    this.analysisTime = 0;
    this.lastTime = 0;
    this.cameraLocal = new THREE.Vector3();
    this.inverse = new THREE.Quaternion();
    this.euler = new THREE.Euler();
    this.dummy = new THREE.Object3D();
    this.front = 1;
    this.frame = new Lines(700, settings.vision.color, 0.4);
    this.ticks = new Lines(250, settings.vision.color, 0.65);
    this.links = new Lines(60, settings.vision.color, 0.2);
    this.markers = new Lines(MAX_MARKERS * 12, settings.vision.color, 0.8);
    this.scan = new Lines(6, settings.vision.color, 0.3);
    this.links.object.renderOrder = 1;
    this.scan.object.renderOrder = 1;
    this.markers.object.renderOrder = 4;
    this.glyphs = makeGlyphs();
    this.cards = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      color: settings.vision.backgroundColor, transparent: true, opacity: 0.38, depthTest: true, depthWrite: false,
      side: THREE.DoubleSide, toneMapped: false,
    }), MAX_MARKERS);
    this.cards.frustumCulled = false;
    this.cards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cards.renderOrder = 3;
    this.plane.add(this.frame.object, this.ticks.object, this.links.object, this.scan.object,
      this.cards, this.markers.object, this.glyphs.mesh);
    this.sync();
  }

  target(index) {
    const radius = (0.4 + this.random() * 0.5) * this.settings.cell.radius;
    const sector = Math.PI * 2 / this.settings.vision.markers;
    const angle = index * sector + (this.random() - 0.5) * sector * 0.8;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  }

  sync() {
    const { vision, cell } = this.settings;
    this.half = cell.radius * vision.margin;
    this.frame.clear();
    this.ticks.clear();
    const h = this.half;
    const dash = h / 65;
    // Dotted bounds and fine measuring scales, with every fifth tick longer.
    for (let x = -h; x < h; x += dash * 3) {
      this.frame.segment(x, h, Math.min(x + dash, h), h);
      this.frame.segment(x, -h, Math.min(x + dash, h), -h);
    }
    for (let y = -h; y < h; y += dash * 4) {
      this.frame.segment(-h, y, -h, Math.min(y + dash, h));
      this.frame.segment(h, y, h, Math.min(y + dash, h));
    }
    for (let i = 0; i <= vision.ticks; i++) {
      const x = -h + i / vision.ticks * h * 2;
      const length = h * (i % 10 === 0 ? 0.055 : i % 5 === 0 ? 0.033 : 0.015);
      this.ticks.segment(x, h, x, h + length);
      this.ticks.segment(x, -h, x, -h - length);
    }
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      this.ticks.segment(sx * h, sy * h, sx * (h - h * 0.085), sy * h);
      this.ticks.segment(sx * h, sy * h, sx * h, sy * (h - h * 0.085));
    }
    this.frame.commit();
    this.ticks.commit();
    this.surfaceDepth = 0;
    for (let j = 0; j <= 64; j++) {
      const phi = j / 64 * Math.PI / 2;
      const r2 = Math.sin(phi) ** 2;
      const profile = 1 - cell.dent + cell.dent * ((2.2 + cell.rim * 0.9) * r2 - (0.8 + cell.rim * 0.5) * r2 * r2);
      this.surfaceDepth = Math.max(this.surfaceDepth, cell.thickness * Math.cos(phi) * profile);
    }
    this.surfaceDepth *= 1 + cell.asymmetry;
    if (this.nodes.length !== vision.markers) {
      this.nodes = Array.from({ length: vision.markers }, (_, i) => {
        const angle = i / vision.markers * Math.PI * 2 + 0.1;
        const initial = { x: Math.cos(angle) * cell.radius * 0.68, y: Math.sin(angle) * cell.radius * 0.68 };
        return { ...initial, from: { ...initial }, to: this.target(i), start: this.analysisTime, duration: 2 + this.random() * 3, phase: this.random() * 6.28 };
      });
    } else if (this.nodeRadius && this.nodeRadius !== cell.radius) {
      const ratio = cell.radius / this.nodeRadius;
      for (const node of this.nodes) {
        node.x *= ratio;
        node.y *= ratio;
        node.from.x *= ratio;
        node.from.y *= ratio;
        node.to.x *= ratio;
        node.to.y *= ratio;
      }
    }
    this.nodeRadius = cell.radius;
    for (const lines of [this.frame, this.ticks, this.links, this.markers, this.scan]) lines.material.color.set(vision.color);
    this.glyphs.material.color.set(vision.textColor);
    this.cards.material.color.set(vision.backgroundColor);
    this.root.visible = vision.enabled;
  }

  text(text, x, y, size) {
    const g = this.glyphs;
    const advance = size * 0.6;
    for (const character of text) {
      if (character !== ' ' && g.count < MAX_GLYPHS) {
        const code = Math.max(0, g.chars.indexOf(character));
        const i = g.count++;
        const width = size * 0.6;
        g.positions.set([x, y, 0.004, x + width, y, 0.004, x + width, y + size, 0.004, x, y + size, 0.004], i * 12);
        const u0 = code % g.cols / g.cols;
        const u1 = u0 + 1 / g.cols;
        const v1 = 1 - Math.floor(code / g.cols) / g.rows;
        const v0 = v1 - 1 / g.rows;
        g.uvs.set([u0, v0, u1, v0, u1, v1, u0, v1], i * 8);
      }
      x += advance;
    }
    return text.length * advance;
  }

  update(hero, camera, time, impactPulse) {
    const { vision, cell } = this.settings;
    this.analysisTime += Math.max(0, time - this.lastTime) * vision.speed;
    this.lastTime = time;
    this.root.visible = vision.enabled;
    if (!vision.enabled) return;
    this.root.position.copy(hero.position);
    this.root.quaternion.copy(hero.quaternion);
    this.root.scale.copy(hero.scale);
    this.inverse.copy(hero.quaternion).invert();
    this.cameraLocal.copy(camera.position).sub(hero.position).applyQuaternion(this.inverse);
    if (Math.abs(this.cameraLocal.z) > 0.3) this.front = Math.sign(this.cameraLocal.z);
    this.plane.position.z = this.front * (this.surfaceDepth + vision.offset);
    this.plane.rotation.y = this.front < 0 ? Math.PI : 0;

    const t = this.analysisTime;
    const alpha = Math.min(1, vision.opacity + impactPulse * 0.2);
    this.frame.material.opacity = alpha * 0.27;
    this.ticks.material.opacity = alpha * 0.72;
    this.markers.material.opacity = alpha * 0.95;
    this.links.material.opacity = alpha * vision.links;
    this.scan.material.opacity = alpha * 0.33;
    this.glyphs.material.opacity = alpha;
    this.cards.material.opacity = alpha * vision.backgroundOpacity;
    this.markers.clear();
    this.links.clear();
    this.scan.clear();
    this.glyphs.count = 0;
    this.cards.count = vision.labels ? this.nodes.length : 0;
    const radius = cell.radius;
    const markerHalf = vision.fontSize * 0.67;
    const arm = markerHalf * 0.52;
    const valueTime = Math.floor(t * 9) / 9;
    const labels = [];
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      if (t - node.start >= node.duration) {
        node.from = { x: node.x, y: node.y };
        node.to = this.target(i);
        node.start = t;
        node.duration = 2 + this.random() * 3;
      }
      const blend = THREE.MathUtils.smoothstep(t - node.start, 0, node.duration);
      node.x = THREE.MathUtils.lerp(node.from.x, node.to.x, blend);
      node.y = THREE.MathUtils.lerp(node.from.y, node.to.y, blend);
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        const x = node.x + markerHalf * sx;
        const y = node.y + markerHalf * sy;
        this.markers.segment(x, y, x - arm * sx, y);
        this.markers.segment(x, y, x, y - arm * sy);
      }
      if (vision.labels) {
        const label = `${String(i + 1).padStart(2, '0')} ${signed(node.x / radius)} ${signed(node.y / radius)} ${signed(Math.sin(valueTime * 0.7 + node.phase) * 0.18)}`;
        const width = label.length * vision.fontSize * 0.6;
        const x = THREE.MathUtils.clamp(node.x + markerHalf * 1.6, -this.half + 0.04, this.half - width - 0.04);
        const preferredY = Math.min(this.half - vision.fontSize, node.y + markerHalf * 1.3);
        let y = preferredY;
        for (let attempt = 0; attempt < 16; attempt++) {
          if (!labels.some((label) => x < label.x + label.width + 0.025 && x + width + 0.025 > label.x
            && y < label.y + vision.fontSize * 1.2 && y + vision.fontSize * 1.2 > label.y)) break;
          const shift = Math.ceil((attempt + 1) / 2) * vision.fontSize * 1.55 * (attempt % 2 ? -1 : 1);
          y = THREE.MathUtils.clamp(preferredY + shift, -this.half + 0.04, this.half - vision.fontSize - 0.04);
        }
        labels.push({ x, y, width });
        if (Math.abs(y - preferredY) > 0.01) this.links.segment(node.x, node.y, x, y + vision.fontSize * 0.5);
        this.text(label, x, y, vision.fontSize);
        this.dummy.position.set(x + width / 2, y + vision.fontSize * 0.5, 0.002);
        this.dummy.quaternion.identity();
        this.dummy.scale.set(width + 0.035, vision.fontSize, 1);
        this.dummy.updateMatrix();
        this.cards.setMatrixAt(i, this.dummy.matrix);
      }
    }
    const edges = new Set();
    for (let i = 0; i < this.nodes.length; i++) {
      const a = this.nodes[i];
      const nearest = this.nodes.map((b, index) => ({ index, distance: Math.hypot(a.x - b.x, a.y - b.y) }))
        .filter((b) => b.index !== i).sort((a, b) => a.distance - b.distance).slice(0, 2);
      for (const item of nearest) {
        const key = `${Math.min(i, item.index)}:${Math.max(i, item.index)}`;
        if (edges.has(key)) continue;
        edges.add(key);
        const b = this.nodes[item.index];
        this.links.segment(a.x, a.y, b.x, b.y);
      }
    }
    if (vision.scan) {
      const y = Math.sin(t * 0.8) * radius;
      const half = Math.sqrt(Math.max(0, radius * radius - y * y));
      this.scan.segment(-half, y, half, y);
      this.scan.segment(-half * 0.98, y + 0.017, half * 0.98, y + 0.017);
    }
    this.euler.setFromQuaternion(hero.quaternion, 'YXZ');
    const orbit = signed(THREE.MathUtils.radToDeg(this.euler.y));
    this.text(`MEMBRANE 01 / ORBIT ${orbit}`, -this.half, this.half + 0.12, vision.fontSize * 0.83);
    this.text(`${String(Math.floor(time * 24)).padStart(6, '0')} FRAMES  ${String(this.nodes.length).padStart(2, '0')} PTS`, -this.half, -this.half - 0.19, vision.fontSize * 0.83);
    const status = impactPulse > 0.15 ? 'IMPACT / TRACKING' : 'LIVE / TRACKING';
    this.text(status, this.half - status.length * vision.fontSize * 0.6 * 0.75, -this.half - 0.19, vision.fontSize * 0.75);
    this.markers.commit();
    this.links.commit();
    this.scan.commit();
    this.glyphs.geometry.setDrawRange(0, this.glyphs.count * 6);
    this.glyphs.geometry.attributes.position.needsUpdate = true;
    this.glyphs.geometry.attributes.uv.needsUpdate = true;
    this.cards.instanceMatrix.needsUpdate = true;
  }

  render(renderer, camera) {
    if (!this.root.visible) return;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    try {
      renderer.render(this.scene, camera);
    } finally { renderer.autoClear = autoClear; }
  }

  dispose() {
    const geometries = new Set();
    const materials = new Set();
    this.scene.traverse((node) => {
      if (node.geometry) geometries.add(node.geometry);
      if (node.material) materials.add(node.material);
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    this.glyphs.texture.dispose();
    this.cards.dispose();
  }
}
