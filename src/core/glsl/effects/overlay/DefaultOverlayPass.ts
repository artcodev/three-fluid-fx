import { Color, Uniform, Vector2, type Texture, type WebGLRenderTarget } from 'three'
import { FluidEffectPass } from '../FluidEffectPass'
import type { FluidSimulation } from '../../simulation/FluidSimulation'

// Saturation/value pulse haze with a *smooth* gradient through the body of
// the stroke. Two independent inputs drive the tint while hue stays locked:
// (a) wide-radius density probe (4 taps at ~8 texels) reveals deep-core →
// rim ramp through thick uniform paint; (b) local fluid speed boosts chroma
// in active flow regions, so a single advected stroke shows variation along
// its motion.
const FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tFluid;
uniform sampler2D tDye;
uniform float uIntensity;
uniform vec2 uTexel;
uniform vec3 uCursorColor;
uniform float uVibrance;

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

vec3 vibrant(vec3 col, float v) {
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  return clamp(mix(vec3(lum), col, 1.0 + v), 0.0, 1.0);
}

void main() {
  vec3 scene = texture2D(tDiffuse, vUv).rgb;

  vec3 dye = texture2D(tDye, vUv).rgb * 0.5;
  dye += texture2D(tDye, vUv + uTexel * vec2( 1.0,  1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2(-1.0,  1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2( 1.0, -1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2(-1.0, -1.0)).rgb * 0.125;

  float far = 0.0;
  far += length(texture2D(tDye, vUv + uTexel * vec2( 8.0,  0.0)).rgb);
  far += length(texture2D(tDye, vUv + uTexel * vec2(-8.0,  0.0)).rgb);
  far += length(texture2D(tDye, vUv + uTexel * vec2( 0.0,  8.0)).rgb);
  far += length(texture2D(tDye, vUv + uTexel * vec2( 0.0, -8.0)).rgb);
  far *= 0.25;
  float core = smoothstep(0.02, 0.55, far * uIntensity * 4.0);

  vec2 vel = texture2D(tFluid, vUv).rg;
  float kinetic = clamp(length(vel) * 0.02, 0.0, 1.0);

  vec3 hsv = rgb2hsv(uCursorColor);
  float sat = clamp(hsv.y * mix(0.20, 1.0, core) + kinetic * hsv.y * 0.35, 0.0, 1.0);
  float val = hsv.z * mix(0.78, 1.0, core);
  vec3 tint = vibrant(hsv2rgb(vec3(hsv.x, sat, val)), uVibrance);

  float density = clamp(length(dye) * uIntensity * 3.0, 0.0, 0.95);
  gl_FragColor = vec4(mix(scene, tint, density), 1.0);
}
`

/** Cursor-tinted dye haze with a smooth core/rim gradient through the stroke body. */
export class DefaultOverlayPass extends FluidEffectPass {
  intensity = 1
  vibrance = 0
  cursorColor: Color

  constructor(private readonly fluid: FluidSimulation) {
    const initialColor = new Color(0.85, 0.95, 1.0)
    super(
      FRAGMENT,
      {
        tDiffuse: new Uniform<Texture | null>(null),
        tFluid: new Uniform<Texture | null>(null),
        tDye: new Uniform<Texture | null>(null),
        uIntensity: new Uniform(1),
        uTexel: new Uniform(new Vector2(1 / 512, 1 / 512)),
        uCursorColor: new Uniform(initialColor.clone()),
        uVibrance: new Uniform(0),
      },
    )
    this.cursorColor = initialColor
  }

  protected updateUniforms(readBuffer: WebGLRenderTarget): void {
    const u = this.material.uniforms
    u.tDiffuse.value = readBuffer.texture
    u.tFluid.value = this.fluid.densityTexture
    u.tDye.value = this.fluid.dyeTexture
    u.uIntensity.value = this.intensity
    ;(u.uCursorColor.value as Color).copy(this.cursorColor)
    u.uVibrance.value = this.vibrance
    const img = this.fluid.dyeTexture.image as { width: number; height: number }
    ;(u.uTexel.value as Vector2).set(1 / img.width, 1 / img.height)
  }
}
