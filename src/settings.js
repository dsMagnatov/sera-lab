export const defaults = {
  cell: {
    color: '#aa1025', radius: 1.46, thickness: 0.64, dent: 0.84,
    rim: 0.74, asymmetry: 0.065, roughness: 0.42, texture: 0.055,
    textureScale: 4.4, clearcoat: 0.18, sheen: 0.24, scatter: 0.5,
    variation: 0.24,
  },
  flow: {
    count: 46, speed: 0.65, direction: -18, swirl: 0.28,
    rotation: 0.14, spread: 1, turbulence: 0.24,
    edgeCoverage: 0.62, chaos: 0.9,
    sizeVariation: 0.48, heroScale: 1.28, single: false,
    heroTiltX: -16, heroTiltY: -17, heroTiltZ: -18,
  },
  particles: {
    count: 1000, size: 0.035, speed: 0.85, turbulence: 0.6,
    opacity: 0.55, color: '#b8d8df',
    smallCount: 85, smallSize: 0.085, smallSpeed: 1.1, smallRotation: 0.55,
    smallColor: '#db2c40',
  },
  physics: {
    enabled: true, heroCollisions: true, restitution: 0.58, friction: 0.24,
    drag: 0.72, heroReturn: 1.8, heroDamping: 0.85, heroMass: 18, appearance: 22,
    heroImpact: 4.2, heroTargeting: 0.74,
  },
  vision: {
    enabled: true, color: '#c2d2d5', opacity: 0.78, margin: 1.25, offset: 0.18,
    ticks: 80, markers: 8, speed: 0.75, fontSize: 0.1,
    links: 0.3, scan: true, labels: true,
    textColor: '#c2d2d5', backgroundColor: '#060d12', backgroundOpacity: 0.32,
  },
  light: {
    keyColor: '#dcf5ff', key: 3.5, keyX: 6, keyY: 7, keyZ: 5,
    fillColor: '#ed1834', fill: 1.6, fillX: -7, fillY: -2, fillZ: 4,
    rimColor: '#a0e3ee', rim: 5.2, rimX: 5, rimY: 5, rimZ: -8, ambient: 0.28,
    reflection: 0.5, glow: 0.75,
  },
  camera: {
    fov: 37, focus: 14.3, aperture: 0.0018, blur: 0.013,
    dof: true, parallax: 0.2, parallaxSmoothing: 0.8, zoom: 1,
  },
  effects: {
    background: '#11151d', fogColor: '#23242d', fog: 0.022,
    bloom: 0.25, exposure: 1.05, vignette: 0.36,
    grain: 0.025, saturation: 1.08, chromatic: 0.0006, quality: 1.25,
  },
};

export const presets = {
  reference: { label: 'Атмосфера референсу', patch: {} },
  crimson: {
    label: 'Червона плазма',
    patch: {
      light: { keyColor: '#ffded9', rimColor: '#fa697b', fill: 3.8, glow: 0.28 },
      effects: { background: '#16050b', fogColor: '#3b0b15', fog: 0.028, bloom: 0.4, exposure: 1.05 },
      cell: { color: '#bd0c22', roughness: 0.31 },
    },
  },
  cool: {
    label: 'Холодне світло',
    patch: {
      light: { keyColor: '#d4f4ff', key: 5, rimColor: '#6ed4f1', rim: 6.5, glow: 1.2, fill: 1.5 },
      effects: { background: '#0b1821', fogColor: '#223c48', fog: 0.027, exposure: 1.2 },
      cell: { color: '#d01831', roughness: 0.42 },
    },
  },
  macro: {
    label: 'Один еритроцит',
    patch: {
      flow: { single: true, heroScale: 1.7 },
      camera: { focus: 14.3, aperture: 0.0007, parallax: 0.35 },
      particles: { count: 220, smallCount: 0 },
      effects: { fog: 0.013, bloom: 0.18 },
    },
  },
};

export function createSettings() {
  return structuredClone(defaults);
}

export function applyPreset(settings, name) {
  const fresh = createSettings();
  const patch = presets[name]?.patch ?? {};
  for (const group of Object.keys(fresh)) {
    Object.assign(settings[group], fresh[group], patch[group]);
  }
}

// Import only existing fields of the right type; clamp values to the UI's limits.
export function mergeSettings(target, source, limits) {
  for (const [group, values] of Object.entries(target)) {
    if (!source[group] || typeof source[group] !== 'object') continue;
    for (const [key, current] of Object.entries(values)) {
      const next = source[group][key];
      if (typeof next !== typeof current) continue;
      if (typeof next === 'number' && Number.isFinite(next)) {
        const range = limits.get(`${group}.${key}`);
        values[key] = range
          ? Math.max(range.min, Math.min(range.max, Math.round(next / range.step) * range.step))
          : current;
      } else if (typeof next === 'boolean') {
        values[key] = next;
      } else if (typeof next === 'string' && /^#[0-9a-f]{6}$/i.test(next)) {
        values[key] = next;
      }
    }
  }
}
