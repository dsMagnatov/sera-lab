import assert from 'node:assert/strict';
import { test, before } from 'node:test';
import { CellPhysics, initializePhysics, FIXED_STEP, ENTRY_DEPTH, EXIT_DEPTH, depthScale } from '../src/physics.js';
import { createSettings } from '../src/settings.js';
import { seededRandom } from '../src/geometry.js';
import { createStreamLane, frustumAtDepth } from '../src/flow.js';

before(initializePhysics);

function cell(patch = {}) {
  return { x: 0, y: 4, z: -8, rx: 0, ry: 0, rz: 0,
    scale: 1, phase: 0, pace: 1, tint: 0.5, ...patch };
}

function isolated(cells) {
  const settings = createSettings();
  settings.flow.speed = 0;
  settings.flow.rotation = 0;
  settings.physics.drag = 0;
  settings.physics.friction = 0;
  settings.physics.restitution = 0.8;
  return new CellPhysics(settings, cells, []);
}

test('head-on cells exchange momentum and separate', () => {
  const sim = isolated([cell({ x: -2.5 }), cell({ x: 2.5 })]);
  try {
    sim.cells[0].body.setLinvel({ x: 2, y: 0, z: 0 }, true);
    sim.cells[1].body.setLinvel({ x: -2, y: 0, z: 0 }, true);
    for (let i = 0; i < 135; i++) sim.tick();
    assert.ok(sim.cells[0].body.linvel().x < -1, 'left cell must bounce back');
    assert.ok(sim.cells[1].body.linvel().x > 1, 'right cell must bounce back');
    assert.ok(sim.cells[1].body.translation().x - sim.cells[0].body.translation().x > 2.8);
  } finally { sim.dispose(); }
});

test('glancing collisions create rotation', () => {
  const sim = isolated([cell({ x: -2.5, y: 4.4 }), cell({ x: 2.5, y: 3.6 })]);
  try {
    sim.settings.physics.friction = 0.4;
    sim.sync('physics.friction');
    sim.cells[0].body.setLinvel({ x: 2.5, y: 0, z: 0 }, true);
    sim.cells[1].body.setLinvel({ x: -2.5, y: 0, z: 0 }, true);
    let spin = 0;
    for (let i = 0; i < 120; i++) {
      sim.tick();
      const w = sim.cells[0].body.angvel();
      spin = Math.max(spin, Math.hypot(w.x, w.y, w.z));
    }
    assert.ok(spin > 0.05, 'an off-center impact must create angular velocity');
  } finally { sim.dispose(); }
});

test('an untouched central cell stays still, including with legacy motion settings', () => {
  const settings = createSettings();
  settings.flow.heroMotion = 1.5;
  settings.physics.heroSpin = 0.35;
  const sim = new CellPhysics(settings, [], []);
  try {
    const initial = sim.hero.body.rotation();
    const position = sim.hero.body.translation();
    assert.equal(position.x, 0);
    assert.equal(position.y, 0);
    for (let i = 0; i < 1350; i++) sim.tick();
    assert.deepEqual(sim.hero.body.translation(), position);
    assert.deepEqual(sim.hero.body.rotation(), initial);
    const v = sim.hero.body.linvel();
    const w = sim.hero.body.angvel();
    assert.equal(Math.hypot(v.x, v.y, v.z, w.x, w.y, w.z), 0);
  } finally { sim.dispose(); }
});

test('the central cell reacts to impact and returns to its resting position and orientation', () => {
  const settings = createSettings();
  const sim = new CellPhysics(settings, [cell({ x: 0.45, y: 0.22, z: -2.5, scale: 0.7, rx: 0.2, ry: 0.3 })], []);
  try {
    const initial = sim.hero.body.rotation();
    const position = sim.hero.body.translation();
    let contacts = 0;
    let lateralVelocity = 0;
    let displacement = 0;
    let rotationChange = 0;
    for (let i = 0; i < 1350; i++) {
      sim.tick();
      sim.world.contactPair(sim.hero.collider, sim.cells[0].collider, (manifold) => {
        if (manifold.numSolverContacts() > 0) contacts++;
      });
      const v = sim.cells[0].body.linvel();
      lateralVelocity = Math.max(lateralVelocity, Math.hypot(v.x, v.y));
      const p = sim.hero.body.translation();
      const q = sim.hero.body.rotation();
      displacement = Math.max(displacement, Math.hypot(p.x - position.x, p.y - position.y, p.z - position.z));
      rotationChange = Math.max(rotationChange, Math.hypot(q.x - initial.x, q.y - initial.y, q.z - initial.z));
    }
    const p = sim.hero.body.translation();
    const q = sim.hero.body.rotation();
    assert.ok(displacement > 0.002, 'the impact must move the central cell');
    assert.ok(rotationChange > 0.002, 'an off-center impact must tilt the central cell');
    assert.ok(contacts > 0, 'incoming cell must hit the central collider');
    assert.ok(lateralVelocity > 0.4, 'impact must push the incoming cell sideways');
    assert.ok(Math.hypot(p.x - position.x, p.y - position.y, p.z - position.z) < 0.0002);
    assert.ok(Math.hypot(q.x - initial.x, q.y - initial.y, q.z - initial.z) < 0.0002);
  } finally { sim.dispose(); }
});

