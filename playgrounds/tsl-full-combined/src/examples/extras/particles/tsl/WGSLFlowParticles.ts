/**
 * WebGPU/WGSL GPGPU particles driven by an external 2D velocity texture.
 *
 * Simulation state lives in ping-ponged storage textures. Rendering is a TSL
 * instanced billboard material that samples the current position/velocity
 * textures, avoiding WebGPU's 1px point-size limitation.
 */
import {
  BufferAttribute,
  DataUtils,
  DoubleSide,
  InstancedBufferGeometry,
  InstancedMesh,
  Matrix3,
  Matrix4,
  NormalBlending,
  Vector3,
} from 'three'
import {
  HalfFloatType,
  MeshBasicNodeMaterial,
  NearestFilter,
  RGBAFormat,
  StorageTexture,
  type Renderer,
  type Texture,
  type TextureNode,
} from 'three/webgpu'
import {
  cos,
  float,
  floor,
  instanceIndex,
  mix,
  positionLocal,
  sin,
  smoothstep,
  texture as textureFn,
  uint,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
  time,
} from 'three/tsl'
import { asNode, setMaterialOutput, setMaterialPosition } from '../../../tsl/shared/nodeInterop'

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any

export type ParticleMode = 'plane2d' | 'cloud3d'

export interface FlowParticlesOptions {
  mode: ParticleMode
  size?: number
}

export interface FlowParticlesStepParams {
  dt: number
  velocityField: Texture
  viewMatrix: Matrix4
  projectionMatrix: Matrix4
  modelMatrix?: Matrix4
  cameraRight: Vector3
  cameraUp: Vector3
  modelRotation: Matrix3
  pointSize: number
  spring: number
  zeta: number
  dragLin: number
  dragQuad: number
  aMax: number
  vMaxScale: number
  flowStrength: number
  depthLift: number
  flowThreshold: number
  maxFlowSpeed: number
  responseGamma: number
  perpendicularAngle: number
  sideVariation: number
  depthAttenuationScale: number
}

export interface FlowParticles {
  mesh: InstancedMesh<InstancedBufferGeometry, MeshBasicNodeMaterial>
  step: (params: FlowParticlesStepParams) => void
  setDestinationData: (data: Float32Array) => void
  reset: () => void
  dispose: () => void
}

interface StorageDouble {
  read: StorageTexture
  write: StorageTexture
}

interface WebGPUBackendLike {
  isWebGPUBackend?: boolean
  device: GPUDevice
  get(object: object): { texture?: GPUTexture }
}

interface TextureBinding {
  binding: number
  texture: Texture
}

interface SamplerBinding {
  binding: number
  sampler: 'linear'
}

type BindingResource = TextureBinding | SamplerBinding
type KernelName = 'initPosition' | 'initVelocity' | 'velocity' | 'position'

const WORKGROUP_X = 8
const WORKGROUP_Y = 8
const UNIFORM_FLOATS = 80
const UNIFORM_BYTES = UNIFORM_FLOATS * 4
const TEXTURE_FORMAT = 'rgba16float'
const DEFAULT_POINT_SIZE = 10
const BILLBOARD_WORLD_UNITS_PER_POINT_SIZE = 0.006
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

const WGSL_COMMON = /* wgsl */ `
struct Params {
  a: vec4<f32>,
  b: vec4<f32>,
  c: vec4<f32>,
  d: vec4<f32>,
  e: vec4<f32>,
  cameraRight: vec4<f32>,
  cameraUp: vec4<f32>,
  view: mat4x4<f32>,
  projection: mat4x4<f32>,
  modelRotation: mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> params: Params;

fn texSize() -> u32 {
  return u32(params.a.x);
}

fn inBounds(coord: vec2<u32>) -> bool {
  let size = texSize();
  return coord.x < size && coord.y < size;
}

fn loadTex(tex: texture_2d<f32>, coord: vec2<u32>) -> vec4<f32> {
  return textureLoad(tex, vec2<i32>(i32(coord.x), i32(coord.y)), 0);
}

fn hash11(n: f32) -> f32 {
  return fract(sin(n) * 43758.5453123);
}

fn invRotation3() -> mat3x3<f32> {
  let a = params.modelRotation[0].xyz;
  let b = params.modelRotation[1].xyz;
  let c = params.modelRotation[2].xyz;
  let bc = cross(b, c);
  let ca = cross(c, a);
  let ab = cross(a, b);
  let det = dot(a, bc);
  let safeDet = select(det, select(-0.00001, 0.00001, det >= 0.0), abs(det) < 0.00001);

  return mat3x3<f32>(
    vec3<f32>(bc.x, ca.x, ab.x) / safeDet,
    vec3<f32>(bc.y, ca.y, ab.y) / safeDet,
    vec3<f32>(bc.z, ca.z, ab.z) / safeDet
  );
}
`

