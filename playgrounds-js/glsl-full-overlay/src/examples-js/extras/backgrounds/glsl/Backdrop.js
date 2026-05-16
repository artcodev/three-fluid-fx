import { Color, Mesh, PlaneGeometry, ShaderMaterial, Uniform, Vector3 } from 'three'
// Ashima 2D simplex noise + 4-octave FBM. Shared between vertex (for the
// height displacement) and fragment (for sampling the same height field at
// cell corners to compute a per-cell normal — see fragment shader).
const NOISE_GLSL = /* glsl */ `
vec3 mod289_3(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289_2(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute3(vec3 x) { return mod289_3(((x * 34.0) + 1.0) * x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                     -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289_2(i);
  vec3 p = permute3(permute3(i.y + vec3(0.0, i1.y, 1.0))
        + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * snoise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}
`
const BACKDROP_VERTEX = /* glsl */ `
varying vec3 vWorldPos;
uniform float uTime;
uniform float uAmplitude;
uniform float uFrequency;
uniform float uSpeed;

${NOISE_GLSL}

void main() {
  vec3 pos = position;
  vec2 nuv = pos.xy * uFrequency + vec2(uTime * uSpeed, uTime * uSpeed * 0.6);
  pos.z += fbm(nuv) * uAmplitude;
  vec4 worldPos = modelMatrix * vec4(pos, 1.0);
  vWorldPos = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`
const BACKDROP_FRAGMENT = /* glsl */ `
precision highp float;
varying vec3 vWorldPos;

uniform vec3 uCameraPos;
uniform vec3 uLightAPos;
uniform vec3 uLightBPos;
uniform vec3 uLightAColor;
uniform vec3 uLightBColor;
uniform vec3 uBaseColor;
uniform float uShininess;
uniform float uSpecStrength;
uniform float uDiffStrength;
uniform float uOpacity;

void main() {
  // Per-fragment face normal via screen-space derivatives — gives flat
  // shading per triangle without rebuilding geometry as non-indexed.
  vec3 N = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
  vec3 V = normalize(uCameraPos - vWorldPos);
  if (dot(N, V) < 0.0) N = -N;

  vec3 LA = normalize(uLightAPos - vWorldPos);
  vec3 HA = normalize(LA + V);
  float diffA = max(dot(N, LA), 0.0);
  float specA = pow(max(dot(N, HA), 0.0), uShininess);

  vec3 LB = normalize(uLightBPos - vWorldPos);
  vec3 HB = normalize(LB + V);
  float diffB = max(dot(N, LB), 0.0);
  float specB = pow(max(dot(N, HB), 0.0), uShininess);

  vec3 color = uBaseColor;
  color += uLightAColor * (diffA * uDiffStrength + specA * uSpecStrength);
  color += uLightBColor * (diffB * uDiffStrength + specB * uSpecStrength);

  gl_FragColor = vec4(color, uOpacity);
}
`
const THEMES = {
  dark: {
    base: '#04060a',
    lightA: '#8c002e',
    lightB: '#1a40c8',
    shininess: 30,
    specStrength: 0.7,
    diffStrength: 0.28,
  },
  bright: {
    base: '#b02898',
    lightA: '#ff0070',
    lightB: '#5020e8',
    shininess: 22,
    specStrength: 0.7,
    diffStrength: 0.42,
  },
}
const SEGMENTS_Y = 12
/**
 * Procedural FBM-displaced backdrop with two orbiting lights. A `PlaneGeometry`
 * mesh sized to cover the camera frustum, sitting behind everything else in
 * the scene (`depthTest: false`, `position.z = -3`).
 *
 * Add the `mesh` to a scene and call `update(dt, elapsed)` once per frame.
 */
