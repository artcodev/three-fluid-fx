import { Uniform, Vector2, type Texture, type WebGLRenderTarget } from 'three'
import { FluidEffectPass } from '../FluidEffectPass'
import type { FluidSimulation } from '../../simulation/FluidSimulation'

// Reads tFluid (RG=velocity, B=density). Each channel is shifted by its OWN
// combination of velocity components, so red/green/blue diverge in different
// directions — the iridescent / oil-slick look.
//
// Two anti-stripe measures vs. the naive form: (1) a 5-tap box-blur of the
// fluid field at source, because the live velocity is choppy across vortex
// cells and using it raw makes those cell boundaries show through as
// stripes; (2) a smooth density falloff (`pow`, not `smoothstep`) so the
// effect fades into the untouched scene without a visible mask edge.
const FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tFluid;
uniform float uIntensity;
uniform vec2 uTexel;

void main() {
  vec3 fluid = texture2D(tFluid, vUv).rgb * 0.36;
  fluid += texture2D(tFluid, vUv + vec2(uTexel.x * 2.0, 0.0)).rgb * 0.16;
  fluid += texture2D(tFluid, vUv - vec2(uTexel.x * 2.0, 0.0)).rgb * 0.16;
  fluid += texture2D(tFluid, vUv + vec2(0.0, uTexel.y * 2.0)).rgb * 0.16;
  fluid += texture2D(tFluid, vUv - vec2(0.0, uTexel.y * 2.0)).rgb * 0.16;

  vec2 vel = fluid.rg;
  float density = clamp(fluid.b, 0.0, 1.0);
  float falloff = pow(density, 1.2);

  vec2 chroma = vel * 0.003 * uIntensity * falloff;
  vec2 distUv = vUv - vel * 0.0002 * uIntensity * falloff;

  vec4 color;
  color.r = texture2D(tDiffuse, distUv + vec2( chroma.x,  chroma.y)).r;
  color.g = texture2D(tDiffuse, distUv + vec2(-chroma.x,  chroma.y)).g;
  color.b = texture2D(tDiffuse, distUv + vec2(-chroma.x, -chroma.y)).b;
  color.a = 1.0;
  gl_FragColor = color;
}
`

/** Iridescent oil-slick distortion — each RGB channel shifted by its own velocity components. */
export class ChromaticDistortionPass extends FluidEffectPass {
  intensity = 1

  constructor(private readonly fluid: FluidSimulation) {
    super(FRAGMENT, {
      tDiffuse: new Uniform<Texture | null>(null),
      tFluid: new Uniform<Texture | null>(null),
      uIntensity: new Uniform(1),
      uTexel: new Uniform(new Vector2(1 / 512, 1 / 512)),
    })
  }

  protected updateUniforms(readBuffer: WebGLRenderTarget): void {
    this.material.uniforms.tDiffuse.value = readBuffer.texture
    this.material.uniforms.tFluid.value = this.fluid.densityTexture
    this.material.uniforms.uIntensity.value = this.intensity
    const img = this.fluid.densityTexture.image as { width: number; height: number }
    ;(this.material.uniforms.uTexel.value as Vector2).set(1 / img.width, 1 / img.height)
  }
}