const WGSL_SHADERS: Record<KernelName, string> = {
  initPosition: /* wgsl */ `
${WGSL_COMMON}
@group(0) @binding(1) var positionRead: texture_storage_2d<${TEXTURE_FORMAT}, write>;
@group(0) @binding(2) var positionWrite: texture_storage_2d<${TEXTURE_FORMAT}, write>;
@group(0) @binding(3) var destinationTex: texture_storage_2d<${TEXTURE_FORMAT}, write>;

@compute @workgroup_size(${WORKGROUP_X}, ${WORKGROUP_Y}, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let coord = gid.xy;
  if (!inBounds(coord)) {
    return;
  }

  let size = texSize();
  let idx = coord.y * size + coord.x;
  let count = size * size;
  let fidx = f32(idx);
  let fcount = f32(count);
  let golden = 2.399963229728653;

  var pos = vec3<f32>(0.0, 0.0, 0.0);
  var stiffness = 1.15;

  if (params.a.z < 0.5) {
    let angle = fidx * golden;
    let r01 = sqrt((fidx + 0.5) / fcount);
    let radius = r01 * 2.0;
    pos = vec3<f32>(cos(angle) * radius, sin(angle) * radius, 0.0);
    stiffness = 1.15;
  } else {
    let yNorm = 1.0 - 2.0 * ((fidx + 0.5) / fcount);
    let ring = sqrt(max(0.0, 1.0 - yNorm * yNorm));
    let theta = fidx * golden;
    pos = vec3<f32>(cos(theta) * ring * 2.0, yNorm * 2.0, sin(theta) * ring * 2.0);
    stiffness = 0.82;
  }

  let position = vec4<f32>(pos, 1.0);
  let destination = vec4<f32>(pos, stiffness);

  textureStore(positionRead, coord, position);
  textureStore(positionWrite, coord, position);
  textureStore(destinationTex, coord, destination);
}
`,

  initVelocity: /* wgsl */ `
${WGSL_COMMON}
@group(0) @binding(1) var velocityRead: texture_storage_2d<${TEXTURE_FORMAT}, write>;
@group(0) @binding(2) var velocityWrite: texture_storage_2d<${TEXTURE_FORMAT}, write>;
@group(0) @binding(3) var attributeTex: texture_storage_2d<${TEXTURE_FORMAT}, write>;

@compute @workgroup_size(${WORKGROUP_X}, ${WORKGROUP_Y}, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let coord = gid.xy;
  if (!inBounds(coord)) {
    return;
  }

  let size = texSize();
  let idx = coord.y * size + coord.x;
  let fidx = f32(idx);
  let seed = fract(fidx * 0.61803398875);

  var vmax = 3.2;
  var particleScale = 0.8 + hash11(fidx * 12.9898 + 78.233) * 0.5;
  if (params.a.z >= 0.5) {
    vmax = 2.6;
    particleScale = 0.75 + hash11(fidx * 12.9898 + 78.233) * 0.6;
  }

  let velocity = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  let attr = vec4<f32>(particleScale, vmax, 0.0, seed);

  textureStore(velocityRead, coord, velocity);
  textureStore(velocityWrite, coord, velocity);
  textureStore(attributeTex, coord, attr);
}
`,

  velocity: /* wgsl */ `
${WGSL_COMMON}
@group(0) @binding(1) var positionTex: texture_2d<f32>;
@group(0) @binding(2) var velocityTex: texture_2d<f32>;
@group(0) @binding(3) var destinationTex: texture_2d<f32>;
@group(0) @binding(4) var attributeTex: texture_2d<f32>;
@group(0) @binding(5) var flowTex: texture_2d<f32>;
@group(0) @binding(6) var linearSampler: sampler;
@group(0) @binding(7) var velocityWrite: texture_storage_2d<${TEXTURE_FORMAT}, write>;

@compute @workgroup_size(${WORKGROUP_X}, ${WORKGROUP_Y}, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let coord = gid.xy;
  if (!inBounds(coord)) {
    return;
  }

  let position = loadTex(positionTex, coord);
  let velocity = loadTex(velocityTex, coord);
  let destination = loadTex(destinationTex, coord);
  let attr = loadTex(attributeTex, coord);

  var pos = position.xyz;
  var vel = velocity.xyz;
  let dest = destination.xyz;
  let stiffness = destination.w;
  let vmax = attr.y * params.c.y;
  let seed = attr.w;
  let dt = params.a.y;
  let planeLock = params.a.w;

  let omega = params.b.x * max(0.0, stiffness);
  let error = dest - pos;
  let aSpring = omega * omega * error;
  let aDamp = -2.0 * params.b.y * omega * vel;

  let speed = length(vel);
  var aDrag = vec3<f32>(0.0);
  if (speed > 0.00001) {
    aDrag = -params.b.z * vel - params.b.w * speed * vel;
  }

  let aCore = aSpring + aDamp + aDrag;
  var aFlow = vec3<f32>(0.0);

  let worldPos = (params.modelRotation * vec4<f32>(pos, 1.0)).xyz;
  let invModelRotation = invRotation3();
  let clip = params.projection * params.view * vec4<f32>(worldPos, 1.0);
  if (clip.w > 0.00001) {
    let ndc = clip.xy / clip.w;
    let flowUv = ndc * 0.5 + vec2<f32>(0.5);
    if (flowUv.x > 0.0 && flowUv.x < 1.0 && flowUv.y > 0.0 && flowUv.y < 1.0) {
      var flow = textureSampleLevel(flowTex, linearSampler, vec2<f32>(flowUv.x, 1.0 - flowUv.y), 0.0).xy;
      let flowMag = length(flow);
      let norm = (flowMag - params.d.x) / max(0.00001, params.d.y);
      var factor = smoothstep(0.0, 1.0, clamp(norm, 0.0, 1.0));
      factor = pow(factor, max(1.0, params.d.z));
      flow *= factor;
      flow *= min(1.0, params.d.y / max(flowMag, 0.00001));

      let flowWorld = flow.x * params.cameraRight.xyz + flow.y * params.cameraUp.xyz;
      let flowLocal = invModelRotation * flowWorld;
      aFlow += flowLocal * params.c.z;

      if (params.c.w > 0.0 && length(flowLocal) > 0.00001) {
        let forward = normalize(cross(params.cameraRight.xyz, params.cameraUp.xyz));
        let forwardLocal = invModelRotation * forward;
        let flowDir = normalize(flowLocal);
        var sideDir = cross(forwardLocal, flowDir);
        if (length(sideDir) > 0.00001) {
          sideDir = normalize(sideDir);
        }
        let sideSign = select(-1.0, 1.0, hash11(seed * 12.9898) > 0.5);
        let perSeed = mix(
          1.0,
          mix(0.35, 1.0, hash11(seed * 37.719)),
          clamp(params.e.x, 0.0, 1.0)
        );
        aFlow += sideDir * sideSign * perSeed * length(flow) * params.d.w * params.c.w;
        aFlow += forwardLocal * (hash11(seed * 91.17) - 0.5) * length(flow) * 0.18 * params.c.w;
      }

      let forwardW = normalize(cross(params.cameraRight.xyz, params.cameraUp.xyz));
      let signedDepth = dot(worldPos, forwardW);
      let behind = max(0.0, -signedDepth) / max(params.e.y, 0.01);
      aFlow *= exp(-behind * behind);
    }
  }

  var acceleration = aCore + aFlow;
  acceleration.z = mix(acceleration.z, aCore.z, planeLock);

  var aMag = length(acceleration);
  if (aMag > params.c.x) {
    acceleration = acceleration / aMag * params.c.x;
    aMag = params.c.x;
  }

  vel += acceleration * dt;
  vel.z = mix(vel.z, 0.0, planeLock);

  var newSpeed = length(vel);
  if (newSpeed > vmax) {
    vel = vel / newSpeed * vmax;
    newSpeed = vmax;
  }

  let velCore = velocity.xyz + aCore * dt;
  let flowEnergy = length(vel - velCore);
  let desiredEnergy = smoothstep(0.15, 2.8, newSpeed) * 0.35
    + smoothstep(0.05, 1.8, flowEnergy) * 1.35;
  let alpha = 1.0 - pow(0.5, dt / 0.08);
  let energy = mix(velocity.w, desiredEnergy, alpha);

  textureStore(velocityWrite, coord, vec4<f32>(vel, energy));
}
`,

  position: /* wgsl */ `
${WGSL_COMMON}
@group(0) @binding(1) var positionTex: texture_2d<f32>;
@group(0) @binding(2) var velocityTex: texture_2d<f32>;
@group(0) @binding(3) var destinationTex: texture_2d<f32>;
@group(0) @binding(4) var positionWrite: texture_storage_2d<${TEXTURE_FORMAT}, write>;

@compute @workgroup_size(${WORKGROUP_X}, ${WORKGROUP_Y}, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let coord = gid.xy;
  if (!inBounds(coord)) {
    return;
  }

  let position = loadTex(positionTex, coord);
  let velocity = loadTex(velocityTex, coord);
  let destination = loadTex(destinationTex, coord);
  let dt = params.a.y;
  let planeLock = params.a.w;

  var pos = position.xyz + velocity.xyz * dt;
  pos.z = mix(pos.z, destination.z, planeLock);

  textureStore(positionWrite, coord, vec4<f32>(pos, 1.0));
}
`,
}

