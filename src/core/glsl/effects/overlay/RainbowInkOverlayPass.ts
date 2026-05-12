import { Uniform, Vector2, type Texture, type WebGLRenderTarget } from 'three'
import { FluidEffectPass } from '../FluidEffectPass'
import type { FluidSimulation } from '../../simulation/FluidSimulation'

// Per-stroke colour gradient: each stroke draws a soft-rim → bright-body
// gradient where the rim hue is offset from the body hue, so a single drag
// reads as a coloured rainbow rolling into the stroke. The hue-shift
// amount itself depends on the base stroke hue, so different strokes get
// gradients of visibly different widths / directions.
const FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tDye;
uniform float uIntensity;
uniform vec2 uTexel;
uniform float uVibrance;

vec3 vibrant(vec3 c, float v) {
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  return clamp(mix(vec3(lum), c, 1.0 + v), 0.0, 1.0);
}

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

void main() {
  vec3 scene = texture2D(tDiffuse, vUv).rgb;

  vec3 dye = texture2D(tDye, vUv).rgb * 0.5;
  dye += texture2D(tDye, vUv + uTexel * vec2( 1.0,  1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2(-1.0,  1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2( 1.0, -1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2(-1.0, -1.0)).rgb * 0.125;

  float amp = length(dye);
  if (amp < 1e-4) {
    gl_FragColor = vec4(scene, 1.0);
    return;
  }

  float baseHue = rgb2hsv(dye / amp).x;
  float depth = pow(clamp(amp * 2.5, 0.0, 1.0), 0.7);

  float shiftMag = 0.32 + sin(baseHue * 6.28318 * 3.0) * 0.13;
  float hue = fract(baseHue + (1.0 - depth) * shiftMag);
  float sat = mix(0.75, 1.0, depth);

  vec3 col = vibrant(hsv2rgb(vec3(hue, sat, 1.0)), uVibrance);
  vec3 result = scene + col * depth * uIntensity * 1.2;
  gl_FragColor = vec4(result, 1.0);
}
`

/** Per-stroke rainbow gradient — soft-rim hue offset from bright-body hue. */
export class RainbowInkOverlayPass extends FluidEffectPass {
  intensity = 1
  vibrance = 0

  constructor(private readonly fluid: FluidSimulation) {
    super(
      FRAGMENT,
      {
        tDiffuse: new Uniform<Texture | null>(null),
        tDye: new Uniform<Texture | null>(null),
        uIntensity: new Uniform(1),
        uTexel: new Uniform(new Vector2(1 / 512, 1 / 512)),
        uVibrance: new Uniform(0),
      },
    )
  }

  protected updateUniforms(readBuffer: WebGLRenderTarget): void {
    const u = this.material.uniforms
    u.tDiffuse.value = readBuffer.texture
    u.tDye.value = this.fluid.dyeTexture
    u.uIntensity.value = this.intensity
    u.uVibrance.value = this.vibrance
    const img = this.fluid.dyeTexture.image as { width: number; height: number }
    ;(u.uTexel.value as Vector2).set(1 / img.width, 1 / img.height)
  }
}
