import RAPIER from '@dimforge/rapier3d-compat';
import { Euler, Quaternion, Vector3, MathUtils } from 'three';
import { seededRandom } from './geometry.js';
import { frustumAtDepth, sampleStreamLane } from './flow.js';

export const FIXED_STEP = 1 / 90;
export const ENTRY_DEPTH = -56;
export const EXIT_DEPTH = 20;
let ready;
export function initializePhysics() { return ready ??= RAPIER.init(); }

export function depthScale(z, distance = 22) {
  return MathUtils.smoothstep(z, ENTRY_DEPTH, ENTRY_DEPTH + distance);
}

// The convex envelope of the same disc profile used by the visible membrane.
// A low-resolution hull keeps actual disc-on-disc contact affordable.
export function colliderVertices(cell, scale) {
  const vertices = [];
  for (let j = 0; j <= 8; j++) {
    const phi = j / 8 * Math.PI;
    const r = Math.sin(phi);
    const r2 = r * r;
    const profile = 1 - cell.dent
      + cell.dent * ((2.2 + cell.rim * 0.9) * r2 - (0.8 + cell.rim * 0.5) * r2 * r2);
    const z = cell.thickness * Math.cos(phi) * profile * scale;
    const count = j === 0 || j === 8 ? 1 : 16;
    for (let i = 0; i < count; i++) {
      const theta = i / count * Math.PI * 2;
      const organic = cell.asymmetry * (
        0.46 * Math.sin(theta * 3 + 0.4)
        + 0.26 * Math.cos(theta * 5 - phi * 2)
        + 0.18 * Math.sin(theta * 9 + phi * 3));
      const radius = cell.radius * r * (1 + organic * r) * scale;
      vertices.push(radius * Math.cos(theta), radius * Math.sin(theta),
        z * (1 + organic * 0.6) + cell.asymmetry * 0.16 * r2 * Math.sin(theta * 4 + phi * 2) * scale);
    }
  }
  return new Float32Array(vertices);
}

function pose() {
  return { position: new Vector3(), rotation: new Quaternion() };
}

function readPose(record, target) {
  const p = record.body.translation();
  const q = record.body.rotation();
  target.position.set(p.x, p.y, p.z);
  target.rotation.set(q.x, q.y, q.z, q.w);
}

export class CellPhysics {
  constructor(settings, cellData, smallData, aspect = 16 / 9) {
    this.settings = settings;
    this.aspect = aspect;
    this.random = seededRandom(1938);
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    this.world.timestep = FIXED_STEP;
    this.world.numSolverIterations = 6;
    this.world.maxCcdSubsteps = 4;
    this.events = new RAPIER.EventQueue(true);
    this.colliderRecords = new Map();
    this.accumulator = 0;
    this.time = 0;
    this.recycleCount = 0;
    this.heroHitCount = 0;
    this.heroLargeHitCount = 0;
    this.impactPulse = 0;
    this.heroRestRotation = new Quaternion();
    this.heroRotationError = new Quaternion();
    this.heroInverseRotation = new Quaternion();
    this.lastSpread = settings.flow.spread;
    this.hero = this.createBody({ x: 0, y: 0, z: 1.8, phase: 0, pace: 1 }, 'hero');
    this.cells = cellData.map((data, index) => this.createBody(data, 'cell', index));
    this.smallCells = smallData.map((data, index) => this.createBody(data, 'small', index));
    this.records = [...this.cells, ...this.smallCells];
    this.sync('all');
    this.records.forEach((record) => {
      this.setFlowVelocity(record);
      this.snap(record);
    });
  }