function makeStorageTarget(size: number, name: string): StorageTexture {
  const texture = new StorageTexture(size, size)
  texture.name = name
  texture.format = RGBAFormat
  texture.type = HalfFloatType
  texture.generateMipmaps = false
  texture.minFilter = NearestFilter
  texture.magFilter = NearestFilter
  ;(texture as Any).mipmapsAutoUpdate = false
  return texture
}

function makeStorageDouble(size: number, name: string): StorageDouble {
  return {
    read: makeStorageTarget(size, `${name}.read`),
    write: makeStorageTarget(size, `${name}.write`),
  }
}

function swap(target: StorageDouble): void {
  const read = target.read
  target.read = target.write
  target.write = read
}

function disposeDouble(target: StorageDouble): void {
  target.read.dispose()
  target.write.dispose()
}

function createBillboardGeometry(size: number): InstancedBufferGeometry {
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
  geometry.instanceCount = size * size
  return geometry
}

export function createWGSLFlowParticles(
  renderer: Renderer,
  options: FlowParticlesOptions,
): FlowParticles {
  return new WGSLFlowParticles(renderer, options)
}

class WGSLFlowParticles implements FlowParticles {
  readonly mesh: InstancedMesh<InstancedBufferGeometry, MeshBasicNodeMaterial>