test('material changes do not snap an impact reaction back to rest', () => {
  const sim = new CellPhysics(createSettings(), [], []);
  try {
    sim.hero.body.setLinvel({ x: 0.3, y: 0.1, z: 0.2 }, true);
    sim.hero.body.setAngvel({ x: 0.1, y: 0.2, z: 0.1 }, true);
    for (let i = 0; i < 10; i++) sim.tick();
    const before = sim.hero.body.translation();
    sim.sync('cell.roughness');
    assert.deepEqual(sim.hero.body.translation(), before);
    const v = sim.hero.body.linvel();
    assert.ok(Math.hypot(v.x, v.y, v.z) > 0.05);
  } finally { sim.dispose(); }
});

test('CCD catches a fast cell hitting the central membrane', () => {
  const sim = isolated([cell({ x: 0, y: 0, z: -8, scale: 0.7 })]);
  try {
    sim.settings.flow.heroTiltX = 0;
    sim.settings.flow.heroTiltY = 0;
    sim.settings.flow.heroTiltZ = 0;
    sim.sync('flow.heroTiltX');
    sim.cells[0].body.setLinvel({ x: 0, y: 0, z: 90 }, true);
    let reversed = false;
    for (let i = 0; i < 25; i++) {
      sim.tick();
      if (sim.cells[0].body.linvel().z < -10) reversed = true;
    }
    assert.ok(reversed, 'fast cell must bounce instead of tunneling through the hero');
  } finally { sim.dispose(); }
});

test('cells recycle behind the camera and grow smoothly from the far plane', () => {
  const sim = isolated([cell({ z: 11 })]);
  try {
    sim.tick();
    assert.equal(sim.recycleCount, 0, 'the old visible recycle plane must not reset cells');
    sim.cells[0].body.setTranslation({ x: 0, y: 4, z: EXIT_DEPTH + 5 }, true);
    sim.tick();
    sim.step(FIXED_STEP / 2);
    assert.equal(sim.recycleCount, 1);
    assert.ok(sim.cells[0].rendered.position.z < ENTRY_DEPTH, 'interpolation must not sweep a recycled cell through the scene');
    assert.equal(depthScale(sim.cells[0].rendered.position.z), 0);
    let previous = 0;
    for (let z = ENTRY_DEPTH; z <= -20; z += 0.1) {
      const scale = depthScale(z);
      assert.ok(scale >= previous && scale - previous < 0.008);
      previous = scale;
    }
    assert.equal(depthScale(-20), 1);
  } finally { sim.dispose(); }
});

test('fixed-step simulation gives the same result at 60 and 144 fps', () => {
  const settings = createSettings();
  const a = new CellPhysics(settings, [cell()], []);
  const b = new CellPhysics(structuredClone(settings), [cell()], []);
  try {
    for (let i = 0; i < 180; i++) a.step(1 / 60);
    for (let i = 0; i < 432; i++) b.step(1 / 144);
    assert.ok(Math.abs(a.time - b.time) < 1e-9);
    const pa = a.cells[0].body.translation();
    const pb = b.cells[0].body.translation();
    assert.ok(Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z) < 1e-5);
  } finally { a.dispose(); b.dispose(); }
});

test('the collision toggle lets cells pass through each other', () => {
  const sim = isolated([cell({ x: -2.5 }), cell({ x: 2.5 })]);
  try {
    sim.settings.physics.enabled = false;
    sim.sync('physics.enabled');
    sim.cells[0].body.setLinvel({ x: 3, y: 0, z: 0 }, true);
    sim.cells[1].body.setLinvel({ x: -3, y: 0, z: 0 }, true);
    for (let i = 0; i < 180; i++) sim.tick();
    assert.ok(sim.cells[0].body.translation().x > sim.cells[1].body.translation().x);
  } finally { sim.dispose(); }
});

