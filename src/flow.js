import { MathUtils } from 'three';
import { seededRandom } from './geometry.js';

export const CAMERA_DEPTH = 16;

/** Stratified screen regions with a different, deterministic trajectory per cell. */
export function createStreamLane(index) {
  const random = seededRandom(index * 607 + 1049);
  const quadrant = index % 4;
  const sx = quadrant < 2 ? 1 : -1;
  const sy = quadrant % 2 === 0 ? 1 : -1;
  return {
    coverage: ((index * 7) % 10 + 0.5) / 10,
    outerX: sx * (0.4 + random() * 0.43),
    outerY: sy * (0.4 + random() * 0.43),
    innerX: (random() - 0.5) * 1.05,
    innerY: (random() - 0.5) * 1.05,
    phase: random() * Math.PI * 2,
    frequency: 0.7 + random() * 0.6,
  };
}

export function frustumAtDepth(camera, aspect, z) {
  const tangent = Math.tan(MathUtils.degToRad(camera.fov) / 2) / camera.zoom;
  const height = Math.max(1.5, CAMERA_DEPTH - z) * tangent;
  return { width: height * aspect, height, tangent };
}

export function sampleStreamLane(lane, time, flow, outer) {
  const chaos = flow.chaos;
  const phase = lane.phase;
  const t = time * lane.frequency;
  const width = MathUtils.clamp(0.85 + (flow.spread - 1) * 0.15, 0.75, 1.05);
  const x = outer ? lane.outerX : lane.innerX;
  const y = outer ? lane.outerY : lane.innerY;
  return {
    x: width * x + chaos * (Math.sin(t * 0.24 + phase) * 0.115 + Math.sin(t * 0.51 + phase * 2) * 0.045),
    y: width * y + chaos * (Math.cos(t * 0.21 + phase) * 0.11 + Math.sin(t * 0.43 + phase * 3) * 0.04),
    dx: chaos * lane.frequency * (Math.cos(t * 0.24 + phase) * 0.115 * 0.24 + Math.cos(t * 0.51 + phase * 2) * 0.045 * 0.51),
    dy: chaos * lane.frequency * (-Math.sin(t * 0.21 + phase) * 0.11 * 0.21 + Math.cos(t * 0.43 + phase * 3) * 0.04 * 0.43),
  };
}
