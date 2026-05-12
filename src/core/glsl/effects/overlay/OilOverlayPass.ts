import { Uniform, type Texture, type WebGLRenderTarget } from 'three'
import { FluidEffectPass } from '../FluidEffectPass'
import type { FluidSimulation } from '../../simulation/FluidSimulation'

// Multi-tap density glow shaded by an animated ember/mint/cream palette —
// reads like an oil slick where colour shifts with flow speed and time.
const FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tFluid;
uniform float uIntensity;
uniform float uTime;
uniform float uVibrance;

vec3 vibrant(vec3 c, float v) {
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  return clamp(mix(vec3(lum), c, 1.0 + v), 0.0, 1.0);
}

vec3 palette(float t) {
  vec3 ember = vec3(1.0, 0.33, 0.20);
  vec3 mint = vec3(0.08, 0.78, 0.68);
  vec3 cream = vec3(1.0, 0.84, 0.55);
  return mix(mix(ember, cream, smoothstep(0.15, 0.85, t)), mint, smoothstep(0.55, 1.0, t) * 0.42);
}

void main() {
  vec4 scene = texture2D(tDiffuse, vUv);
  vec3 fluid = texture2D(tFluid, vUv).rgb;
  float density = clamp(fluid.b, 0.0, 1.0);
  float speed = length(fluid.rg);

  float trail = density;
  for (float i = 1.0; i < 6.0; i += 1.0) {
    vec2 offset = fluid.rg * i * 0.035;
    trail += texture2D(tFluid, vUv - offset).b * (1.0 - i / 7.0);
  }

  float glow = clamp(trail * uIntensity, 0.0, 1.0);
  vec3 color = vibrant(palette(fract(glow * 0.62 + speed * 0.015 + uTime * 0.025)), uVibrance);
  float alpha = clamp(glow * 0.58 + speed * 0.012, 0.0, 0.86);
  vec3 result = scene.rgb + color * alpha * 0.86;
  result = mix(result, color, alpha * 0.14);

  gl_FragColor = vec4(result, 1.0);
}
`

/** Multi-tap density glow shaded by an animated ember/mint/cream palette — reads like an oil slick. */
export class OilOverlayPass extends FluidEffectPass {
  intensity = 1
  time = 0
  vibrance = 0

  constructor(private readonly fluid: FluidSimulation) {
    super(
      FRAGMENT,
      {
        tDiffuse: new Uniform<Texture | null>(null),
        tFluid: new Uniform<Texture | null>(null),
        uIntensity: new Uniform(1),
        uTime: new Uniform(0),
        uVibrance: new Uniform(0),
      },
    )
  }

  protected updateUniforms(readBuffer: WebGLRenderTarget): void {
    const u = this.material.uniforms
    u.tDiffuse.value = readBuffer.texture
    u.tFluid.value = this.fluid.densityTexture
    u.uIntensity.value = this.intensity
    u.uTime.value = this.time
    u.uVibrance.value = this.vibrance
  }
}
