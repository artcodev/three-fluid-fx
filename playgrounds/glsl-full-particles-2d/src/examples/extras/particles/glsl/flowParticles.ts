/**
 * Example GPGPU particle system driven by an external 2D screen-space
 * velocity field. The field is just a `THREE.Texture` — Stable Fluids,
 * curl noise, or any procedural source can drive it. The particles
 * themselves know nothing about fluids.
 *
 * Pipeline per frame:
 *   1. velocity pass   — sample the field at each particle's NDC, integrate forces
 *   2. position pass   — pos += vel * dt
 *   3. render pass     — draw instanced billboards sampling pos texture
 *
 * GPGPU best practices observed:
 *   - HalfFloat RGBA render targets for pos/vel ping-pong (precision + bandwidth)
 *   - NearestFilter, ClampToEdgeWrapping, no mipmaps, no depth buffer
 *   - Static destination + attribute textures stay in Float32 (read-only)
 *   - Velocity field is sampled with default filter — caller controls quality
 */
import {
  BufferAttribute,
  ClampToEdgeWrapping,
  DataTexture,
  DoubleSide,
  FloatType,
  HalfFloatType,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  Matrix3,
  Matrix4,
  NearestFilter,
  NormalBlending,
  RGBAFormat,
  ShaderMaterial,
  Uniform,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three'
import type { Texture } from 'three'
import { FULLSCREEN_VERTEX, FullscreenPass } from 'three-fluid-fx'

type ParticleMode = 'plane2d' | 'cloud3d'

interface DoubleFBO {
  read: WebGLRenderTarget
  write: WebGLRenderTarget
}

const DEFAULT_POINT_SIZE = 10
const BILLBOARD_WORLD_UNITS_PER_POINT_SIZE = 0.006
const POINT_SHAPE_RADIUS = 0.5
const POINT_EDGE_AA_MIN = 0.012
const POINT_GRADIENT_FOCUS_X = -0.12
const POINT_GRADIENT_FOCUS_Y = 0.14
const POINT_CENTER_FALLOFF = 0.68
const POINT_CENTER_LIGHT_BOOST = 0.28
const POINT_CENTER_CHROMA_BOOST = 0.34
const POINT_CENTER_ALPHA_BOOST = 0.18
const POINT_COLOR_PEAK = 1.35
const POINT_DEPTH_ALPHA_CUTOFF = 0.04

export interface FlowParticlesOptions {
  mode: ParticleMode
  size?: number
}

/**
 * Per-frame inputs. Particles depend only on a `velocityField` texture and
 * camera state — they do not know how the field was produced.
 */
export interface FlowParticlesStepParams {
  dt: number
  dpr: number
  /** 2D screen-space velocity field, sampled at each particle's NDC. */
  velocityField: Texture
  viewMatrix: Matrix4
  projectionMatrix: Matrix4
  modelMatrix?: Matrix4
  cameraRight: Vector3
  cameraUp: Vector3
  /** World-space rotation of the points object (for matching the field sample). */
  modelRotation: Matrix3
  pointSize: number
  /** Spring-damper natural frequency ω toward each particle's destination. */
  spring: number
  /** Damping ratio ζ for the spring. */
  zeta: number
  /** Linear (Stokes) drag on velocity. */
  dragLin: number
  /** Quadratic (ram pressure) drag. */
  dragQuad: number
  /** Acceleration clamp (for stability). */
  aMax: number
  /** Per-particle vmax multiplier. */
  vMaxScale: number
  /** Multiplier on the in-plane field acceleration. */
  flowStrength: number
  /** Multiplier on the perpendicular (out-of-camera-plane) lift in 3D mode. */
  depthLift: number
  /** Below this magnitude the field is treated as zero (kills jitter). */
  flowThreshold: number
  /** Soft-clamps the maximum field magnitude consumed. */
  maxFlowSpeed: number
  /** Response curve exponent (1 = linear, 2 = squared, etc.). */
  responseGamma: number
  /** Angle factor for the perpendicular lift kick. */
  perpendicularAngle: number
  /** Per-seed random sign variation strength for the lift. */
  sideVariation: number
  /**
   * Z-window controlling how deep into the volume the field reaches.
   * 1 = full depth (everything reacts). 0.1 = only the front sliver.
   * Falloff curve is a Gaussian along NDC z.
   */
  depthAttenuationScale: number
}

export interface FlowParticles {
  points: InstancedMesh<InstancedBufferGeometry, ShaderMaterial>
  step: (params: FlowParticlesStepParams) => void
  dispose: () => void
}

const COPY_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uSource;

void main() {
  gl_FragColor = texture2D(uSource, vUv);
}
`

const VELOCITY_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uPositionTexture;
uniform sampler2D uVelocityTexture;
uniform sampler2D uDestinationTexture;
uniform sampler2D uAttributeTexture;
uniform sampler2D uFlow;
uniform mat4 uViewMatrix;
uniform mat4 uProjectionMatrix;
uniform mat4 uModelMatrix;
uniform vec3 uCameraRight;
uniform vec3 uCameraUp;
uniform float uDeltaTime;
uniform float uFlowStrength;
uniform float uDepthLift;
uniform float uMaxFlowSpeed;
uniform float uFlowThresh;
uniform float uFlowPow;
uniform float uPerpendicularAngle;
uniform float uOmega;
uniform float uZeta;
uniform float uDragLin;
uniform float uDragQuad;
uniform float uAMax;
uniform float uVMaxScale;
uniform float uSideVariation;
uniform float uPlaneLock;
uniform float uDepthScale;

float hash(float n) {
  return fract(sin(n) * 43758.5453123);
}

void main() {
  vec4 position = texture2D(uPositionTexture, vUv);
  vec4 velocity = texture2D(uVelocityTexture, vUv);
  vec4 destination = texture2D(uDestinationTexture, vUv);
  vec4 attr = texture2D(uAttributeTexture, vUv);

  vec3 pos = position.xyz;
  vec3 vel = velocity.xyz;
  vec3 dest = destination.xyz;
  float stiffness = destination.w;
  float vmax = attr.y * uVMaxScale;
  float seed = attr.w;

  vec3 error = dest - pos;
  float omega = uOmega * max(0.0, stiffness);
  vec3 aSpring = omega * omega * error;
  vec3 aDamp = -2.0 * uZeta * omega * vel;

  float speed = length(vel);
  vec3 aDrag = vec3(0.0);
  if (speed > 1e-5) {
    aDrag = -uDragLin * vel - uDragQuad * speed * vel;
  }

  vec3 aCore = aSpring + aDamp + aDrag;
  vec3 aFlow = vec3(0.0);

  vec3 worldPos = (uModelMatrix * vec4(pos, 1.0)).xyz;
  mat3 invModelRotation = inverse(mat3(uModelMatrix));
  vec4 clip = uProjectionMatrix * uViewMatrix * vec4(worldPos, 1.0);
  if (clip.w > 0.00001) {
    vec2 ndc = clip.xy / clip.w;
    vec2 uv = ndc * 0.5 + 0.5;
    if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
      vec2 flow = texture2D(uFlow, uv).xy;
      float flowMag = length(flow);
      float norm = (flowMag - uFlowThresh) / max(1e-5, uMaxFlowSpeed);
      float factor = smoothstep(0.0, 1.0, clamp(norm, 0.0, 1.0));
      factor = pow(factor, max(1.0, uFlowPow));
      flow *= factor;
      flow *= min(1.0, uMaxFlowSpeed / max(flowMag, 1e-5));

      vec3 flowWorld = flow.x * uCameraRight + flow.y * uCameraUp;
      vec3 flowLocal = invModelRotation * flowWorld;
      aFlow += flowLocal * uFlowStrength;

      if (uDepthLift > 0.0 && length(flowLocal) > 1e-5) {
        vec3 forward = normalize(cross(uCameraRight, uCameraUp));
        vec3 forwardLocal = invModelRotation * forward;
        vec3 flowDir = normalize(flowLocal);
        vec3 sideDir = normalize(cross(forwardLocal, flowDir));
        float sideSign = hash(seed * 12.9898) > 0.5 ? 1.0 : -1.0;
        float perSeed = mix(1.0, mix(0.35, 1.0, hash(seed * 37.719)), clamp(uSideVariation, 0.0, 1.0));
        aFlow += sideDir * sideSign * perSeed * length(flow) * uPerpendicularAngle * uDepthLift;
        aFlow += forwardLocal * (hash(seed * 91.17) - 0.5) * length(flow) * 0.18 * uDepthLift;
      }

      // Depth attenuation: only the camera-facing half of the volume reacts.
      // signedDepth > 0  (in front of origin) → full influence.
      // signedDepth < 0  (behind origin)      → Gaussian decay with width = uDepthScale.
      // For plane2d (z = 0) signedDepth = 0 → falloff = 1 regardless of scale.
      vec3 forwardW = normalize(cross(uCameraRight, uCameraUp));
      float signedDepth = dot(worldPos, forwardW);
      float behind = max(0.0, -signedDepth) / max(uDepthScale, 0.01);
      aFlow *= exp(-behind * behind);
    }
  }

  vec3 acceleration = aCore + aFlow;
  acceleration.z = mix(acceleration.z, aCore.z, uPlaneLock);

  float aMag = length(acceleration);
  if (aMag > uAMax) {
    acceleration = acceleration / aMag * uAMax;
    aMag = uAMax;
  }

  vel += acceleration * uDeltaTime;
  vel.z = mix(vel.z, 0.0, uPlaneLock);

  float newSpeed = length(vel);
  if (newSpeed > vmax) {
    vel = vel / newSpeed * vmax;
    newSpeed = vmax;
  }

  vec3 velCore = velocity.xyz + aCore * uDeltaTime;
  float flowEnergy = length(vel - velCore);
  float desiredEnergy = smoothstep(0.15, 2.8, newSpeed) * 0.35 + smoothstep(0.05, 1.8, flowEnergy) * 1.35;
  float alpha = 1.0 - pow(0.5, uDeltaTime / 0.08);
  float energy = mix(velocity.w, desiredEnergy, alpha);

  gl_FragColor = vec4(vel, energy);
}
`

const POSITION_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uPositionTexture;
uniform sampler2D uVelocityTexture;
uniform sampler2D uDestinationTexture;
uniform float uDeltaTime;
uniform float uPlaneLock;

void main() {
  vec4 pos = texture2D(uPositionTexture, vUv);
  vec3 vel = texture2D(uVelocityTexture, vUv).xyz;
  vec3 dest = texture2D(uDestinationTexture, vUv).xyz;
  pos.xyz += vel * uDeltaTime;
  pos.z = mix(pos.z, dest.z, uPlaneLock);
  gl_FragColor = vec4(pos.xyz, 1.0);
}
`

const PARTICLE_VERTEX = /* glsl */ `
precision highp float;
attribute vec2 aParticleUv;
attribute float aSeed;
uniform sampler2D uPositionTexture;
uniform sampler2D uVelocityTexture;
uniform sampler2D uAttributeTexture;
uniform float uPointSize;
uniform float uTime;
uniform vec3 uCameraRightLocal;
uniform vec3 uCameraUpLocal;
varying vec2 vUv;
varying vec3 vParticleColor;
varying vec3 vParticlePalette;

const float BILLBOARD_WORLD_UNITS_PER_POINT_SIZE = ${BILLBOARD_WORLD_UNITS_PER_POINT_SIZE.toFixed(3)};

float hash31(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
}

float valueNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);

  float n000 = hash31(i + vec3(0.0, 0.0, 0.0));
  float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash31(i + vec3(1.0, 1.0, 1.0));

  float nx00 = mix(n000, n100, u.x);
  float nx10 = mix(n010, n110, u.x);
  float nx01 = mix(n001, n101, u.x);
  float nx11 = mix(n011, n111, u.x);
  float nxy0 = mix(nx00, nx10, u.y);
  float nxy1 = mix(nx01, nx11, u.y);
  return mix(nxy0, nxy1, u.z);
}