  createBody(data, kind, index = 0) {
    const isHero = kind === 'hero';
    const rotation = new Quaternion().setFromEuler(new Euler(data.rx ?? data.phase, data.ry ?? data.phase * 0.7, data.rz ?? data.phase));
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(data.x * this.settings.flow.spread, data.y * this.settings.flow.spread, data.z)
      .setRotation(rotation).setCanSleep(false).setCcdEnabled(true)
      .setAngularDamping(isHero ? 0 : 0.22).setLinearDamping(0);
    const body = this.world.createRigidBody(desc);
    const record = {
      body, data, kind, collider: null, active: true, scale: 1, colliderScale: 0,
      previous: pose(), current: pose(), rendered: pose(),
      aimSeed: seededRandom(index * 119 + 37)(), hasHitHero: false,
      aimOffset: { x: Math.cos(data.phase * 1.7) * 0.95, y: Math.sin(data.phase * 1.7) * 0.7 },
      targetHero: false, lastHit: -10,
      passedHero: Boolean(data.lane) && data.z > 3.3,
    };
    return record;
  }

  snap(record) {
    readPose(record, record.current);
    record.previous.position.copy(record.current.position);
    record.previous.rotation.copy(record.current.rotation);
    record.rendered.position.copy(record.current.position);
    record.rendered.rotation.copy(record.current.rotation);
  }

  isPeripheral(record) {
    return Boolean(record.data.lane) && record.data.lane.coverage < this.settings.flow.edgeCoverage;
  }

  setAspect(aspect) { this.aspect = aspect; }

  distribute() {
    for (const record of this.records) {
      if (!record.data.lane || !record.active) continue;
      const p = record.body.translation();
      const position = this.streamPosition(record, p.z);
      record.body.setTranslation(position, true);
      this.setFlowVelocity(record);
      this.snap(record);
    }
  }

  streamPosition(record, z) {
    const { flow, camera, cell } = this.settings;
    if (record.targetHero && z < this.heroAnchor.z - 1) {
      const angle = MathUtils.degToRad(flow.direction);
      const distance = this.heroAnchor.z - z;
      return { x: this.heroAnchor.x + record.aimOffset.x - Math.cos(angle) * distance * 0.09,
        y: this.heroAnchor.y + record.aimOffset.y - Math.sin(angle) * distance * 0.09, z };
    }
    const lane = sampleStreamLane(record.data.lane, this.time, flow, this.isPeripheral(record) || record.hasHitHero || record.passedHero);
    const frustum = frustumAtDepth(camera, this.aspect, z);
    const peel = MathUtils.smoothstep(z, 2, 12) * cell.radius * record.scale * 1.35;
    return { x: lane.x * frustum.width + Math.sign(record.data.lane.outerX) * peel,
      y: lane.y * frustum.height + Math.sign(record.data.lane.outerY) * peel, z };
  }

  scaleFor(record) {
    const { flow, particles } = this.settings;
    if (record.kind === 'hero') return flow.heroScale;
    if (record.kind === 'small') return record.data.scale * particles.smallSize;
    return record.data.scale * (1 + (record.data.tint - 0.5) * flow.sizeVariation);
  }

  updateShape(record, scale) {
    const points = colliderVertices(this.settings.cell, Math.max(Math.min(record.scale, 0.015), scale));
    if (record.collider) record.collider.setShape(new RAPIER.ConvexPolyhedron(points));
    else {
      const desc = RAPIER.ColliderDesc.convexHull(points);
      if (!desc) throw new Error('Could not create a cell collision hull');
      record.collider = this.world.createCollider(desc, record.body);
      this.colliderRecords.set(record.collider.handle, record);
      if (record.kind === 'hero') record.collider.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    }
    record.colliderScale = scale;
    record.collider.setMass(record.kind === 'hero'
      ? this.settings.physics.heroMass : Math.max(0.003, Math.pow(scale, 3)));
    record.collider.setContactSkin(Math.min(0.012, this.settings.cell.radius * scale * 0.008));
    this.applyContactSettings(record);
  }

  applyContactSettings(record) {
    const { physics } = this.settings;
    record.collider.setRestitution(physics.restitution);
    record.collider.setFriction(physics.friction);
    record.collider.setSensor(!physics.enabled || (record.kind === 'hero' && !physics.heroCollisions));
  }

