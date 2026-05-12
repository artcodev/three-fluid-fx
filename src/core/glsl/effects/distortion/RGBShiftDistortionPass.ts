import { Uniform, type Texture, type WebGLRenderTarget } from 'three'
import { FluidEffectPass } from '../FluidEffectPass'
import type { FluidSimulation } from '../../simulation/FluidSimulation'

// Classic chromatic split: R and B sample either side of G along the flow
// direction, no base UV warp. Magnitude is driven by density (smooth and
// naturally local), direction is the *normalized* velocity — using `vel`
// directly mixes magnitude noise into the offset and produces visible
// stripes in vortex regions. pow(density, 1.4) crushes low-density noise
// so untouched regions stay sharp.
const FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tFluid;
uniform float uIntensity;

void main() {
  vec3 fluid = texture2D(tFluid, vUv).rgb;
  float density = clamp(fluid.b, 0.0, 1.0);
  vec2 vel = fluid.rg;

  float speed = max(length(vel), 1e-4);
  vec2 dir = vel / speed;
  float strength = pow(density, 1.4) * uIntensity * 0.012;
  vec2 shift = dir * strength;

  float r = texture2D(tDiffuse, vUv + shift).r;
  float g = texture2D(tDiffuse, vUv).g;
  float b = texture2D(tDiffuse, vUv - shift).b;

  gl_FragColor = vec4(r, g, b, 1.0);
}
`

/** Density-driven chromatic R/B split along the flow direction; G stays put. */
export class RGBShiftDistortionPass extends FluidEffectPass {
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
