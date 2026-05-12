import '../../../../src/styles.css'
import {
  BoxGeometry,
  Color,
  Mesh,
  MeshNormalMaterial,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  Timer,
  Uniform,
  WebGLRenderer,
} from 'three'
import {
  attachPointerSplats,
  createSceneTarget,
  FluidSimulation,
  FULLSCREEN_VERTEX,
  FullscreenPass,
} from 'three-fluid-fx'

// All knobs in one place — change here, propagated everywhere.
const DEFAULTS = {
  splatRadius: 0.001,
  splatForce: 6,
  reflectWalls: false,
  opacity: 1,
}

// 1. Renderer + DOM
const stage = document.getElementById('stage')
if (!(stage instanceof HTMLElement)) throw new Error('Missing #stage')

const renderer = new WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
renderer.setClearColor(new Color('#07080b'), 1)
stage.appendChild(renderer.domElement)

// 2. Your scene — anything you would render normally
const scene = new Scene()
const camera = new PerspectiveCamera(45, 1, 0.1, 100)
camera.position.set(0, 0, 4)
const cube = new Mesh(new BoxGeometry(1.4, 1.4, 1.4), new MeshNormalMaterial())
scene.add(cube)

// 3. Fluid solver + pointer
const fluid = new FluidSimulation(renderer, DEFAULTS)
attachPointerSplats(renderer.domElement, fluid)

// 4. Offscreen target for the rendered scene + composite shader
const sceneTarget = createSceneTarget(1, 1)
const composite = new ShaderMaterial({
  vertexShader: FULLSCREEN_VERTEX,
  fragmentShader: /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform sampler2D tFluid;
    uniform float uOpacity;
    void main() {
      vec3 scene = texture2D(tDiffuse, vUv).rgb;
      float density = texture2D(tFluid, vUv).b;
      vec3 trail = vec3(1.0, 0.4, 0.2) * density;
      gl_FragColor = vec4(mix(scene, scene + trail, uOpacity), 1.0);
    }
  `,
  uniforms: {
    tDiffuse: new Uniform(sceneTarget.texture),
    tFluid: new Uniform(fluid.densityTexture),
    uOpacity: new Uniform(DEFAULTS.opacity),
  },
})
const pass = new FullscreenPass(composite)

// 5. Resize
const resize = (): void => {
  const w = Math.max(1, stage.clientWidth)
  const h = Math.max(1, stage.clientHeight)
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  sceneTarget.setSize(Math.floor(w * dpr), Math.floor(h * dpr))
  fluid.resize(w, h)
}
resize()
window.addEventListener('resize', resize)

// 6. Loop: render scene → step fluid → composite
const clock = new Timer()
renderer.setAnimationLoop(() => {
  clock.update()
  const fluidDt = Math.min(Math.max(clock.getDelta(), 1e-6), 1 / 60)
  cube.rotation.y += 0.005
  fluid.step(fluidDt)

  renderer.setRenderTarget(sceneTarget)
  renderer.clear()
  renderer.render(scene, camera)
  renderer.setRenderTarget(null)

  composite.uniforms.tDiffuse.value = sceneTarget.texture
  composite.uniforms.tFluid.value = fluid.densityTexture
  composite.uniforms.uOpacity.value = DEFAULTS.opacity
  pass.render(renderer, null)
})