  sync(path) {
    const { flow, physics } = this.settings;
    const shapeChanged = path === 'all' || ['cell.radius', 'cell.thickness', 'cell.dent', 'cell.rim', 'cell.asymmetry', 'flow.heroScale', 'flow.sizeVariation', 'particles.smallSize'].includes(path);
    const spreadRatio = flow.spread / this.lastSpread;
    const all = [this.hero, ...this.records];
    for (const record of all) {
      const enabled = record.kind === 'hero' || (!flow.single && (record.kind === 'cell'
        ? this.cells.indexOf(record) < flow.count : this.smallCells.indexOf(record) < this.settings.particles.smallCount));
      if (enabled && !record.active) this.recycle(record);
      record.active = enabled;
      record.body.setEnabled(enabled);
      if (record.kind !== 'hero' && spreadRatio !== 1 && !record.data.lane) {
        const p = record.body.translation();
        record.body.setTranslation({ x: p.x * spreadRatio, y: p.y * spreadRatio, z: p.z }, true);
        this.snap(record);
      }
      record.scale = this.scaleFor(record);
      record.targetHero = record.kind === 'cell' && !record.hasHitHero && !record.passedHero && !this.isPeripheral(record) && record.aimSeed < physics.heroTargeting;
      if (shapeChanged || !record.collider) {
        const growth = record.kind === 'hero' ? 1 : depthScale(record.body.translation().z, physics.appearance);
        this.updateShape(record, record.scale * Math.max(0.015, growth));
      }
      this.applyContactSettings(record);
    }
    this.lastSpread = flow.spread;
    const anchor = { x: 0, y: 0, z: 1.8 };
    const resetHero = !this.heroAnchor || path === 'all' || path === 'flow.single' || path.startsWith('flow.heroTilt');
    this.heroAnchor = anchor;
    this.heroRestRotation.setFromEuler(new Euler(
      MathUtils.degToRad(flow.heroTiltX), MathUtils.degToRad(flow.heroTiltY), MathUtils.degToRad(flow.heroTiltZ)));
    if (resetHero) {
      this.hero.body.setTranslation(anchor, true);
      this.hero.body.setRotation(this.heroRestRotation, true);
      this.hero.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.hero.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.snap(this.hero);
    }
    if (path === 'physics.heroMass') this.hero.collider.setMass(physics.heroMass);
  }

  restoreHero() {
    const { heroReturn, heroDamping } = this.settings.physics;
    const body = this.hero.body;
    const p = body.translation();
    const velocity = body.linvel();
    const rotation = body.rotation();
    const angular = body.angvel();
    const dx = this.heroAnchor.x - p.x;
    const dy = this.heroAnchor.y - p.y;
    const dz = this.heroAnchor.z - p.z;

    // World-space shortest rotation from the current pose to its resting pose.
    this.heroInverseRotation.set(rotation.x, rotation.y, rotation.z, rotation.w).invert();
    const error = this.heroRotationError.copy(this.heroRestRotation).multiply(this.heroInverseRotation).normalize();
    if (error.w < 0) error.set(-error.x, -error.y, -error.z, -error.w);
    const sinHalfAngle = Math.hypot(error.x, error.y, error.z);
    const angle = 2 * Math.atan2(sinHalfAngle, error.w);
    const factor = sinHalfAngle > 1e-8 ? angle / sinHalfAngle : 2;

    // Settle below a subpixel threshold so an untouched cell is completely still.
    if (Math.hypot(dx, dy, dz) < 0.00015 && angle < 0.00015
      && Math.hypot(velocity.x, velocity.y, velocity.z) < 0.001
      && Math.hypot(angular.x, angular.y, angular.z) < 0.001) {
      body.setTranslation(this.heroAnchor, false);
      body.setRotation(this.heroRestRotation, false);
      body.setLinvel({ x: 0, y: 0, z: 0 }, false);
      body.setAngvel({ x: 0, y: 0, z: 0 }, false);
      return;
    }

    // A damped tether supplies a restoring acceleration, never idle motion.
    // Collision impulses are applied by Rapier after this part of the step.
    const stiffness = heroReturn * heroReturn;
    const damping = 2 * heroDamping * heroReturn;
    body.setLinvel({
      x: velocity.x + (dx * stiffness - velocity.x * damping) * FIXED_STEP,
      y: velocity.y + (dy * stiffness - velocity.y * damping) * FIXED_STEP,
      z: velocity.z + (dz * stiffness - velocity.z * damping) * FIXED_STEP,
    }, true);
    body.setAngvel({
      x: angular.x + (error.x * factor * stiffness - angular.x * damping) * FIXED_STEP,
      y: angular.y + (error.y * factor * stiffness - angular.y * damping) * FIXED_STEP,
      z: angular.z + (error.z * factor * stiffness - angular.z * damping) * FIXED_STEP,
    }, true);
  }