  private readonly renderer: Renderer
  private readonly backend: WebGPUBackendLike
  private readonly device: GPUDevice
  private readonly size: number
  private readonly mode: ParticleMode
  private readonly position: StorageDouble
  private readonly velocity: StorageDouble
  private readonly destination: StorageTexture
  private readonly attributes: StorageTexture
  private readonly linearSampler: GPUSampler
  private readonly pipelines: Record<KernelName, GPUComputePipeline>
  private readonly uniformBuffers: GPUBuffer[] = []
  private readonly textureViews = new Map<number, GPUTextureView>()
  private readonly bindGroups = new Map<string, GPUBindGroup>()
  private readonly externalTextures = new Map<number, Texture>()
  private readonly externalTextureDisposeHandlers = new Map<number, () => void>()
  private readonly ownedTextureIds = new Set<number>()
  private readonly params = new Float32Array(UNIFORM_FLOATS)
  private readonly pointSizeNode = uniform(DEFAULT_POINT_SIZE)
  private readonly cameraRightLocalNode = uniform(new Vector3(1, 0, 0))
  private readonly cameraUpLocalNode = uniform(new Vector3(0, 1, 0))
  private readonly positionTextureNode: TextureNode
  private readonly velocityTextureNode: TextureNode
  private readonly invModelRotation = new Matrix3()
  private readonly modelRotationMatrix = new Matrix4()
  private readonly destinationUpload: Uint16Array<ArrayBuffer>
  private frameUniformIndex = 0

