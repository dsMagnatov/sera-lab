import * as THREE from 'three';

/** A closed, biconcave disc. The two dimples never create a hole. */
export function createCellGeometry(shape, segments = 88, rings = 48) {
  const positions = [];
  const colors = [];
  const uvs = [];
  const indices = [];

  for (let j = 0; j <= rings; j++) {
    const phi = (j / rings) * Math.PI;
    const r = Math.sin(phi);
    const r2 = r * r;
    const profile = 1 - shape.dent
      + shape.dent * ((2.2 + shape.rim * 0.9) * r2 - (0.8 + shape.rim * 0.5) * r2 * r2);
    const halfHeight = shape.thickness * Math.cos(phi) * profile;

    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      const irregularity = shape.asymmetry * (
        0.46 * Math.sin(theta * 3 + 0.4)
        + 0.26 * Math.cos(theta * 5 - phi * 2)
        + 0.18 * Math.sin(theta * 9 + phi * 3)
      );
      const radius = shape.radius * r * (1 + irregularity * r);
      const z = halfHeight * (1 + irregularity * 0.6)
        + shape.asymmetry * 0.16 * r2 * Math.sin(theta * 4 + phi * 2);
      positions.push(radius * Math.cos(theta), radius * Math.sin(theta), z);
      uvs.push(i / segments, j / rings);

      // Subtle natural occlusion inside the dimple, baked into vertex color.
      const shade = 1 - shape.dent * (0.68 - 0.68 * THREE.MathUtils.smoothstep(r, 0.12, 0.88));
      colors.push(shade, shade, shade);

      if (j < rings && i < segments) {
        const a = j * (segments + 1) + i;
        const b = a + segments + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  // Average duplicate seam/pole normals to keep the membrane completely smooth.
  const normals = geometry.attributes.normal;
  const normal = new THREE.Vector3();
  for (let j = 1; j < rings; j++) {
    const a = j * (segments + 1);
    const b = a + segments;
    normal.fromBufferAttribute(normals, a)
      .add(new THREE.Vector3().fromBufferAttribute(normals, b)).normalize();
    normals.setXYZ(a, normal.x, normal.y, normal.z);
    normals.setXYZ(b, normal.x, normal.y, normal.z);
  }
  for (let i = 0; i <= segments; i++) {
    normals.setXYZ(i, 0, 0, 1);
    normals.setXYZ(rings * (segments + 1) + i, 0, 0, -1);
  }
  geometry.computeBoundingSphere();
  return geometry;
}

export function seededRandom(seed = 173) {
  return () => {
    seed |= 0;
    seed = seed + 0x6d2b79f5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** Seamless, multiscale membrane texture. Generated locally, no asset requests. */
export function createMembraneTexture() {
  const size = 512;
  const random = seededRandom(91);
  const grids = [8, 24, 64, 160].map((count) => ({
    count,
    values: Float32Array.from({ length: count * count }, random),
  }));
  const data = new Uint8Array(size * size * 4);
  const smooth = (t) => t * t * (3 - 2 * t);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let value = 0;
      grids.forEach(({ count, values }, octave) => {
        const gx = x / size * count;
        const gy = y / size * count;
        const ix = Math.floor(gx);
        const iy = Math.floor(gy);
        const fx = smooth(gx - ix);
        const fy = smooth(gy - iy);
        const sample = (dx, dy) => values[((iy + dy) % count) * count + (ix + dx) % count];
        value += THREE.MathUtils.lerp(
          THREE.MathUtils.lerp(sample(0, 0), sample(1, 0), fx),
          THREE.MathUtils.lerp(sample(0, 1), sample(1, 1), fx), fy,
        ) * [0.18, 0.23, 0.3, 0.29][octave];
      });
      const offset = (y * size + x) * 4;
      data[offset] = data[offset + 1] = data[offset + 2] = Math.round(value * 255);
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export function createCellMaterial(settings, membrane) {
  const uniforms = {
    uMembrane: { value: membrane },
    uTextureScale: { value: settings.cell.textureScale },
    uTextureStrength: { value: settings.cell.texture },
    uScatter: { value: settings.cell.scatter },
  };

  const material = new THREE.MeshPhysicalMaterial({
    color: settings.cell.color,
    roughness: settings.cell.roughness,
    metalness: 0,
    clearcoat: settings.cell.clearcoat,
    clearcoatRoughness: 0.3,
    sheen: settings.cell.sheen,
    sheenColor: new THREE.Color('#f76579'),
    sheenRoughness: 0.6,
    envMapIntensity: settings.light.reflection,
    vertexColors: true,
  });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vMembranePosition;
        varying vec3 vMembraneNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vMembranePosition = position;
        vMembraneNormal = normal;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uMembrane;
        uniform float uTextureScale;
        uniform float uTextureStrength;
        uniform float uScatter;
        varying vec3 vMembranePosition;
        varying vec3 vMembraneNormal;
        float membraneNoise(vec3 p) {
          vec3 weights = pow(abs(normalize(vMembraneNormal)), vec3(4.0));
          weights /= max(dot(weights, vec3(1.0)), 0.0001);
          return texture2D(uMembrane, p.yz).r * weights.x
            + texture2D(uMembrane, p.xz).r * weights.y
            + texture2D(uMembrane, p.xy).r * weights.z;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float membraneColor = membraneNoise(vMembranePosition * uTextureScale * 0.23);
        diffuseColor.rgb *= mix(1.0, 0.72 + membraneColor * 0.5, min(uTextureStrength * 3.0, 1.0));`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float height = membraneNoise(vMembranePosition * uTextureScale);
        vec3 surfQ0 = dFdx(-vViewPosition);
        vec3 surfQ1 = dFdy(-vViewPosition);
        vec3 surfR1 = cross(surfQ1, normal);
        vec3 surfR2 = cross(normal, surfQ0);
        float surfDet = dot(surfQ0, surfR1) * faceDirection;
        vec3 surfGradient = sign(surfDet) * (dFdx(height) * surfR1 + dFdy(height) * surfR2);
        normal = normalize(abs(surfDet) * normal - uTextureStrength * surfGradient);`)
      .replace('#include <opaque_fragment>', `
        float membraneFresnel = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.6);
        float membraneBacklight = pow(saturate(dot(-normal, normalize(vec3(0.6, 0.8, -0.5)))), 2.0);
        outgoingLight += vec3(0.7, 0.018, 0.035) * uScatter
          * (membraneFresnel * 0.4 + membraneBacklight * 0.24);
        #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => 'blood-membrane-v1';
  material.userData.uniforms = uniforms;
  return material;
}
