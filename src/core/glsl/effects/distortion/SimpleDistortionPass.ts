import { Uniform, type Texture, type WebGLRenderTarget } from 'three'
import { FluidEffectPass } from '../FluidEffectPass'
import type { FluidSimulation } from '../../simulation/FluidSimulation'

// Plain UV warp by velocity — no chromatic split, single texture lookup.
// The cheapest of the distortion family; baseline reference for the others.
const FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tFluid;
uniform float uIntensity;

void main() {
  vec3 fluid = texture2D(tFluid, vUv).rgb;
  vec2 vel = fluid.rg;
  vec2 uv = vUv - vel * uIntensity * 0.0003;
  uv = clamp(uv, 0.0, 1.0);
  gl_FragColor = texture2D(tDiffuse, uv);
}
`

/** Plain UV warp by velocity — no chromatic split, single texture lookup. Cheapest of the distortion family. */
export class SimpleDistortionPass extends FluidEffectPass {
  intensity = 1

  constructor(private readonly fluid: FluidSimulation) {
    super(FRAGMENT, {
      tDiffuse: new Uniform<Texture | null>(null),
      tFluid: new Uniform<Texture | null>(null),
      uIntensity: new Uniform(1),
    })
  }

  protected updateUniforms(readBuffer: WebGLRenderTarget): void {
    this.material.uniforms.tDiffuse.value = readBuffer.texture
    this.material.uniforms.tFluid.value = this.fluid.densityTexture
    this.material.uniforms.uIntensity.value = this.intensity
  }
}