  constructor(renderer: Renderer, options: FlowParticlesOptions) {
    this.renderer = renderer
    this.backend = getWebGPUBackend(renderer)
    this.device = this.backend.device
    this.mode = options.mode
    this.size = options.size ?? (options.mode === 'plane2d' ? 160 : 144)

    this.position = makeStorageDouble(this.size, 'particles.wgsl.position')
    this.velocity = makeStorageDouble(this.size, 'particles.wgsl.velocity')
    this.destination = makeStorageTarget(this.size, 'particles.wgsl.destination')
    this.attributes = makeStorageTarget(this.size, 'particles.wgsl.attributes')
    this.destinationUpload = new Uint16Array(new ArrayBuffer(this.size * this.size * 4 * 2))
    for (const texture of this.allTextures()) this.ownedTextureIds.add(texture.id)

    this.positionTextureNode = textureFn(this.position.read) as TextureNode
    this.velocityTextureNode = textureFn(this.velocity.read) as TextureNode

    this.linearSampler = this.device.createSampler({
      label: 'particles.wgsl.linearSampler',
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'nearest',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    })
    this.pipelines = this.createPipelines()
    this.initGpuTextures()
    this.mesh = this.createMesh()
    this.reset()
  }

  step(params: FlowParticlesStepParams): void {
    const dt = Math.min(Math.max(params.dt, 1e-6), 1 / 30)
    this.mesh.updateWorldMatrix(true, false)
    this.fillParams(params, dt)
    this.updateRenderUniforms(params)
    this.frameUniformIndex = 0

    const encoder = this.device.createCommandEncoder({ label: 'particles.wgsl.step' })
    this.dispatch(encoder, 'velocity', [
      { binding: 1, texture: this.position.read },
      { binding: 2, texture: this.velocity.read },
      { binding: 3, texture: this.destination },
      { binding: 4, texture: this.attributes },
      { binding: 5, texture: params.velocityField },
      { binding: 6, sampler: 'linear' },
      { binding: 7, texture: this.velocity.write },
    ])
    swap(this.velocity)

    this.dispatch(encoder, 'position', [
      { binding: 1, texture: this.position.read },
      { binding: 2, texture: this.velocity.read },
      { binding: 3, texture: this.destination },
      { binding: 4, texture: this.position.write },
    ])
    swap(this.position)

    this.device.queue.submit([encoder.finish()])
    this.refreshRenderNodes()
  }

  setDestinationData(data: Float32Array): void {
    if (data.length !== this.destinationUpload.length) {
      throw new Error(
        `Destination data length ${data.length} does not match ${this.destinationUpload.length}.`,
      )
    }

    for (let i = 0; i < data.length; i += 1) {
      this.destinationUpload[i] = DataUtils.toHalfFloat(data[i])
    }

    this.device.queue.writeTexture(
      { texture: this.getGpuTexture(this.destination) },
      this.destinationUpload,
      {
        bytesPerRow: this.size * 4 * 2,
        rowsPerImage: this.size,
      },
      {
        width: this.size,
        height: this.size,
        depthOrArrayLayers: 1,
      },
    )
  }

  reset(): void {
    this.frameUniformIndex = 0
    this.params.fill(0)
    this.params[0] = this.size
    this.params[2] = this.mode === 'plane2d' ? 0 : 1
    this.params[3] = this.mode === 'plane2d' ? 1 : 0

    const encoder = this.device.createCommandEncoder({ label: 'particles.wgsl.reset' })
    this.dispatch(encoder, 'initPosition', [
      { binding: 1, texture: this.position.read },
      { binding: 2, texture: this.position.write },
      { binding: 3, texture: this.destination },
    ])
    this.dispatch(encoder, 'initVelocity', [
      { binding: 1, texture: this.velocity.read },
      { binding: 2, texture: this.velocity.write },
      { binding: 3, texture: this.attributes },
    ])
    this.device.queue.submit([encoder.finish()])
    this.refreshRenderNodes()
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
    disposeDouble(this.position)
    disposeDouble(this.velocity)
    this.destination.dispose()
    this.attributes.dispose()
    for (const buffer of this.uniformBuffers) buffer.destroy()
    this.uniformBuffers.length = 0
    for (const [textureId, handler] of this.externalTextureDisposeHandlers) {
      const texture = this.externalTextures.get(textureId)
      texture?.removeEventListener('dispose', handler)
    }
    this.externalTextures.clear()
    this.externalTextureDisposeHandlers.clear()
    this.textureViews.clear()
    this.bindGroups.clear()
  }