export class Backdrop {
  /**
   * @param camera The camera the backdrop sizes itself against (FOV + aspect).
   * @param theme  Initial colour theme. Switch later via `setTheme`.
   */
  constructor(camera, theme = 'dark') {
    Object.defineProperty(this, 'camera', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: camera,
    })
    Object.defineProperty(this, 'mesh', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0,
    })
    Object.defineProperty(this, 'material', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0,
    })
    Object.defineProperty(this, 'segX', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 1,
    })
    Object.defineProperty(this, 'segY', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: SEGMENTS_Y,
    })
    const initial = THEMES[theme]
    this.material = new ShaderMaterial({
      vertexShader: BACKDROP_VERTEX,
      fragmentShader: BACKDROP_FRAGMENT,
      uniforms: {
        uTime: new Uniform(0),
        uAmplitude: new Uniform(0.45),
        uFrequency: new Uniform(1.3),
        uSpeed: new Uniform(0.05),
        uCameraPos: new Uniform(new Vector3()),
        uLightAPos: new Uniform(new Vector3()),
        uLightBPos: new Uniform(new Vector3()),
        uLightAColor: new Uniform(new Color(initial.lightA)),
        uLightBColor: new Uniform(new Color(initial.lightB)),
        uBaseColor: new Uniform(new Color(initial.base)),
        uShininess: new Uniform(initial.shininess),
        uSpecStrength: new Uniform(initial.specStrength),
        uDiffStrength: new Uniform(initial.diffStrength),
        uOpacity: new Uniform(1),
      },
      depthWrite: false,
      depthTest: false,
      transparent: true,
      toneMapped: false,
    })
    this.mesh = new Mesh(new PlaneGeometry(1, 1, 1, SEGMENTS_Y), this.material)
    this.mesh.position.z = -3
  }
  /** Switch colour theme at runtime — updates light/base colour uniforms. */
  setTheme(theme) {
    const t = THEMES[theme]
    const u = this.material.uniforms
    u.uLightAColor.value.set(t.lightA)
    u.uLightBColor.value.set(t.lightB)
    u.uBaseColor.value.set(t.base)
    u.uShininess.value = t.shininess
    u.uSpecStrength.value = t.specStrength
    u.uDiffStrength.value = t.diffStrength
  }
  setOpacity(opacity) {
    const value = Math.min(Math.max(opacity, 0), 1)
    this.material.uniforms.uOpacity.value = value
    this.mesh.visible = value > 0.001
  }
  /** Advance time-driven uniforms (light orbit, FBM noise) and re-fit the
   *  mesh to the camera frustum. `dt` is unused — kept for `Background` shape. */
  update(_dt, elapsed) {
    this.ensureSegments(this.camera.aspect)
    const distance = this.camera.position.z - this.mesh.position.z
    const fov = (this.camera.fov * Math.PI) / 180
    const visibleHeight = 2 * Math.tan(fov / 2) * distance
    // Oversize so edge triangles tilted by displacement still cover the view.
    const overscan = 1.4
    this.mesh.scale.set(visibleHeight * this.camera.aspect * overscan, visibleHeight * overscan, 1)
    const u = this.material.uniforms
    u.uTime.value = elapsed
    u.uCameraPos.value.copy(this.camera.position)
    // Both lights orbit on a shared ellipse, 180° apart — the warm/cool
    // axis rotates around the scene while staying point-symmetric.
    const angle = elapsed * 0.15
    const x = Math.cos(angle) * 4.5
    const y = Math.sin(angle) * 2.5
    u.uLightAPos.value.set(x, y, -1.5)
    u.uLightBPos.value.set(-x, -y, -1.5)
  }
  dispose() {
    this.mesh.geometry.dispose()
    this.material.dispose()
  }
  ensureSegments(aspect) {
    const targetX = Math.max(1, Math.round(SEGMENTS_Y * aspect))
    if (targetX === this.segX && SEGMENTS_Y === this.segY) return
    this.segX = targetX
    this.segY = SEGMENTS_Y
    this.mesh.geometry.dispose()
    this.mesh.geometry = new PlaneGeometry(1, 1, targetX, SEGMENTS_Y)
  }
}