void main() {
  vec3 pos = texture2D(uPositionTexture, aParticleUv).xyz;
  float energy = clamp(texture2D(uVelocityTexture, aParticleUv).w, 0.0, 1.0);
  vec4 attr = texture2D(uAttributeTexture, aParticleUv);
  float worldSize = uPointSize * attr.x * BILLBOARD_WORLD_UNITS_PER_POINT_SIZE;
  vec3 offset = (uCameraRightLocal * position.x + uCameraUpLocal * position.y) * worldSize;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos + offset, 1.0);
  vUv = uv;

  float e = smoothstep(0.0, 1.0, energy);
  vec3 patternPos = pos * 0.72;
  vec3 noisePos = patternPos * 1.15 + vec3(aSeed * 7.1, uTime * 0.08, -uTime * 0.05);
  float n0 = valueNoise(noisePos);
  float n1 = valueNoise(noisePos * 2.31 + vec3(13.5, 9.2, 5.7));
  float noise = n0 * 0.68 + n1 * 0.32;
  float marble = sin((patternPos.x + patternPos.y * 0.7 - patternPos.z * 0.4) * 2.4 + noise * 4.5 + uTime * 0.05);
  float paletteDrift = sin(uTime * 0.11 + aSeed * 6.28318530718) * 0.025;
  float a = fract(aSeed * 0.18 + noise * 0.48 + marble * 0.12 + e * 0.26 + paletteDrift);
  float phase = a * 6.3;
  vec3 palette = vec3(cos(phase), cos(phase + 83.0), cos(phase + 21.0)) * 0.56 + 0.55;
  float cyanAmount = smoothstep(0.62, 1.05, palette.z + palette.y * 0.55 - palette.x * 0.7);
  float whiteAmount = smoothstep(0.72, 1.0, min(min(palette.x, palette.y), palette.z));
  vec3 paletteWarm = palette * vec3(1.08, 0.93, 0.72) + vec3(0.025, 0.0, 0.0);
  palette = mix(palette, paletteWarm, min(0.5, cyanAmount * 0.28 + whiteAmount * 0.35));
  float emissionStrength = 0.9 + e * 1.45;

  vParticlePalette = palette;
  vParticleColor = palette * emissionStrength;
}
`

const PARTICLE_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying vec3 vParticleColor;
varying vec3 vParticlePalette;

const float POINT_SHAPE_RADIUS = ${POINT_SHAPE_RADIUS.toFixed(1)};
const float POINT_EDGE_AA_MIN = ${POINT_EDGE_AA_MIN.toFixed(3)};
const vec2 POINT_GRADIENT_FOCUS = vec2(${POINT_GRADIENT_FOCUS_X.toFixed(2)}, ${POINT_GRADIENT_FOCUS_Y.toFixed(2)});
const float POINT_CENTER_FALLOFF = ${POINT_CENTER_FALLOFF.toFixed(2)};
const float POINT_CENTER_LIGHT_BOOST = ${POINT_CENTER_LIGHT_BOOST.toFixed(2)};
const float POINT_CENTER_CHROMA_BOOST = ${POINT_CENTER_CHROMA_BOOST.toFixed(2)};
const float POINT_CENTER_ALPHA_BOOST = ${POINT_CENTER_ALPHA_BOOST.toFixed(2)};
const float POINT_COLOR_PEAK = ${POINT_COLOR_PEAK.toFixed(2)};
const float POINT_DEPTH_ALPHA_CUTOFF = ${POINT_DEPTH_ALPHA_CUTOFF.toFixed(2)};

void main() {
  vec2 p = vUv - 0.5;
  float d = length(p);

  // The sprite size is the visible diameter; AA is folded inward at the edge.
  float aa = max(fwidth(d), POINT_EDGE_AA_MIN);
  float alpha = 1.0 - smoothstep(POINT_SHAPE_RADIUS - aa, POINT_SHAPE_RADIUS, d);

  vec2 gradientP = p - POINT_GRADIENT_FOCUS;
  float centerGradient = 1.0 - smoothstep(0.0, POINT_CENTER_FALLOFF, length(gradientP) / POINT_SHAPE_RADIUS);
  vec2 normalUv = gradientP / POINT_SHAPE_RADIUS;
  float normalZ = sqrt(max(0.0, 1.0 - dot(normalUv, normalUv)));
  vec3 normal = normalize(vec3(normalUv, normalZ));
  vec3 lightDir = normalize(vec3(-0.42, 0.55, 0.72));
  vec3 halfDir = normalize(vec3(-0.16, 0.22, 1.0));
  float diffuse = max(dot(normal, lightDir), 0.0);
  float specular = pow(max(dot(normal, halfDir), 0.0), 18.0) * 0.28;
  float phongShade = (0.74 + diffuse * 0.42) * (0.84 + normalZ * 0.16);

  vec3 finalColor = vParticleColor * phongShade + vParticlePalette * specular;
  finalColor = finalColor * (1.0 + centerGradient * POINT_CENTER_LIGHT_BOOST)
    + vParticlePalette * (centerGradient * POINT_CENTER_CHROMA_BOOST);
  float peak = max(max(finalColor.r, finalColor.g), max(finalColor.b, POINT_COLOR_PEAK));
  finalColor *= POINT_COLOR_PEAK / peak;

  float visibleAlpha = min(1.0, alpha * (1.0 + centerGradient * POINT_CENTER_ALPHA_BOOST));
  if (visibleAlpha <= POINT_DEPTH_ALPHA_CUTOFF) {
    discard;
  }

  gl_FragColor = vec4(finalColor, visibleAlpha);
}
`

