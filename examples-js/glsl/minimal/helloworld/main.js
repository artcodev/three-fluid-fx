import '../../../../src/styles.css'
import { ShaderMaterial, Timer, Uniform, WebGLRenderer } from 'three'
import {
  attachPointerSplats,
  FluidSimulation,
  FULLSCREEN_VERTEX,
  FullscreenPass,
} from 'three-fluid-fx'
const DEFAULTS = {
  splatRadius: 0.001,
  splatForce: 6,
  reflectWalls: false,
}
const stage = document.getElementById('stage')
if (!(stage instanceof HTMLElement)) throw new Error('Missing #stage element')
// `alpha: true` makes the canvas itself transparent — fragments with alpha
// less than 1 let the underlying HTML (the slide <img> in minimal.html)
// show through. `premultipliedAlpha: false` lets the shader output
// straight RGB + alpha (instead of pre-multiplied), which is what the
// fluid debug viz writes naturally.
const renderer = new WebGLRenderer({
  antialias: true,
  alpha: true,
  premultipliedAlpha: false,
})
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
// Position the canvas absolutely so it sits in the same stacking layer
// as the absolute-positioned <img> in minimal.html. Without this, the
// in-flow canvas would render behind the img regardless of DOM order.
renderer.domElement.style.position = 'absolute'
renderer.domElement.style.inset = '0'
stage.appendChild(renderer.domElement)
const fluid = new FluidSimulation(renderer, DEFAULTS)
attachPointerSplats(renderer.domElement, fluid)
const composite = new ShaderMaterial({
  vertexShader: FULLSCREEN_VERTEX,
  fragmentShader: /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tFluid;
    void main() {
      vec3 fluid = texture2D(tFluid, vUv).rgb;
      // Density (fluid.b) drives alpha — empty regions stay transparent so
      // the slide image shows through, active regions show velocity-coloured
      // fluid. The * 2.0 just makes light activity already visible.
      float a = clamp(fluid.b * 2.0, 0.0, 1.0);
      gl_FragColor = vec4(fluid, a);
    }
  `,
  uniforms: { tFluid: new Uniform(fluid.densityTexture) },
})
const pass = new FullscreenPass(composite)
const resize = () => {
  const w = Math.max(1, stage.clientWidth)
  const h = Math.max(1, stage.clientHeight)
  renderer.setSize(w, h, false)
  fluid.resize(w, h)
}
resize()
window.addEventListener('resize', resize)
const clock = new Timer()
renderer.setAnimationLoop(() => {
  clock.update()
  const dt = Math.min(Math.max(clock.getDelta(), 1e-6), 1 / 60)
  fluid.step(dt)
  composite.uniforms.tFluid.value = fluid.densityTexture
  pass.render(renderer, null)
})