  flowVelocity(record) {
    const { flow, particles } = this.settings;
    const small = record.kind === 'small';
    const speed = (small ? particles.smallSpeed : flow.speed) * 3.6 * record.data.pace;
    const angle = MathUtils.degToRad(flow.direction);
    const phase = record.data.phase;
    const swirl = flow.swirl;
    const turbulence = small ? particles.turbulence * 0.3 : flow.turbulence;
    const p = record.body.translation();
    // A soft vessel boundary steers cells back without teleporting across X/Y.
    const wallX = Math.max(0, Math.abs(p.x) - 10 * flow.spread) * -Math.sign(p.x) * 0.65;
    const wallY = Math.max(0, Math.abs(p.y) - 7 * flow.spread) * -Math.sign(p.y) * 0.65;
    const velocity = {
      x: Math.cos(angle) * speed * 0.09 + Math.sin(this.time * 0.4 + phase) * swirl * 0.42
        + Math.sin(this.time * 0.8 + phase * 2) * turbulence * 0.2 + wallX,
      y: Math.sin(angle) * speed * 0.09 + Math.cos(this.time * 0.32 + phase) * swirl * 0.3
        + Math.cos(this.time * 0.7 + phase * 2) * turbulence * 0.16 + wallY,
      z: speed,
    };
    if (record.data.lane && !record.targetHero && speed > 0.01) {
      const lane = sampleStreamLane(record.data.lane, this.time, flow, this.isPeripheral(record) || record.hasHitHero || record.passedHero);
      const frustum = frustumAtDepth(this.settings.camera, this.aspect, p.z);
      const target = this.streamPosition(record, p.z);
      const u = MathUtils.clamp((p.z - 2) / 10, 0, 1);
      const peelSpeed = 6 * u * (1 - u) / 10 * speed * this.settings.cell.radius * record.scale * 1.35;
      velocity.x = lane.dx * frustum.width - lane.x * frustum.tangent * this.aspect * speed
        + (target.x - p.x) * 0.55 + Math.sign(record.data.lane.outerX) * peelSpeed;
      velocity.y = lane.dy * frustum.height - lane.y * frustum.tangent * speed
        + (target.y - p.y) * 0.55 + Math.sign(record.data.lane.outerY) * peelSpeed;
      velocity.z = speed * (1 + Math.sin(this.time * 0.29 + phase) * flow.chaos * 0.14);
      return velocity;
    }
    if (record.targetHero && speed > 0.01 && p.z < this.heroAnchor.z - 0.5) {
      const hero = this.hero.body.translation();
      const travelTime = Math.max((hero.z - p.z) / speed, 0.4);
      const aimX = (hero.x + record.aimOffset.x - p.x) / travelTime;
      const aimY = (hero.y + record.aimOffset.y - p.y) / travelTime;
      const blend = 0.92;
      velocity.x = MathUtils.lerp(velocity.x, MathUtils.clamp(aimX, -speed * 0.8, speed * 0.8), blend);
      velocity.y = MathUtils.lerp(velocity.y, MathUtils.clamp(aimY, -speed * 0.8, speed * 0.8), blend);
    }
    return velocity;
  }

