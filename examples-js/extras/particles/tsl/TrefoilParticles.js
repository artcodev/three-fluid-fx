import {
  BufferAttribute,
  DoubleSide,
  InstancedBufferGeometry,
  InstancedMesh,
  Matrix3,
  Matrix4,
  NormalBlending,
  Vector3,
} from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  cameraProjectionMatrix,
  cameraViewMatrix,
  float,
  instanceIndex,
  mix,
  modelWorldMatrix,
  positionLocal,
  select,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { asNode, setMaterialOutput, setMaterialPosition } from '../../../tsl/shared/nodeInterop'
const DEFAULTS = {
  count: 4000,
  tubeRadius: 0.3,
  scale: 0.55,
  pointSize: 6,
  displacement: 1,
  dispThreshold: 0.08,
  dispRange: 0.3,
  dragStrength: 0.1,
  maxFlowSpeed: 10,
}
const TWO_PI = 6.28318530718
const GOLDEN_ANGLE = 2.39996322973
const EPS = 0.0015
const POINT_SHAPE_RADIUS = 0.5
const POINT_EDGE_AA_MIN = 0.012
const POINT_GRADIENT_FOCUS_X = -0.12
const POINT_GRADIENT_FOCUS_Y = 0.14
const POINT_CENTER_FALLOFF = 0.68
const POINT_CENTER_LIGHT_BOOST = 0.28
const POINT_CENTER_CHROMA_BOOST = 0.34
const POINT_CENTER_ALPHA_BOOST = 0.18
const POINT_COLOR_PEAK = 1.35
const POINT_DEPTH_ALPHA_CUTOFF = 0.04
const MOTION_SOFT_KNEE = 0.55
const MOTION_RAW_RESPONSE_MIX = 0.72
const MOTION_RESPONSE_CAP = 1.75
const MOTION_JITTER_MIN = 0.94
const MOTION_JITTER_RANGE = 0.12
const MOTION_DRAG_DAMPING = 0.82
function createBillboardGeometry(count) {
  const geometry = new InstancedBufferGeometry()
  geometry.setAttribute(
    'position',
    new BufferAttribute(
      new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
      3,
    ),
  )
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2))
  geometry.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1))
  geometry.setDrawRange(0, 6)
  geometry.instanceCount = count
  return geometry
}
class TrefoilParticleSystem {
  constructor(fluidNode, options = {}) {
    Object.defineProperty(this, 'mesh', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0,
    })
    Object.defineProperty(this, 'invModelRotation', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: new Matrix3(),
    })
    Object.defineProperty(this, 'tubeRadiusNode', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: uniform(DEFAULTS.tubeRadius),
    })
    Object.defineProperty(this, 'scaleNode', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: uniform(DEFAULTS.scale),
    })
    Object.defineProperty(this, 'pointSizeNode', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: uniform(DEFAULTS.pointSize),
    })
    Object.defineProperty(this, 'displacementNode', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: uniform(DEFAULTS.displacement),
    })
    Object.defineProperty(this, 'dispThresholdNode', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: uniform(DEFAULTS.dispThreshold),
    })
    Object.defineProperty(this, 'dispRangeNode', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: uniform(DEFAULTS.dispRange),
    })
    Object.defineProperty(this, 'dragStrengthNode', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: uniform(DEFAULTS.dragStrength),
    })
    Object.defineProperty(this, 'maxFlowSpeedNode', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: uniform(DEFAULTS.maxFlowSpeed),
    })
    Object.defineProperty(this, 'cameraRightLocalNode', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: uniform(new Vector3(1, 0, 0)),
    })
    Object.defineProperty(this, 'cameraUpLocalNode', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: uniform(new Vector3(0, 1, 0)),
    })
    const config = { ...DEFAULTS, ...options }
    const material = this.createMaterial(fluidNode, config.count)
    const geometry = createBillboardGeometry(config.count)
    this.mesh = new InstancedMesh(geometry, material, config.count)
    const identity = new Matrix4()
    for (let i = 0; i < config.count; i += 1) {
      this.mesh.setMatrixAt(i, identity)
    }
    this.mesh.instanceMatrix.needsUpdate = true
    this.mesh.frustumCulled = false
    this.update({
      cameraRight: new Vector3(1, 0, 0),
      cameraUp: new Vector3(0, 1, 0),
      modelRotation: new Matrix3(),
      tubeRadius: config.tubeRadius,
      scale: config.scale,
      pointSize: config.pointSize,
      displacement: config.displacement,
      dispThreshold: config.dispThreshold,
      dispRange: config.dispRange,
      dragStrength: config.dragStrength,
      maxFlowSpeed: config.maxFlowSpeed,
    })
  }
  update(params) {
    const invRotation = this.invModelRotation.copy(params.modelRotation).invert()
    const rightLocal = this.cameraRightLocalNode.value
    const upLocal = this.cameraUpLocalNode.value
    rightLocal.copy(params.cameraRight).applyMatrix3(invRotation).normalize()
    upLocal.copy(params.cameraUp).applyMatrix3(invRotation).normalize()
    this.tubeRadiusNode.value = params.tubeRadius
    this.scaleNode.value = params.scale
    this.pointSizeNode.value = params.pointSize
    this.displacementNode.value = params.displacement
    this.dispThresholdNode.value = params.dispThreshold
    this.dispRangeNode.value = params.dispRange
    this.dragStrengthNode.value = params.dragStrength
    this.maxFlowSpeedNode.value = params.maxFlowSpeed
  }
  dispose() {
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
  }
  createMaterial(fluidNode, count) {
    const material = new MeshBasicNodeMaterial()
    material.transparent = true
    material.depthTest = true
    material.depthWrite = true
    material.blending = NormalBlending
    material.alphaToCoverage = true
    material.toneMapped = false
    material.side = DoubleSide
    const index = float(instanceIndex)
    const countNode = float(count)
    const seed = hash(index)
    const tubeRadius = this.tubeRadiusNode
    const scale = this.scaleNode
    const pointSize = this.pointSizeNode
    const displacement = this.displacementNode
    const dispThreshold = this.dispThresholdNode
    const dispRange = this.dispRangeNode
    const dragStrength = this.dragStrengthNode
    const maxFlowSpeed = this.maxFlowSpeedNode
    const cameraRightLocal = this.cameraRightLocalNode
    const cameraUpLocal = this.cameraUpLocalNode
    const fluidTex = fluidNode
    const t = index.div(countNode).mul(TWO_PI)
    const center = curve(t)
    const tangent = curve(t.add(EPS))
      .sub(curve(t.sub(EPS)))
      .normalize()
    const fallbackUp = tangent.y
      .abs()
      .greaterThan(0.95)
      .select(vec3(1, 0, 0), vec3(0, 1, 0))
    const binormal = tangent.cross(fallbackUp).normalize()
    const normal = tangent.cross(binormal).normalize()
    const phi = index.mul(GOLDEN_ANGLE * 7.3)
    const radial = normal.mul(phi.cos()).add(binormal.mul(phi.sin()))
    const rest = center.add(radial.mul(tubeRadius)).mul(scale)
    const sample = fluidSample(fluidTex, rest)
    const visualIntensity = sample.energy
      .mul(float(0.7).add(float(0.6).mul(hash(index.add(41)))))
      .clamp(0, 1.3)
    const rawMotion = sample.density.sub(dispThreshold).div(dispRange.max(0.0001)).max(0)
    const softMotion = rawMotion.div(rawMotion.add(MOTION_SOFT_KNEE)).mul(MOTION_RESPONSE_CAP)
    const motionResponse = mix(sample.energy, softMotion, MOTION_RAW_RESPONSE_MIX).clamp(
      0,
      MOTION_RESPONSE_CAP,
    )
    const motionJitter = float(MOTION_JITTER_MIN).add(
      float(MOTION_JITTER_RANGE).mul(hash(index.add(53))),
    )
    const displacementIntensity = motionResponse.mul(motionJitter).clamp(0, MOTION_RESPONSE_CAP)
    const dragIntensity = motionResponse.min(1).mul(MOTION_DRAG_DAMPING)
    const energyVarying = visualIntensity.clamp(0, 1).toVarying('vTrefoilEnergy')
    const seedVarying = hash(index.add(17)).toVarying('vTrefoilSeed')
    const speed = sample.flow.length()
    const flowDir = sample.flow.div(speed.max(0.0001))
    const flowMag = speed.div(maxFlowSpeed.max(0.0001)).min(1)
    const drag = cameraRightLocal
      .mul(flowDir.x)
      .add(cameraUpLocal.mul(flowDir.y))
      .mul(flowMag)
      .mul(dragStrength)
      .mul(dragIntensity)
    const displaced = rest
      .add(radial.mul(scale).mul(tubeRadius).mul(displacement).mul(displacementIntensity))
      .add(drag)
    const corner = positionLocal
    const sizeVar = float(0.8).add(float(0.5).mul(seed))
    const viewPos = cameraViewMatrix.mul(modelWorldMatrix.mul(vec4(displaced, 1)))
    const depthScale = float(1).div(viewPos.z.negate().max(0.65))
    const worldSize = pointSize.mul(sizeVar).mul(depthScale).mul(0.033)
    const offset = cameraRightLocal.mul(corner.x).add(cameraUpLocal.mul(corner.y)).mul(worldSize)
    setMaterialPosition(material, asNode(displaced.add(offset)))
    const q = uv().sub(0.5)
    const d = q.length()
    const aa = d.fwidth().max(POINT_EDGE_AA_MIN)
    const alpha = float(1).sub(smoothstep(float(POINT_SHAPE_RADIUS).sub(aa), POINT_SHAPE_RADIUS, d))
    const gradientP = q.sub(vec2(POINT_GRADIENT_FOCUS_X, POINT_GRADIENT_FOCUS_Y))
    const centerGradient = float(1).sub(
      smoothstep(0, POINT_CENTER_FALLOFF, gradientP.length().div(POINT_SHAPE_RADIUS)),
    )
    const normalUv = gradientP.div(POINT_SHAPE_RADIUS)
    const normalZ = float(1).sub(normalUv.dot(normalUv)).max(0).sqrt()
    const pointNormal = vec3(normalUv.x, normalUv.y, normalZ).normalize()
    const lightDir = vec3(-0.42, 0.55, 0.72).normalize()
    const halfDir = vec3(-0.16, 0.22, 1).normalize()
    const diffuse = pointNormal.dot(lightDir).max(0)
    const specular = pointNormal.dot(halfDir).max(0).pow(18).mul(0.28)
    const phongShade = float(0.74)
      .add(diffuse.mul(0.42))
      .mul(float(0.84).add(normalZ.mul(0.16)))
    const energy = energyVarying
    const paletteA = t
      .mul(0.22)
      .add(radial.x.mul(0.11))
      .add(radial.y.mul(0.07))
      .add(seedVarying.mul(0.18))
      .add(energy.mul(0.26))
      .fract()
    const palettePhase = paletteA.mul(TWO_PI)
    let palette = vec3(palettePhase.cos(), palettePhase.add(83).cos(), palettePhase.add(21).cos())
      .mul(0.56)
      .add(0.55)
    const cyanAmount = smoothstep(
      0.62,
      1.05,
      palette.z.add(palette.y.mul(0.55)).sub(palette.x.mul(0.7)),
    )
    const whiteAmount = smoothstep(0.72, 1, palette.x.min(palette.y).min(palette.z))
    const paletteWarm = palette.mul(vec3(1.08, 0.93, 0.72)).add(vec3(0.025, 0, 0))
    palette = mix(palette, paletteWarm, cyanAmount.mul(0.28).add(whiteAmount.mul(0.35)).min(0.5))
    const baseColor = palette
      .mul(float(0.9).add(energy.mul(0.55)))
      .add(vec3(0.18, 0.1, 0.04).mul(energy))
    let finalColor = baseColor.mul(phongShade).add(palette.mul(specular))
    finalColor = finalColor
      .mul(float(1).add(centerGradient.mul(POINT_CENTER_LIGHT_BOOST)))
      .add(palette.mul(centerGradient).mul(POINT_CENTER_CHROMA_BOOST))
    const peak = finalColor.x.max(finalColor.y).max(finalColor.z).max(POINT_COLOR_PEAK)
    finalColor = finalColor.mul(float(POINT_COLOR_PEAK).div(peak))
    const visibleAlpha = alpha
      .mul(float(1).add(centerGradient.mul(POINT_CENTER_ALPHA_BOOST)))
      .min(1)
    material.opacityNode = visibleAlpha
    material.alphaTestNode = float(POINT_DEPTH_ALPHA_CUTOFF)
    setMaterialOutput(material, vec4(finalColor, visibleAlpha))
    return material
    function fluidSample(textureNode, localPosition) {
      const world = modelWorldMatrix.mul(vec4(localPosition, 1))
      const view = cameraViewMatrix.mul(world)
      const clip = cameraProjectionMatrix.mul(view)
      const safeW = clip.w.abs().max(0.0001)
      const screenUv = clip.xy.div(safeW).mul(0.5).add(0.5)
      const valid = select(clip.w.greaterThan(0.0001), 1, 0)
        .mul(select(screenUv.x.greaterThan(0), 1, 0))
        .mul(select(screenUv.x.lessThan(1), 1, 0))
        .mul(select(screenUv.y.greaterThan(0), 1, 0))
        .mul(select(screenUv.y.lessThan(1), 1, 0))
      const fluidUv = vec2(screenUv.x, float(1).sub(screenUv.y))
      const fluid = textureNode.sample(fluidUv).rgb
      const flow = fluid.rg.mul(valid)
      const density = fluid.b.mul(valid)
      const energy = smoothstep(dispThreshold, dispThreshold.add(dispRange), density)
      return { flow, density, energy }
    }
  }
}
function curve(t) {
  return vec3(
    t.sin().add(t.mul(2).sin().mul(2)),
    t.cos().sub(t.mul(2).cos().mul(2)),
    t.mul(3).sin().negate(),
  )
}
function hash(n) {
  return n.mul(12.9898).add(78.233).sin().mul(43758.5453).fract()
}
export function createTrefoilParticles(fluidNode, options = {}) {
  return new TrefoilParticleSystem(fluidNode, options)
}
