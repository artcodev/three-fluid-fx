import '../../../../src/styles.css'
import {
  Color,
  IcosahedronGeometry,
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

const DEFAULTS = {
  splatRadius: 0.001,
  splatForce: 6,
  reflectWalls: false,
}

const stage = document.getElementById('stage')
if (!(stage instanceof HTMLElement)) throw new Error('Missing #stage')

const renderer = new WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
renderer.setClearColor(new Color('#07080b'), 1)
stage.appendChild(renderer.domElement)

// Anything you would render normally — here a colourful blob.
const scene = new Scene()
const camera = new PerspectiveCamera(45, 1, 0.1, 100)
camera.position.set(0, 0, 4)
const blob = new Mesh(new IcosahedronGeometry(1.3, 2), new MeshNormalMaterial())
scene.add(blob)

const fluid = new FluidSimulation(renderer, DEFAULTS)
attachPointerSplats(renderer.domElement, fluid)

const sceneTarget = createSceneTarget(1, 1)

// The distortion shader: shift scene UVs by the fluid velocity field.
// `tFluid.rg` carries the smeared pointer vector; multiplying by 0.0003
// keeps the offset on the order of a few pixels per frame at peak flow.
const composite = new ShaderMaterial({
  vertexShader: FULLSCREEN_VERTEX,
  fragmentShader: /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform sampler2D tFluid;
    void main() {
      vec2 vel = texture2D(tFluid, vUv).rg;
      vec2 uv = clamp(vUv - vel * 0.0003, 0.0, 1.0);
      gl_FragColor = texture2D(tDiffuse, uv);
    }
  `,
  uniforms: {
    tDiffuse: new Uniform(sceneTarget.texture),
    tFluid: new Uniform(fluid.densityTexture),
  },
})
const pass = new FullscreenPass(composite)

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

const clock = new Timer()
renderer.setAnimationLoop(() => {
  clock.update()
  const fluidDt = Math.min(Math.max(clock.getDelta(), 1e-6), 1 / 60)
  blob.rotation.y += 0.003
  fluid.step(fluidDt)

  renderer.setRenderTarget(sceneTarget)
  renderer.clear()
  renderer.render(scene, camera)
  renderer.setRenderTarget(null)

  composite.uniforms.tDiffuse.value = sceneTarget.texture
  composite.uniforms.tFluid.value = fluid.densityTexture
  pass.render(renderer, null)
})