  setFlowVelocity(record) {
    record.body.setLinvel(this.flowVelocity(record), true);
    const rotation = record.kind === 'small' ? this.settings.particles.smallRotation : this.settings.flow.rotation;
    const phase = record.data.phase;
    record.body.setAngvel({ x: Math.sin(phase) * rotation, y: Math.cos(phase) * rotation * 0.7, z: Math.sin(phase * 2) * rotation * 0.55 }, true);
  }

  recycle(record) {
    const { flow } = this.settings;
    const random = this.random;
    record.hasHitHero = false;
    record.passedHero = false;
    record.targetHero = record.kind === 'cell' && !this.isPeripheral(record) && record.aimSeed < this.settings.physics.heroTargeting;
    const nearAxis = record.targetHero;
    const z = ENTRY_DEPTH - 2 - random() * 5;
    const angle = MathUtils.degToRad(flow.direction);
    const approachDistance = this.heroAnchor.z - z;
    // Seed some streamlines toward the hero, accounting for the lateral flow.
    const landingAngle = random() * Math.PI * 2;
    const landingRadius = this.settings.cell.radius * flow.heroScale * (0.25 + random() * 0.55);
    record.aimOffset.x = Math.cos(landingAngle) * landingRadius;
    record.aimOffset.y = Math.sin(landingAngle) * landingRadius * 0.8;
    const x = this.heroAnchor.x + (nearAxis ? record.aimOffset.x + (random() - 0.5) : (random() - 0.5) * 23 * flow.spread)
      - (nearAxis ? Math.cos(angle) * approachDistance * 0.09 : 0);
    const y = this.heroAnchor.y + (nearAxis ? record.aimOffset.y + (random() - 0.5) : (random() - 0.5) * 15 * flow.spread)
      - (nearAxis ? Math.sin(angle) * approachDistance * 0.09 : 0);
    record.body.setTranslation(record.data.lane ? this.streamPosition(record, z) : { x, y, z }, true);
    record.body.setRotation(new Quaternion().setFromEuler(new Euler(random() * Math.PI, random() * Math.PI, random() * Math.PI)), true);
    this.setFlowVelocity(record);
    this.snap(record);
    this.recycleCount++;
  }