// HalfFloat RGBA, Nearest, ClampToEdge, no depth, no mips — standard GPGPU
// ping-pong target. We never sample these with a linear filter so Nearest is
// authoritative; HalfFloat keeps memory bandwidth low while preserving
// enough range for screen-space velocities.
function makeTarget(size: number): WebGLRenderTarget {
  return new WebGLRenderTarget(size, size, {
    depthBuffer: false,
    stencilBuffer: false,
    format: RGBAFormat,
    type: HalfFloatType,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    wrapS: ClampToEdgeWrapping,
    wrapT: ClampToEdgeWrapping,
    generateMipmaps: false,
  })
}

function makeDouble(size: number): DoubleFBO {
  return { read: makeTarget(size), write: makeTarget(size) }
}

function swap(target: DoubleFBO): void {
  const read = target.read
  target.read = target.write
  target.write = read
}

function createBillboardGeometry(data: {
  uvs: Float32Array
  seeds: Float32Array
}): InstancedBufferGeometry {
  const geometry = new InstancedBufferGeometry()

  geometry.setAttribute(
    'position',
    new BufferAttribute(
      new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
      3,
    ),
  )
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2))
  geometry.setAttribute('aParticleUv', new InstancedBufferAttribute(data.uvs, 2))
  geometry.setAttribute('aSeed', new InstancedBufferAttribute(data.seeds, 1))
  geometry.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1))
  geometry.setDrawRange(0, 6)
  geometry.instanceCount = data.seeds.length
  return geometry
}

