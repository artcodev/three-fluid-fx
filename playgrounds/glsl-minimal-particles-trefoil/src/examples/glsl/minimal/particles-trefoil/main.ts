/**
 * Procedural particles on a trefoil-knot tube — billboard centers are computed
 * per instance in the shader from a simple `aIndex` attribute, NO GPGPU
 * (no FBO ping-pong, no spring physics). Vertex shader:
 *
 *   t = (i / count) * 2π
 *   curve(t) = (sin t + 2 sin 2t, cos t − 2 cos 2t, −sin 3t)
 *   T = tangent, B = T × up, N = T × B
 *   pos = curve(t) + N·cos(φ)·r + B·sin(φ)·r,  φ = GOLDEN_ANGLE · i · 7.3
 *
 * Fluid drives a painted-displacement effect: density (fluid.b) pushes
 * particles outward along their radial axis; velocity (fluid.rg) adds a
 * planar drag. Motion uses raw density through a soft-knee curve so strong
 * splats keep some extra range without needing intermediate particle buffers.
 */
import '../../../../styles.css'
import {
  BufferAttribute,
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  Matrix3,
  Matrix4,
  NormalBlending,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  Timer,
  Uniform,
  Vector3,
  WebGLRenderer,
} from 'three'
import { attachPointerSplats, FluidSimulation } from 'three-fluid-fx'

const DEFAULTS = {
  count: 4000,
  // Trefoil shape
  tubeRadius: 0.3,
  scale: 0.55,
  pointSize: 6,
  rotationSpeed: 0.2,
  // Displacement is measured in tube radii.
  displacement: 1,
  dispThreshold: 0.08,
  dispRange: 0.3,
  dragStrength: 0.1,
  maxFlowSpeed: 10,
  // Fluid sim — splatRadius value already includes the GUI-side SCALE
  // multiplier (1e-4) so the value here matches the production demo.
  splatRadius: 25 * 1e-4,
  splatForce: 10,
  pressureIterations: 15,
  curlStrength: 0.2,
  velocityDissipation: 0.99,
  densityDissipation: 0.98,
  pressureDissipation: 0.8,
  enableVorticity: false,
  bfecc: true,
  reflectWalls: false,
}