  tick() {
    const { physics, flow, particles } = this.settings;
    const follow = 1 - Math.exp(-physics.drag * FIXED_STEP);
    const spinFollow = 1 - Math.exp(-0.55 * FIXED_STEP);
    this.restoreHero();
    const heroLinearBefore = this.hero.body.linvel();
    const heroAngularBefore = this.hero.body.angvel();
    this.hero.previous.position.copy(this.hero.current.position);
    this.hero.previous.rotation.copy(this.hero.current.rotation);

    for (const record of this.records) {
      if (!record.active) continue;
      const p = record.body.translation();
      const frustum = frustumAtDepth(this.settings.camera, this.aspect, p.z);
      if (record.data.lane && p.z > this.heroAnchor.z + 1.5) {
        record.passedHero = true;
        record.targetHero = false;
      }
      // Recycle only after the entire cell has passed behind the camera.
      if (p.z > EXIT_DEPTH + this.settings.cell.radius * record.scale
        || Math.abs(p.x) > Math.max(40, frustum.width * 1.6)
        || Math.abs(p.y) > Math.max(30, frustum.height * 1.6)) this.recycle(record);
      record.previous.position.copy(record.current.position);
      record.previous.rotation.copy(record.current.rotation);
      const velocity = record.body.linvel();
      const target = this.flowVelocity(record);
      record.body.setLinvel({
        x: MathUtils.lerp(velocity.x, target.x, follow),
        y: MathUtils.lerp(velocity.y, target.y, follow),
        z: MathUtils.lerp(velocity.z, target.z, follow),
      }, true);
      const angvel = record.body.angvel();
      const rotation = record.kind === 'small' ? particles.smallRotation : flow.rotation;
      const phase = record.data.phase;
      record.body.setAngvel({
        x: MathUtils.lerp(angvel.x, Math.sin(phase) * rotation, spinFollow),
        y: MathUtils.lerp(angvel.y, Math.cos(phase) * rotation * 0.7, spinFollow),
        z: MathUtils.lerp(angvel.z, Math.sin(phase * 2) * rotation * 0.55, spinFollow),
      }, true);
      const growth = depthScale(record.body.translation().z, physics.appearance);
      const colliderScale = record.scale * Math.max(0.015, growth);
      // Update distant growing hulls in small increments; close cells stay exact.
      if (Math.abs(colliderScale - record.colliderScale) > Math.max(0.001, record.scale * 0.045)
        || (growth === 1 && record.colliderScale !== record.scale)) this.updateShape(record, colliderScale);
    }
    this.impactPulse *= Math.exp(-FIXED_STEP * 3.8);
    this.world.step(this.events);
    let hit = false;
    this.events.drainCollisionEvents((a, b, started) => {
      if (!started || !physics.enabled || !physics.heroCollisions) return;
      const handle = a === this.hero.collider.handle ? b : b === this.hero.collider.handle ? a : null;
      const record = this.colliderRecords.get(handle);
      if (!record || record.kind === 'hero' || this.time - record.lastHit < 0.5) return;
      record.hasHitHero = true;
      record.targetHero = false;
      record.lastHit = this.time;
      this.heroHitCount++;
      if (record.kind === 'cell') this.heroLargeHitCount++;
      hit = true;
    });
    if (hit) {
      // Amplify the solver's actual collision response, including its torque.
      // No extra motion is generated until a genuine contact starts.
      const linear = this.hero.body.linvel();
      const angular = this.hero.body.angvel();
      const gain = physics.heroImpact;
      const boostedLinear = new Vector3(linear.x - heroLinearBefore.x, linear.y - heroLinearBefore.y, linear.z - heroLinearBefore.z).multiplyScalar(gain);
      const boostedAngular = new Vector3(angular.x - heroAngularBefore.x, angular.y - heroAngularBefore.y, angular.z - heroAngularBefore.z).multiplyScalar(gain);
      this.impactPulse = Math.min(1, Math.max(this.impactPulse, boostedLinear.length() * 2 + boostedAngular.length()));
      boostedLinear.add(new Vector3(heroLinearBefore.x, heroLinearBefore.y, heroLinearBefore.z)).clampLength(0, 2.5);
      boostedAngular.add(new Vector3(heroAngularBefore.x, heroAngularBefore.y, heroAngularBefore.z)).clampLength(0, 2.2);
      this.hero.body.setLinvel(boostedLinear, true);
      this.hero.body.setAngvel(boostedAngular, true);
    }
    this.time += FIXED_STEP;
    readPose(this.hero, this.hero.current);
    for (const record of this.records) if (record.active) readPose(record, record.current);
  }

  step(delta) {
    this.accumulator += Math.min(Math.max(delta, 0), 0.1);
    while (this.accumulator + 1e-10 >= FIXED_STEP) {
      this.tick();
      this.accumulator = Math.max(0, this.accumulator - FIXED_STEP);
    }
    // Fixed physics with interpolated rendering keeps motion smooth above 90 fps.
    const alpha = this.accumulator / FIXED_STEP;
    for (const record of [this.hero, ...this.records]) {
      if (!record.active) continue;
      record.rendered.position.lerpVectors(record.previous.position, record.current.position, alpha);
      record.rendered.rotation.slerpQuaternions(record.previous.rotation, record.current.rotation, alpha);
    }
  }

  dispose() { this.events.free(); this.world.free(); }
}
