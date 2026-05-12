import { Uniform, Vector2, type Texture, type WebGLRenderTarget } from 'three'
import { FluidEffectPass } from '../FluidEffectPass'
import type { FluidSimulation } from '../../simulation/FluidSimulation'

// Same 5-tap dye bloom + x3 gain as Art Ink, but the per-stroke colour is
// discarded. Dye intensity (length of RGB) becomes the smoke density driving
// an alpha composite against a white tint. The "play" comes for free from
// dye advection.
const FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tDye;
uniform float uIntensity;
uniform vec2 uTexel;

void main() {
  vec3 scene = texture2D(tDiffuse, vUv).rgb;

  vec3 dye = texture2D(tDye, vUv).rgb * 0.5;
  dye += texture2D(tDye, vUv + uTexel * vec2( 1.0,  1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2(-1.0,  1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2( 1.0, -1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2(-1.0, -1.0)).rgb * 0.125;

  float density = clamp(length(dye) * uIntensity * 3.0, 0.0, 0.95);
  vec3 smokeColor = vec3(0.95, 0.97, 1.0);
  gl_FragColor = vec4(mix(scene, smokeColor, density), 1.0);
}
`

/** White cigarette-smoke wash driven by per-stroke dye intensity. */
export class SmokeOverlayPass extends FluidEffectPass {
  intensity = 1

  constructor(private readonly fluid: FluidSimulation) {
    super(
      FRAGMENT,
      {
        tDiffuse: new Uniform<Texture | null>(null),
        tDye: new Uniform<Texture | null>(null),
        uIntensity: new Uniform(1),
        uTexel: new Uniform(new Vector2(1 / 512, 1 / 512)),
      },
    )
  }

  protected updateUniforms(readBuffer: WebGLRenderTarget): void {
    const u = this.material.uniforms
    u.tDiffuse.value = readBuffer.texture
    u.tDye.value = this.fluid.dyeTexture
    u.uIntensity.value = this.intensity
    const img = this.fluid.dyeTexture.image as { width: number; height: number }
    ;(u.uTexel.value as Vector2).set(1 / img.width, 1 / img.height)
  }
}