const VERTEX = /* glsl */ `
attribute float aIndex;
uniform float uCount;
uniform float uTubeRadius;
uniform float uScale;
uniform float uPointSize;
uniform float uDisplacement;
uniform float uDispThreshold;
uniform float uDispRange;
uniform float uDragStrength;
uniform float uMaxFlowSpeed;
uniform sampler2D uFluid;
uniform vec3 uCameraRightLocal;
uniform vec3 uCameraUpLocal;
varying vec2 vUv;
varying float vEnergy;
varying float vSeed;
varying vec3 vTrefoilColor;
varying vec3 vTrefoilPalette;

float hash(float n) { return fract(sin(n * 12.9898 + 78.233) * 43758.5453); }

const float TWO_PI = 6.28318530718;
const float GOLDEN_ANGLE = 2.39996322973;
const float MOTION_SOFT_KNEE = 0.55;
const float MOTION_RAW_RESPONSE_MIX = 0.72;
const float MOTION_RESPONSE_CAP = 1.75;
const float MOTION_JITTER_MIN = 0.94;
const float MOTION_JITTER_RANGE = 0.12;
const float MOTION_DRAG_DAMPING = 0.82;

// Trefoil (2,3) parametrisation. Range is roughly ±3 in each axis.
vec3 curve(float t) {
  return vec3(
    sin(t) + 2.0 * sin(2.0 * t),
    cos(t) - 2.0 * cos(2.0 * t),
    -sin(3.0 * t)
  );
}

void main() {
  float i = aIndex;
  float t = (i / uCount) * TWO_PI;

  // Tangent via finite difference; build a local frame with a fallback up.
  const float EPS = 0.0015;
  vec3 T = normalize(curve(t + EPS) - curve(t - EPS));
  vec3 up = abs(T.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 B = normalize(cross(T, up));
  vec3 N = normalize(cross(T, B));

  // Spiral around the tube via golden-angle phi. The radial vector below
  // doubles as the displacement direction when the fluid pushes outward.
  float phi = GOLDEN_ANGLE * i * 7.3;
  vec3 radial = N * cos(phi) + B * sin(phi);
  vec3 pos = (curve(t) + radial * uTubeRadius) * uScale;

  float particleEnergy = 0.0;
  vec4 mv0 = modelViewMatrix * vec4(pos, 1.0);
  vec4 clip = projectionMatrix * mv0;
  if (clip.w > 1e-4) {
    vec2 uv = (clip.xy / clip.w) * 0.5 + 0.5;
    if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
      vec3 fluid = texture2D(uFluid, uv).rgb;
      vec2 flow = fluid.rg;
      float density = fluid.b;

      float baseEnergy = smoothstep(
        uDispThreshold,
        uDispThreshold + uDispRange,
        density
      );
      float visualIntensity = clamp(baseEnergy * (0.7 + 0.6 * hash(i + 41.0)), 0.0, 1.3);
      float rawMotion = max((density - uDispThreshold) / max(uDispRange, 0.0001), 0.0);
      float softMotion = rawMotion / (rawMotion + MOTION_SOFT_KNEE) * MOTION_RESPONSE_CAP;
      float motionResponse = clamp(mix(baseEnergy, softMotion, MOTION_RAW_RESPONSE_MIX), 0.0, MOTION_RESPONSE_CAP);
      float motionJitter = MOTION_JITTER_MIN + MOTION_JITTER_RANGE * hash(i + 53.0);
      float displacementIntensity = clamp(motionResponse * motionJitter, 0.0, MOTION_RESPONSE_CAP);
      float dragIntensity = min(motionResponse, 1.0) * MOTION_DRAG_DAMPING;

      pos += radial * uScale * uTubeRadius * uDisplacement * displacementIntensity;

      // Planar drag — direction from flow, magnitude soft-clamped to
      // uMaxFlowSpeed, gated by the same intensity.
      float speed = length(flow);
      if (speed > 1e-4) {
        vec2 flowDir = flow / speed;
        float flowMag = min(speed / uMaxFlowSpeed, 1.0);
        pos += (flowDir.x * uCameraRightLocal + flowDir.y * uCameraUpLocal)
             * flowMag * uDragStrength * dragIntensity;
      }

      particleEnergy = visualIntensity;
    }
  }

  // Per-particle size variation (0.8..1.3), depth scaling.
  float sizeVar = 0.8 + 0.5 * hash(i);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  float depthScale = 1.0 / max(0.65, -mv.z);
  float worldSize = uPointSize * sizeVar * depthScale * 0.033;
  vec3 offset = (uCameraRightLocal * position.x + uCameraUpLocal * position.y) * worldSize;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos + offset, 1.0);
  vUv = uv;
  float colorSeed = hash(i + 17.0);
  float e = clamp(particleEnergy, 0.0, 1.0);
  float paletteA = fract(t * 0.22 + radial.x * 0.11 + radial.y * 0.07 + colorSeed * 0.18 + e * 0.26);
  float palettePhase = paletteA * TWO_PI;
  vec3 palette = vec3(cos(palettePhase), cos(palettePhase + 83.0), cos(palettePhase + 21.0)) * 0.56 + 0.55;
  float cyanAmount = smoothstep(0.62, 1.05, palette.z + palette.y * 0.55 - palette.x * 0.7);
  float whiteAmount = smoothstep(0.72, 1.0, min(min(palette.x, palette.y), palette.z));
  vec3 paletteWarm = palette * vec3(1.08, 0.93, 0.72) + vec3(0.025, 0.0, 0.0);
  palette = mix(palette, paletteWarm, min(0.5, cyanAmount * 0.28 + whiteAmount * 0.35));
  vEnergy = particleEnergy;
  vSeed = colorSeed;
  vTrefoilPalette = palette;
  vTrefoilColor = palette * (0.9 + e * 0.55) + vec3(0.18, 0.10, 0.04) * e;
}
`

const FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying float vEnergy;
varying float vSeed;
varying vec3 vTrefoilColor;
varying vec3 vTrefoilPalette;

const float POINT_SHAPE_RADIUS = 0.5;
const float POINT_EDGE_AA_MIN = 0.012;
const vec2 POINT_GRADIENT_FOCUS = vec2(-0.12, 0.14);
const float POINT_CENTER_FALLOFF = 0.68;
const float POINT_CENTER_LIGHT_BOOST = 0.28;
const float POINT_CENTER_CHROMA_BOOST = 0.34;
const float POINT_CENTER_ALPHA_BOOST = 0.18;
const float POINT_COLOR_PEAK = 1.35;
const float POINT_DEPTH_ALPHA_CUTOFF = 0.04;