  private createMesh(): InstancedMesh<InstancedBufferGeometry, MeshBasicNodeMaterial> {
    const material = new MeshBasicNodeMaterial()
    material.transparent = true
    material.depthTest = true
    material.depthWrite = true
    material.blending = NormalBlending
    material.alphaToCoverage = true
    material.toneMapped = false
    material.side = DoubleSide

    const particleIndex = instanceIndex as Any
    const texSizeUint = uint(this.size) as Any
    const texSizeFloat = float(this.size) as Any
    const particleUv = vec2(
      float(particleIndex.mod(texSizeUint)).add(0.5).div(texSizeFloat),
      float(particleIndex.div(texSizeUint)).add(0.5).div(texSizeFloat),
    ) as Any
    const particleSeed = float(particleIndex).mul(0.61803398875).fract()
    const positionTex = this.positionTextureNode as Any
    const velocityTex = this.velocityTextureNode as Any
    const attributeTex = textureFn(this.attributes) as Any
    const corner = positionLocal as Any
    const quadUv = uv() as Any

    const pos = positionTex.sample(particleUv).xyz
    const velocity = velocityTex.sample(particleUv)
    const attr = attributeTex.sample(particleUv)
    const worldSize = (this.pointSizeNode as Any)
      .mul(attr.x.clamp(0.65, 1.6))
      .mul(BILLBOARD_WORLD_UNITS_PER_POINT_SIZE)
    const offset = (this.cameraRightLocalNode as Any)
      .mul(corner.x)
      .add((this.cameraUpLocalNode as Any).mul(corner.y))
      .mul(worldSize)
    setMaterialPosition(material, asNode(pos.add(offset)))

    const energy = velocity.w.clamp(0, 1)
    const timeNode = time
    const hash31 = (p: Any): Any =>
      sin(p.dot(vec3(127.1, 311.7, 74.7)))
        .mul(43758.5453123)
        .fract()
    const valueNoise = (p: Any): Any => {
      const i = floor(p)
      const f = p.fract()
      const u = f.mul(f).mul(float(3).sub(f.mul(2)))

      const n000 = hash31(i.add(vec3(0, 0, 0)))
      const n100 = hash31(i.add(vec3(1, 0, 0)))
      const n010 = hash31(i.add(vec3(0, 1, 0)))
      const n110 = hash31(i.add(vec3(1, 1, 0)))
      const n001 = hash31(i.add(vec3(0, 0, 1)))
      const n101 = hash31(i.add(vec3(1, 0, 1)))
      const n011 = hash31(i.add(vec3(0, 1, 1)))
      const n111 = hash31(i.add(vec3(1, 1, 1)))

      const nx00 = mix(n000, n100, u.x)
      const nx10 = mix(n010, n110, u.x)
      const nx01 = mix(n001, n101, u.x)
      const nx11 = mix(n011, n111, u.x)
      const nxy0 = mix(nx00, nx10, u.y)
      const nxy1 = mix(nx01, nx11, u.y)
      return mix(nxy0, nxy1, u.z)
    }

    const e = smoothstep(0, 1, energy)
    const patternPos = pos.mul(0.72)
    const noisePos = patternPos
      .mul(1.15)
      .add(vec3(particleSeed.mul(7.1), timeNode.mul(0.08), timeNode.mul(-0.05)))
    const n0 = valueNoise(noisePos)
    const n1 = valueNoise(noisePos.mul(2.31).add(vec3(13.5, 9.2, 5.7)))
    const noise = n0.mul(0.68).add(n1.mul(0.32))
    const marble = sin(
      patternPos.x
        .add(patternPos.y.mul(0.7))
        .sub(patternPos.z.mul(0.4))
        .mul(2.4)
        .add(noise.mul(4.5))
        .add(timeNode.mul(0.05)),
    )
    const paletteDrift = sin(timeNode.mul(0.11).add(particleSeed.mul(6.28318530718))).mul(0.025)
    const a = particleSeed
      .mul(0.18)
      .add(noise.mul(0.48))
      .add(marble.mul(0.12))
      .add(e.mul(0.26))
      .add(paletteDrift)
      .fract()
    const phase = a.mul(6.3)
    let palette = vec3(cos(phase), cos(phase.add(83)), cos(phase.add(21)))
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
    const emissionStrength = float(0.9).add(e.mul(1.45))
    const particlePalette = palette.toVarying('vFlowParticlePalette') as Any
    const particleColor = palette.mul(emissionStrength).toVarying('vFlowParticleColor') as Any

    const q = quadUv.sub(0.5)

    // The billboard size is the visible diameter; AA is folded inward at the edge.
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

    let finalColor = particleColor.mul(phongShade).add(particlePalette.mul(specular))
    finalColor = finalColor
      .mul(float(1).add(centerGradient.mul(POINT_CENTER_LIGHT_BOOST)))
      .add(particlePalette.mul(centerGradient).mul(POINT_CENTER_CHROMA_BOOST))
    const peak = finalColor.x.max(finalColor.y).max(finalColor.z).max(POINT_COLOR_PEAK)
    finalColor = finalColor.mul(float(POINT_COLOR_PEAK).div(peak))
    const visibleAlpha = alpha
      .mul(float(1).add(centerGradient.mul(POINT_CENTER_ALPHA_BOOST)))
      .min(1)

    material.opacityNode = visibleAlpha
    material.alphaTestNode = float(POINT_DEPTH_ALPHA_CUTOFF)

    setMaterialOutput(material, vec4(finalColor, visibleAlpha))

    const geometry = createBillboardGeometry(this.size)
    const count = this.size * this.size
    const mesh = new InstancedMesh(geometry, material, count)
    const identity = new Matrix4()
    for (let i = 0; i < count; i += 1) {
      mesh.setMatrixAt(i, identity)
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.frustumCulled = false
    return mesh
  }

  private createPipelines(): Record<KernelName, GPUComputePipeline> {
    const entries = Object.entries(WGSL_SHADERS) as [KernelName, string][]
    return entries.reduce(
      (pipelines, [name, code]) => {
        const module = this.device.createShaderModule({
          label: `particles.wgsl.${name}.module`,
          code,
        })
        pipelines[name] = this.device.createComputePipeline({
          label: `particles.wgsl.${name}.pipeline`,
          layout: 'auto',
          compute: { module, entryPoint: 'main' },
        })
        return pipelines
      },
      {} as Record<KernelName, GPUComputePipeline>,
    )
  }

  private initGpuTextures(): void {
    for (const texture of this.allTextures()) {
      ;(this.renderer as Any).initTexture(texture)
    }
  }

  private allTextures(): StorageTexture[] {
    return [
      this.position.read,
      this.position.write,
      this.velocity.read,
      this.velocity.write,
      this.destination,
      this.attributes,
    ]
  }

  private fillParams(step: FlowParticlesStepParams, dt: number): void {
    const p = this.params
    p.fill(0)
    p[0] = this.size
    p[1] = dt
    p[2] = this.mode === 'plane2d' ? 0 : 1
    p[3] = this.mode === 'plane2d' ? 1 : 0
    p[4] = step.spring
    p[5] = step.zeta
    p[6] = step.dragLin
    p[7] = step.dragQuad
    p[8] = step.aMax
    p[9] = step.vMaxScale
    p[10] = step.flowStrength
    p[11] = step.depthLift
    p[12] = step.flowThreshold
    p[13] = step.maxFlowSpeed
    p[14] = step.responseGamma
    p[15] = step.perpendicularAngle
    p[16] = step.sideVariation
    p[17] = step.depthAttenuationScale
    p[18] = step.pointSize
    p[20] = step.cameraRight.x
    p[21] = step.cameraRight.y
    p[22] = step.cameraRight.z
    p[24] = step.cameraUp.x
    p[25] = step.cameraUp.y
    p[26] = step.cameraUp.z
    p.set(step.viewMatrix.elements, 28)
    p.set(step.projectionMatrix.elements, 44)

    p.set((step.modelMatrix ?? this.mesh.matrixWorld).elements, 60)
  }

  private updateRenderUniforms(step: FlowParticlesStepParams): void {
    const modelMatrix = step.modelMatrix ?? this.mesh.matrixWorld
    this.modelRotationMatrix.extractRotation(modelMatrix)
    const invRotation = this.invModelRotation.setFromMatrix4(this.modelRotationMatrix).invert()
    const rightLocal = (this.cameraRightLocalNode as Any).value as Vector3
    const upLocal = (this.cameraUpLocalNode as Any).value as Vector3
    rightLocal.copy(step.cameraRight).applyMatrix3(invRotation).normalize()
    upLocal.copy(step.cameraUp).applyMatrix3(invRotation).normalize()
    ;(this.pointSizeNode as Any).value = step.pointSize
  }

  private refreshRenderNodes(): void {
    this.positionTextureNode.value = this.position.read
    this.velocityTextureNode.value = this.velocity.read
  }

  private getTextureView(texture: Texture): GPUTextureView {
    let view = this.textureViews.get(texture.id)
    if (!view) {
      if (!this.ownedTextureIds.has(texture.id)) {
        ;(this.renderer as Any).initTexture(texture)
        this.trackExternalTexture(texture)
      }
      view = this.getGpuTexture(texture).createView()
      this.textureViews.set(texture.id, view)
    }
    return view
  }

  private trackExternalTexture(texture: Texture): void {
    if (this.externalTextureDisposeHandlers.has(texture.id)) return

    const onDispose = (): void => {
      this.textureViews.delete(texture.id)
      this.bindGroups.clear()
    }
    this.externalTextures.set(texture.id, texture)
    this.externalTextureDisposeHandlers.set(texture.id, onDispose)
    texture.addEventListener('dispose', onDispose)
  }

  private getGpuTexture(texture: Texture): GPUTexture {
    const gpuTexture = this.backend.get(texture).texture
    if (!gpuTexture) throw new Error(`Missing GPUTexture for ${texture.name || 'Texture'}.`)
    return gpuTexture
  }

  private writeUniform(): GPUBuffer {
    const index = this.frameUniformIndex
    this.frameUniformIndex += 1

    let buffer = this.uniformBuffers[index]
    if (!buffer) {
      buffer = this.device.createBuffer({
        label: `particles.wgsl.uniform.${index}`,
        size: UNIFORM_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })
      this.uniformBuffers[index] = buffer
    }

    this.device.queue.writeBuffer(
      buffer,
      0,
      this.params.buffer as ArrayBuffer,
      this.params.byteOffset,
      this.params.byteLength,
    )
    return buffer
  }

  private getBindGroup(
    name: KernelName,
    uniformIndex: number,
    uniformBuffer: GPUBuffer,
    resources: BindingResource[],
  ): GPUBindGroup {
    const key = [
      name,
      uniformIndex,
      ...resources.map((resource) =>
        'texture' in resource
          ? `${resource.binding}:texture:${resource.texture.id}`
          : `${resource.binding}:sampler:${resource.sampler}`,
      ),
    ].join('|')

    let bindGroup = this.bindGroups.get(key)
    if (bindGroup) return bindGroup

    const entries: GPUBindGroupEntry[] = [
      {
        binding: 0,
        resource: { buffer: uniformBuffer },
      },
    ]

    for (const resource of resources) {
      entries.push(
        'texture' in resource
          ? { binding: resource.binding, resource: this.getTextureView(resource.texture) }
          : { binding: resource.binding, resource: this.linearSampler },
      )
    }

    bindGroup = this.device.createBindGroup({
      label: `particles.wgsl.${name}.bindGroup`,
      layout: this.pipelines[name].getBindGroupLayout(0),
      entries,
    })
    this.bindGroups.set(key, bindGroup)
    return bindGroup
  }

  private dispatch(
    encoder: GPUCommandEncoder,
    name: KernelName,
    resources: BindingResource[],
  ): void {
    const uniformIndex = this.frameUniformIndex
    const uniformBuffer = this.writeUniform()
    const pass = encoder.beginComputePass({ label: `particles.wgsl.${name}` })
    pass.setPipeline(this.pipelines[name])
    pass.setBindGroup(0, this.getBindGroup(name, uniformIndex, uniformBuffer, resources))
    pass.dispatchWorkgroups(
      Math.ceil(this.size / WORKGROUP_X),
      Math.ceil(this.size / WORKGROUP_Y),
      1,
    )
    pass.end()
  }
}

function getWebGPUBackend(renderer: Renderer): WebGPUBackendLike {
  const backend = (renderer as Any).backend as WebGPUBackendLike | undefined
  if (!backend?.isWebGPUBackend || !backend.device) {
    throw new Error('WGSLFlowParticles requires WebGPURenderer with the WebGPU backend.')
  }
  return backend
}