// Full Float32 for the static read-only destination + attribute textures —
// these are uploaded once at construction and never written to from a shader.
function makeDataTexture(size: number, data: Float32Array): DataTexture {
  const texture = new DataTexture(data, size, size, RGBAFormat, FloatType)
  texture.minFilter = NearestFilter
  texture.magFilter = NearestFilter
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.needsUpdate = true
  return texture
}

function hash11(n: number): number {
  const s = Math.sin(n) * 43758.5453123
  return s - Math.floor(s)
}

function createMaterial(
  fragmentShader: string,
  uniforms: ShaderMaterial['uniforms'],
): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
}

function fillParticleData(
  mode: ParticleMode,
  size: number,
): {
  positions: Float32Array
  velocities: Float32Array
  destinations: Float32Array
  attributes: Float32Array
  uvs: Float32Array
  seeds: Float32Array
} {
  const count = size * size
  const positions = new Float32Array(count * 4)
  const velocities = new Float32Array(count * 4)
  const destinations = new Float32Array(count * 4)
  const attributes = new Float32Array(count * 4)
  const uvs = new Float32Array(count * 2)
  const seeds = new Float32Array(count)
  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

  for (let i = 0; i < count; i += 1) {
    const u = ((i % size) + 0.5) / size
    const v = (Math.floor(i / size) + 0.5) / size
    const seed = (i * 0.61803398875) % 1
    let x = 0
    let y = 0
    let z = 0

    if (mode === 'plane2d') {
      const angle = i * GOLDEN_ANGLE
      const r01 = Math.sqrt((i + 0.5) / count)
      const discRadius = 2.0
      x = Math.cos(angle) * r01 * discRadius
      y = Math.sin(angle) * r01 * discRadius
      z = 0
    } else {
      const sphereRadius = 2.0
      const yNorm = 1 - 2 * ((i + 0.5) / count)
      const ring = Math.sqrt(Math.max(0, 1 - yNorm * yNorm))
      const theta = i * GOLDEN_ANGLE
      x = Math.cos(theta) * ring * sphereRadius
      y = yNorm * sphereRadius
      z = Math.sin(theta) * ring * sphereRadius
    }

    positions[i * 4] = x
    positions[i * 4 + 1] = y
    positions[i * 4 + 2] = z
    positions[i * 4 + 3] = 1

    destinations[i * 4] = x
    destinations[i * 4 + 1] = y
    destinations[i * 4 + 2] = z
    destinations[i * 4 + 3] = mode === 'plane2d' ? 1.15 : 0.82

    velocities[i * 4] = 0
    velocities[i * 4 + 1] = 0
    velocities[i * 4 + 2] = 0
    velocities[i * 4 + 3] = 0

    const sizeRand = hash11(i * 12.9898 + 78.233)
    attributes[i * 4] = mode === 'plane2d' ? 0.8 + sizeRand * 0.5 : 0.75 + sizeRand * 0.6
    attributes[i * 4 + 1] = mode === 'plane2d' ? 3.2 : 2.6
    attributes[i * 4 + 2] = 0
    attributes[i * 4 + 3] = seed

    uvs[i * 2] = u
    uvs[i * 2 + 1] = v
    seeds[i] = seed
  }

  return { positions, velocities, destinations, attributes, uvs, seeds }
}