void main() {
  vec2 p = vUv - 0.5;
  float d = length(p);
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

  vec3 finalColor = vTrefoilColor * phongShade + vTrefoilPalette * specular;
  finalColor = finalColor * (1.0 + centerGradient * POINT_CENTER_LIGHT_BOOST)
    + vTrefoilPalette * (centerGradient * POINT_CENTER_CHROMA_BOOST);
  float peak = max(max(finalColor.r, finalColor.g), max(finalColor.b, POINT_COLOR_PEAK));
  finalColor *= POINT_COLOR_PEAK / peak;
  float visibleAlpha = min(1.0, alpha * (1.0 + centerGradient * POINT_CENTER_ALPHA_BOOST));
  if (visibleAlpha <= POINT_DEPTH_ALPHA_CUTOFF) {
    discard;
  }

  gl_FragColor = vec4(finalColor, visibleAlpha);
}
`

const stage = document.getElementById('stage')
if (!(stage instanceof HTMLElement)) throw new Error('Missing #stage')

const renderer = new WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
renderer.setClearColor(new Color('#07080b'), 1)
stage.appendChild(renderer.domElement)

const scene = new Scene()
const camera = new PerspectiveCamera(45, 1, 0.1, 100)
camera.position.set(0, 0, 5.5)

const fluid = new FluidSimulation(renderer, {
  splatRadius: DEFAULTS.splatRadius,
  splatForce: DEFAULTS.splatForce,
  pressureIterations: DEFAULTS.pressureIterations,
  curlStrength: DEFAULTS.curlStrength,
  velocityDissipation: DEFAULTS.velocityDissipation,
  densityDissipation: DEFAULTS.densityDissipation,
  pressureDissipation: DEFAULTS.pressureDissipation,
  enableVorticity: DEFAULTS.enableVorticity,
  bfecc: DEFAULTS.bfecc,
  reflectWalls: DEFAULTS.reflectWalls,
})
attachPointerSplats(renderer.domElement, fluid)

// One instanced quad per particle. The actual center position is computed in
// the vertex shader from aIndex; the quad corners form a camera-facing billboard.
const indices = new Float32Array(DEFAULTS.count)
for (let i = 0; i < DEFAULTS.count; i += 1) indices[i] = i
const geometry = new InstancedBufferGeometry()
geometry.setAttribute(
  'position',
  new BufferAttribute(
    new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
    3,
  ),
)
geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2))
geometry.setAttribute('aIndex', new InstancedBufferAttribute(indices, 1))
geometry.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1))
geometry.setDrawRange(0, 6)
geometry.instanceCount = DEFAULTS.count
geometry.boundingSphere = null
geometry.boundingBox = null

const material = new ShaderMaterial({
  vertexShader: VERTEX,
  fragmentShader: FRAGMENT,
  uniforms: {
    uCount: new Uniform(DEFAULTS.count),
    uTubeRadius: new Uniform(DEFAULTS.tubeRadius),
    uScale: new Uniform(DEFAULTS.scale),
    uPointSize: new Uniform(DEFAULTS.pointSize),
    uDisplacement: new Uniform(DEFAULTS.displacement),
    uDispThreshold: new Uniform(DEFAULTS.dispThreshold),
    uDispRange: new Uniform(DEFAULTS.dispRange),
    uDragStrength: new Uniform(DEFAULTS.dragStrength),
    uMaxFlowSpeed: new Uniform(DEFAULTS.maxFlowSpeed),
    // densityTexture is RG=velocity, B=density — the shader reads both
    // (B as displacement amount, RG as planar drag direction).
    uFluid: new Uniform(fluid.densityTexture),
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

const points = new InstancedMesh(geometry, material, DEFAULTS.count)
const identity = new Matrix4()
for (let i = 0; i < DEFAULTS.count; i += 1) {
  points.setMatrixAt(i, identity)
}
points.instanceMatrix.needsUpdate = true
points.frustumCulled = false
scene.add(points)

const resize = (): void => {
  const w = Math.max(1, stage.clientWidth)
  const h = Math.max(1, stage.clientHeight)
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  fluid.resize(w, h)
}
resize()
window.addEventListener('resize', resize)

const clock = new Timer()
let spinAngle = 0
const modelRotation = new Matrix3()
const invModelRotation = new Matrix3()
const cameraRight = new Vector3()
const cameraUp = new Vector3()
renderer.setAnimationLoop(() => {
  clock.update()
  const dt = Math.min(Math.max(clock.getDelta(), 1e-6), 1 / 30)
  const fluidDt = Math.min(dt, 1 / 60)
  fluid.step(fluidDt)

  // Slow autonomous spin to admire the knot's topology.
  spinAngle += DEFAULTS.rotationSpeed * dt
  points.rotation.y = spinAngle
  points.updateMatrixWorld(true)
  modelRotation.setFromMatrix4(points.matrixWorld)
  invModelRotation.copy(modelRotation).invert()

  const u = material.uniforms
  u.uFluid.value = fluid.densityTexture
  cameraRight.setFromMatrixColumn(camera.matrixWorld, 0)
  cameraUp.setFromMatrixColumn(camera.matrixWorld, 1)
  u.uCameraRightLocal.value.copy(cameraRight).applyMatrix3(invModelRotation).normalize()
  u.uCameraUpLocal.value.copy(cameraUp).applyMatrix3(invModelRotation).normalize()

  renderer.render(scene, camera)
})

window.addEventListener('pagehide', () => {
  renderer.setAnimationLoop(null)
  scene.remove(points)
  geometry.dispose()
  material.dispose()
  fluid.dispose()
  renderer.dispose()
  renderer.domElement.remove()
})