test('impact sensitivity increases the actual collision reaction without idle motion', () => {
  function peak(gain) {
    const settings = createSettings();
    settings.physics.heroImpact = gain;
    settings.physics.heroTargeting = 0;
    const sim = new CellPhysics(settings, [cell({ x: 0.45, y: 0.22, z: -2.5, scale: 0.9, rx: 0.2, ry: 0.3 })], []);
    try {
      let maximum = 0;
      for (let i = 0; i < 600; i++) {
        sim.tick();
        const p = sim.hero.body.translation();
        maximum = Math.max(maximum, Math.hypot(p.x, p.y, p.z - 1.8));
      }
      assert.ok(sim.heroHitCount > 0);
      return maximum;
    } finally { sim.dispose(); }
  }
  const normal = peak(1);
  const stronger = peak(4.2);
  assert.ok(stronger > normal * 2.5, 'higher sensitivity must produce a visibly larger deflection');
});

test('directed streamlines increase central hits even in a wide turbulent flow', () => {
  const random = seededRandom(821);
  const cells = Array.from({ length: 36 }, () => cell({
    x: (random() - 0.5) * 22, y: (random() - 0.5) * 14, z: -5 - random() * 35,
    rx: random() * 3, ry: random() * 3, rz: random() * 3,
    scale: 0.6 + random() * 0.6, phase: random() * 6.28,
    pace: 0.65 + random() * 0.65, tint: random(),
  }));
  function hits(targeting) {
    const settings = createSettings();
    settings.flow.spread = 1.8;
    settings.flow.turbulence = 2;
    settings.physics.heroTargeting = targeting;
    settings.physics.heroImpact = 1;
    const sim = new CellPhysics(settings, structuredClone(cells), []);
    try {
      for (let i = 0; i < 5400; i++) sim.tick();
      return sim.heroLargeHitCount;
    } finally { sim.dispose(); }
  }
  const normal = hits(0);
  const directed = hits(0.85);
  assert.ok(directed >= 20 && directed > normal * 2, 'the aimed stream must cause more real contacts');
});

test('the full frame stays populated while cells keep hitting the centre', () => {
  const random = seededRandom(821);
  const settings = createSettings();
  settings.flow.spread = 1.8;
  settings.flow.turbulence = 2;
  const cells = Array.from({ length: 46 }, (_, index) => cell({
    x: (random() - 0.5) * 25, y: (random() - 0.5) * 16, z: -5 - random() * 35,
    rx: random() * 3, ry: random() * 3, rz: random() * 3,
    scale: 0.5 + random() * 0.7, phase: random() * 6.28,
    pace: 0.65 + random() * 0.65, tint: random(), lane: createStreamLane(index),
  }));
  const aspect = 1.57;
  const sim = new CellPhysics(settings, cells, [], aspect);
  try {
    sim.distribute();
    const total = [0, 0, 0, 0];
    const empty = [0, 0, 0, 0];
    let samples = 0;
    let central = 0;
    for (let step = 0; step < 5400; step++) {
      sim.tick();
      if (step % 45 !== 0) continue;
      const counts = [0, 0, 0, 0];
      for (const record of sim.cells) {
        const p = record.body.translation();
        assert.ok([p.x, p.y, p.z].every(Number.isFinite));
        if (p.z < -36 || p.z > 9) continue;
        const frame = frustumAtDepth(settings.camera, aspect, p.z);
        const x = p.x / frame.width;
        const y = p.y / frame.height;
        if (Math.abs(x) < 0.3 && Math.abs(y) < 0.3) central++;
        if (Math.abs(x) > 0.25 && Math.abs(y) > 0.25 && Math.abs(x) < 1.12 && Math.abs(y) < 1.12) {
          counts[(x > 0 ? 0 : 2) + (y > 0 ? 0 : 1)]++;
        }
      }
      counts.forEach((count, quadrant) => {
        total[quadrant] += count;
        if (count === 0) empty[quadrant]++;
      });
      samples++;
    }
    total.forEach((count, quadrant) => {
      assert.ok(count / samples > 2, `quadrant ${quadrant} must retain multiple visible cells`);
      assert.ok(empty[quadrant] / samples < 0.2, `quadrant ${quadrant} must rarely be empty`);
    });
    assert.ok(central / samples > 2, 'the middle of the scene must remain populated');
    assert.ok(sim.heroLargeHitCount > 15, 'the central cell must still receive frequent impacts');
  } finally { sim.dispose(); }
});