export function createFlowParticles(
  renderer: WebGLRenderer,
  options: FlowParticlesOptions,
): FlowParticles {
  const size = options.size ?? (options.mode === 'plane2d' ? 160 : 144)
  const data = fillParticleData(options.mode, size)
  const position = makeDouble(size)
  const velocity = makeDouble(size)
  const destinationTexture = makeDataTexture(size, data.destinations)
  const attributeTexture = makeDataTexture(size, data.attributes)
  const initialPositionTexture = makeDataTexture(size, data.positions)
  const initialVelocityTexture = makeDataTexture(size, data.velocities)

  const copyMaterial = createMaterial(COPY_FRAGMENT, {
    uSource: new Uniform(initialPositionTexture),
  })
  const velocityMaterial = createMaterial(VELOCITY_FRAGMENT, {
    uPositionTexture: new Uniform(position.read.texture),
    uVelocityTexture: new Uniform(velocity.read.texture),
    uDestinationTexture: new Uniform(destinationTexture),
    uAttributeTexture: new Uniform(attributeTexture),
    uFlow: new Uniform(null),
    uViewMatrix: new Uniform(new Matrix4()),
    uProjectionMatrix: new Uniform(new Matrix4()),
    uModelMatrix: new Uniform(new Matrix4()),
    uCameraRight: new Uniform(new Vector3(1, 0, 0)),
    uCameraUp: new Uniform(new Vector3(0, 1, 0)),
    uDeltaTime: new Uniform(0.016),
    uFlowStrength: new Uniform(1),
    uDepthLift: new Uniform(0),
    uMaxFlowSpeed: new Uniform(12),
    uFlowThresh: new Uniform(0.02),
    uFlowPow: new Uniform(2),
    uPerpendicularAngle: new Uniform(1.5),
    uOmega: new Uniform(2),
    uZeta: new Uniform(1.15),
    uDragLin: new Uniform(0.28),
    uDragQuad: new Uniform(0.05),
    uAMax: new Uniform(24),
    uVMaxScale: new Uniform(1),
    uSideVariation: new Uniform(1),
    uPlaneLock: new Uniform(options.mode === 'plane2d' ? 1 : 0),
    uDepthScale: new Uniform(1),
  })
  const positionMaterial = createMaterial(POSITION_FRAGMENT, {
    uPositionTexture: new Uniform(position.read.texture),
    uVelocityTexture: new Uniform(velocity.read.texture),
    uDestinationTexture: new Uniform(destinationTexture),
    uDeltaTime: new Uniform(0.016),
    uPlaneLock: new Uniform(options.mode === 'plane2d' ? 1 : 0),
  })
  const copyPass = new FullscreenPass(copyMaterial)
  const velocityPass = new FullscreenPass(velocityMaterial)
  const positionPass = new FullscreenPass(positionMaterial)

  // Seed the read AND write FBOs of both ping-pong pairs with initial data,
  // so the first swap doesn't pull noise out of the alternate target.
  copyMaterial.uniforms.uSource.value = initialPositionTexture
  copyPass.render(renderer, position.read)
  copyPass.render(renderer, position.write)
  copyMaterial.uniforms.uSource.value = initialVelocityTexture
  copyPass.render(renderer, velocity.read)
  copyPass.render(renderer, velocity.write)
  renderer.setRenderTarget(null)

  const geometry = createBillboardGeometry(data)

  const renderMaterial = new ShaderMaterial({
    vertexShader: PARTICLE_VERTEX,
    fragmentShader: PARTICLE_FRAGMENT,
    uniforms: {
      uPositionTexture: new Uniform(position.read.texture),
      uVelocityTexture: new Uniform(velocity.read.texture),
      uAttributeTexture: new Uniform(attributeTexture),
      uPointSize: new Uniform(DEFAULT_POINT_SIZE),
      uTime: new Uniform(0.0),
      uCameraRightLocal: new Uniform(new Vector3(1, 0, 0)),
      uCameraUpLocal: new Uniform(new Vector3(0, 1, 0)),
    },
    transparent: true,
    depthTest: true,
    depthWrite: true,
    blending: NormalBlending,
    alphaToCoverage: true,
    toneMapped: false,
    side: DoubleSide,
  })

  const count = size * size
  const points = new InstancedMesh(geometry, renderMaterial, count)
  const identity = new Matrix4()
  for (let i = 0; i < count; i += 1) {
    points.setMatrixAt(i, identity)
  }
  points.instanceMatrix.needsUpdate = true
  points.frustumCulled = false

  let accumulatedTime = 0.0
  const invModelRotation = new Matrix3()
  const modelRotationMatrix = new Matrix4()
  const rightLocal = renderMaterial.uniforms.uCameraRightLocal.value as Vector3
  const upLocal = renderMaterial.uniforms.uCameraUpLocal.value as Vector3

  return {
    points,
    step(params) {
      const dt = Math.min(Math.max(params.dt, 1e-6), 1 / 30)
      points.updateWorldMatrix(true, false)
      const modelMatrix = params.modelMatrix ?? points.matrixWorld
      accumulatedTime += dt
      const u = velocityMaterial.uniforms
      u.uPositionTexture.value = position.read.texture
      u.uVelocityTexture.value = velocity.read.texture
      u.uFlow.value = params.velocityField
      u.uViewMatrix.value.copy(params.viewMatrix)
      u.uProjectionMatrix.value.copy(params.projectionMatrix)
      u.uModelMatrix.value.copy(modelMatrix)
      u.uCameraRight.value.copy(params.cameraRight)
      u.uCameraUp.value.copy(params.cameraUp)
      u.uDeltaTime.value = dt
      u.uOmega.value = params.spring
      u.uZeta.value = params.zeta
      u.uDragLin.value = params.dragLin
      u.uDragQuad.value = params.dragQuad
      u.uAMax.value = params.aMax
      u.uVMaxScale.value = params.vMaxScale
      u.uFlowStrength.value = params.flowStrength
      u.uDepthLift.value = params.depthLift
      u.uFlowThresh.value = params.flowThreshold
      u.uMaxFlowSpeed.value = params.maxFlowSpeed
      u.uFlowPow.value = params.responseGamma
      u.uPerpendicularAngle.value = params.perpendicularAngle
      u.uSideVariation.value = params.sideVariation
      u.uDepthScale.value = params.depthAttenuationScale
      velocityPass.render(renderer, velocity.write)
      swap(velocity)

      positionMaterial.uniforms.uPositionTexture.value = position.read.texture
      positionMaterial.uniforms.uVelocityTexture.value = velocity.read.texture
      positionMaterial.uniforms.uDeltaTime.value = dt
      positionPass.render(renderer, position.write)
      swap(position)
      renderer.setRenderTarget(null)

      renderMaterial.uniforms.uPositionTexture.value = position.read.texture
      renderMaterial.uniforms.uVelocityTexture.value = velocity.read.texture
      renderMaterial.uniforms.uPointSize.value = params.pointSize
      renderMaterial.uniforms.uTime.value = accumulatedTime
      modelRotationMatrix.extractRotation(modelMatrix)
      invModelRotation.setFromMatrix4(modelRotationMatrix).invert()
      rightLocal.copy(params.cameraRight).applyMatrix3(invModelRotation).normalize()
      upLocal.copy(params.cameraUp).applyMatrix3(invModelRotation).normalize()
    },
    dispose() {
      geometry.dispose()
      renderMaterial.dispose()
      copyPass.dispose()
      velocityPass.dispose()
      positionPass.dispose()
      initialPositionTexture.dispose()
      initialVelocityTexture.dispose()
      destinationTexture.dispose()
      attributeTexture.dispose()
      position.read.dispose()
      position.write.dispose()
      velocity.read.dispose()
      velocity.write.dispose()
    },
  }
}
