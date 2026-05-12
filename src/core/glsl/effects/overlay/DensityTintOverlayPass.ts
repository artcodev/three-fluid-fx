import { Color, Uniform, type Texture, type WebGLRenderTarget } from 'three'
import { FluidEffectPass } from '../FluidEffectPass'
import type { FluidSimulation } from '../../simulation/FluidSimulation'

// Subtle additive tint by fluid density — the simplest "fluid cursor" hint.
// Used by the particle-displacement examples to lift active flow areas with
// a soft teal glow without otherwise modifying the scene. The composite is
// scene + tint * density * intensity, no modulation, no time-varying state.
const FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tFluid;
uniform float uIntensity;
uniform vec3 uTint;

void main() {
  vec3 scene = texture2D(tDiffuse, vUv).rgb;
  float density = clamp(texture2D(tFluid, vUv).b, 0.0, 1.0);
  gl_FragColor = vec4(scene + uTint * density * uIntensity, 1.0);
}
`

/** Subtle additive tint by fluid density — simplest 'fluid cursor' hint. */
export class DensityTintOverlayPass extends FluidEffectPass {
  /** Density-to-tint multiplier. Defaults match the original particle-
   *  displacement composite: `scene += vec3(0.10, 0.42, 0.36) * density * 0.14`,
   *  i.e. a teal tint at 0.14 intensity. */
  intensity = 0.14
  /** Tint colour added to the scene proportionally to fluid density. */
  color: Color

  constructor(private readonly fluid: FluidSimulation) {
    const initialColor = new Color(0.10, 0.42, 0.36)
    super(FRAGMENT, {
      tDiffuse: new Uniform<Texture | null>(null),
      tFluid: new Uniform<Texture | null>(null),
      uIntensity: new Uniform(0.14),
      uTint: new Uniform(initialColor.clone()),
    })
    this.color = initialColor
  }

  protected updateUniforms(readBuffer: WebGLRenderTarget): void {
    const u = this.material.uniforms
    u.tDiffuse.value = readBuffer.texture
    u.tFluid.value = this.fluid.densityTexture
    u.uIntensity.value = this.intensity
    ;(u.uTint.value as Color).copy(this.color)
  }
}
