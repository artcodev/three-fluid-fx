import { Uniform, Vector2, type Texture, type WebGLRenderTarget } from 'three'
import { FluidEffectPass } from '../FluidEffectPass'
import type { FluidSimulation } from '../../simulation/FluidSimulation'

// Colourful strokes: each pointer drag writes a hue-cycling colour into the
// dedicated dye FBO (see attachPointerSplats `coloredStrokes`), advected by
// velocity. The overlay reads that dye texture, applies a soft 5-tap bloom
// lift, and additively composites with a gain that compensates for the
// small splat scale used in attachPointerSplats.
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

void main() {
  vec3 scene = texture2D(tDiffuse, vUv).rgb;

  vec3 dye = texture2D(tDye, vUv).rgb * 0.5;
  dye += texture2D(tDye, vUv + uTexel * vec2( 1.0,  1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2(-1.0,  1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2( 1.0, -1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2(-1.0, -1.0)).rgb * 0.125;

  // Stroke colours are stored at ~0.3 amplitude (see attachPointerSplats).
  // The 3.0 gain restores them to a vibrant, saturated look.
  // Vibrance is applied in unit-amplitude space: pull out direction, boost,
  // then re-scale, so the magnitude (= alpha contribution) is preserved.
  float dyeAmp = length(dye);
  vec3 dyeBoosted = dyeAmp > 1e-5
    ? vibrant(dye / dyeAmp, uVibrance) * dyeAmp
    : dye;
  vec3 result = scene + dyeBoosted * uIntensity * 3.0;
  gl_FragColor = vec4(result, 1.0);
}
`

/** Per-stroke hue-cycling dye, soft 5-tap bloom, additive composite. */
export class ArtInkOverlayPass extends FluidEffectPass {
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
