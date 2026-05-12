import { Uniform, type Texture, type WebGLRenderTarget } from 'three'
import { FluidEffectPass } from '../FluidEffectPass'
import type { FluidSimulation } from '../../simulation/FluidSimulation'

// Velocity-as-colour glaze additively over the scene. Uses the post-pressure
// pre-advection snapshot (`velocityProjectedTexture`) — same stage as
// FluidCursor's `vel_0`. Our velocity values are ~10-50× larger than
// FluidCursor's (pixel-units vs NDC-units splats), so we pre-scale before
// applying the canonical vel*1.5+0.1 formula.
const FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tVelocity;
uniform float uIntensity;

void main() {
  vec3 scene = texture2D(tDiffuse, vUv).rgb;
  vec2 raw = texture2D(tVelocity, vUv).xy;
  vec2 vel = raw * 0.04 * uIntensity;
  float len = clamp(length(vel), 0.0, 1.0);
  vel = vel * 1.5 + 0.1;
  vec3 col = vec3(vel.x, vel.y, 1.0);
  gl_FragColor = vec4(scene + col * len, 1.0);
}
`

/** Velocity field rendered as RG-coloured glaze additive over the scene. */
export class VelocityOverlayPass extends FluidEffectPass {
  intensity = 1

  constructor(private readonly fluid: FluidSimulation) {
    super(
      FRAGMENT,
      {
        tDiffuse: new Uniform<Texture | null>(null),
        tVelocity: new Uniform<Texture | null>(null),
        uIntensity: new Uniform(1),
      },
    )
  }

  protected updateUniforms(readBuffer: WebGLRenderTarget): void {
    const u = this.material.uniforms
    u.tDiffuse.value = readBuffer.texture
    u.tVelocity.value = this.fluid.velocityProjectedTexture
    u.uIntensity.value = this.intensity
  }
}
