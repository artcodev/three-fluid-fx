// Raw WebGPU/WGSL backend for the TSL fluid examples.
//
// It exposes the same TextureNode surface as the TSL backends, but runs the
// simulation through explicit GPUComputePipeline / GPUBindGroup objects. This
// keeps the distortion/effect layer unchanged while giving us a lower-overhead
// baseline for performance comparisons.

import {
  HalfFloatType,
  NearestFilter,
  RGBAFormat,
  StorageTexture,
  type Renderer,
  type Texture,
} from 'three/webgpu'
import { texture as textureFn } from 'three/tsl'
import type { TextureNode } from 'three/webgpu'
import {
  FLUID_PROFILES,
  type FluidSimulationOptions,
  type FluidSplatOptions,
  type IFluidSimulation,
} from './types'

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any

const WORKGROUP_X = 8
const WORKGROUP_Y = 8
const UNIFORM_FLOATS = 16
const UNIFORM_BYTES = UNIFORM_FLOATS * 4
const TEXTURE_FORMAT = 'rgba16float'

type KernelName =
  | 'fill'
  | 'decay'
  | 'splat'
  | 'curl'
  | 'vorticity'
  | 'divergence'
  | 'pressure'
  | 'gradientSubtract'
  | 'advect'

interface StorageDouble {
  read: StorageTexture
  write: StorageTexture
}

interface QueuedSplat {
  x: number
  y: number
  dx: number
  dy: number
  radius: number
  color?: [number, number, number]
  dyeColor?: [number, number, number]
}

interface WebGPUBackendLike {
  isWebGPUBackend?: boolean
  device: GPUDevice
  get(object: object): { texture?: GPUTexture }
}

interface TextureBinding {
  binding: number
  texture: StorageTexture
}

interface SamplerBinding {
  binding: number
  sampler: 'linear'
}

type BindingResource = TextureBinding | SamplerBinding

const WGSL_COMMON = /* wgsl */ `
struct Params {
  a: vec4<f32>,
  b: vec4<f32>,
  c: vec4<f32>,
  d: vec4<f32>,
};

@group(0) @binding(0) var<uniform> params: Params;

fn simWidth() -> u32 {
  return u32(params.a.x);
}

fn simHeight() -> u32 {
  return u32(params.a.y);
}

fn texelSize() -> vec2<f32> {
  return params.a.zw;
}

fn inBounds(coord: vec2<u32>) -> bool {
  return coord.x < simWidth() && coord.y < simHeight();
}

fn loadClamped(tex: texture_2d<f32>, x: i32, y: i32) -> vec4<f32> {
  let w = i32(simWidth());
  let h = i32(simHeight());
  let cx = clamp(x, 0, w - 1);
  let cy = clamp(y, 0, h - 1);
  return textureLoad(tex, vec2<i32>(cx, cy), 0);
}

fn normalizedUvYUp(coord: vec2<u32>) -> vec2<f32> {
  let size = vec2<f32>(f32(simWidth()), f32(simHeight()));
  let topDown = (vec2<f32>(coord) + vec2<f32>(0.5)) / size;
  return vec2<f32>(topDown.x, 1.0 - topDown.y);
}

fn sampleYUp(tex: texture_2d<f32>, texSampler: sampler, uvYUp: vec2<f32>) -> vec4<f32> {
  return textureSampleLevel(tex, texSampler, vec2<f32>(uvYUp.x, 1.0 - uvYUp.y), 0.0);
}
`

const WGSL_SHADERS: Record<KernelName, string> = {
  fill: /* wgsl */ `
${WGSL_COMMON}
@group(0) @binding(1) var targetTex: texture_storage_2d<${TEXTURE_FORMAT}, write>;

@compute @workgroup_size(${WORKGROUP_X}, ${WORKGROUP_Y}, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let coord = gid.xy;
  if (!inBounds(coord)) {
    return;
  }

  textureStore(targetTex, coord, params.b);
}
`,

  decay: /* wgsl */ `
${WGSL_COMMON}
@group(0) @binding(1) var sourceTex: texture_2d<f32>;
@group(0) @binding(2) var targetTex: texture_storage_2d<${TEXTURE_FORMAT}, write>;

@compute @workgroup_size(${WORKGROUP_X}, ${WORKGROUP_Y}, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let coord = gid.xy;
  if (!inBounds(coord)) {
    return;
  }

  let value = loadClamped(sourceTex, i32(coord.x), i32(coord.y)) * params.b.x;
  textureStore(targetTex, coord, value);
}
`,

  splat: /* wgsl */ `
${WGSL_COMMON}
@group(0) @binding(1) var sourceTex: texture_2d<f32>;
@group(0) @binding(2) var targetTex: texture_storage_2d<${TEXTURE_FORMAT}, write>;

@compute @workgroup_size(${WORKGROUP_X}, ${WORKGROUP_Y}, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let coord = gid.xy;
  if (!inBounds(coord)) {
    return;
  }

  let vUv = normalizedUvYUp(coord);
  let center = params.c.xy;
  let halfSize = max(params.c.z, 0.000001);
  let aspect = params.c.w;
  let local = vec2<f32>(
    (vUv.x - center.x) * 2.0 * aspect / halfSize,
    (vUv.y - center.y) * 2.0 / halfSize
  );
  let amount = pow(clamp(1.0 - length(local), 0.0, 1.0), 2.0);
  let previous = loadClamped(sourceTex, i32(coord.x), i32(coord.y));
  let splatValue = vec4<f32>(params.b.xyz * amount, amount);

  textureStore(targetTex, coord, previous + splatValue);
}
`,

  curl: /* wgsl */ `
${WGSL_COMMON}
@group(0) @binding(1) var velocityTex: texture_2d<f32>;
@group(0) @binding(2) var targetTex: texture_storage_2d<${TEXTURE_FORMAT}, write>;

@compute @workgroup_size(${WORKGROUP_X}, ${WORKGROUP_Y}, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let coord = gid.xy;
  if (!inBounds(coord)) {
    return;
  }

  let x = i32(coord.x);
  let y = i32(coord.y);
  let L = loadClamped(velocityTex, x - 1, y).y;
  let R = loadClamped(velocityTex, x + 1, y).y;
  let T = loadClamped(velocityTex, x, y - 1).x;
  let B = loadClamped(velocityTex, x, y + 1).x;
  let vorticity = (R - L - T + B) * 0.5;

  textureStore(targetTex, coord, vec4<f32>(vorticity, 0.0, 0.0, 1.0));
}
`,

  vorticity: /* wgsl */ `
${WGSL_COMMON}
@group(0) @binding(1) var velocityTex: texture_2d<f32>;
@group(0) @binding(2) var curlTex: texture_2d<f32>;
@group(0) @binding(3) var targetTex: texture_storage_2d<${TEXTURE_FORMAT}, write>;

@compute @workgroup_size(${WORKGROUP_X}, ${WORKGROUP_Y}, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let coord = gid.xy;
  if (!inBounds(coord)) {
    return;
  }

  let x = i32(coord.x);
  let y = i32(coord.y);
  let L = loadClamped(curlTex, x - 1, y).x;
  let R = loadClamped(curlTex, x + 1, y).x;
  let T = loadClamped(curlTex, x, y - 1).x;
  let B = loadClamped(curlTex, x, y + 1).x;
  let C = loadClamped(curlTex, x, y).x;
  let forceRaw = vec2<f32>(abs(T) - abs(B), abs(R) - abs(L)) * 0.5;
  let forceN = forceRaw / (length(forceRaw) + 0.0001);
  let force = forceN * params.c.x * C;
  let velocity = loadClamped(velocityTex, x, y).xy;
  let outVelocity = velocity + vec2<f32>(force.x, -force.y) * params.c.y;

  textureStore(targetTex, coord, vec4<f32>(outVelocity, 0.0, 1.0));
}
`,

  divergence: /* wgsl */ `
${WGSL_COMMON}
@group(0) @binding(1) var velocityTex: texture_2d<f32>;
@group(0) @binding(2) var targetTex: texture_storage_2d<${TEXTURE_FORMAT}, write>;

@compute @workgroup_size(${WORKGROUP_X}, ${WORKGROUP_Y}, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let coord = gid.xy;
  if (!inBounds(coord)) {
    return;
  }

  let x = i32(coord.x);
  let y = i32(coord.y);
  let C = loadClamped(velocityTex, x, y).xy;
  var L = loadClamped(velocityTex, x - 1, y).x;
  var R = loadClamped(velocityTex, x + 1, y).x;
  var T = loadClamped(velocityTex, x, y - 1).y;
  var B = loadClamped(velocityTex, x, y + 1).y;

  if (params.c.x > 0.5) {
    if (coord.x == 0u) {
      L = -C.x;
    }
    if (coord.x == simWidth() - 1u) {
      R = -C.x;
    }
    if (coord.y == 0u) {
      T = -C.y;
    }
    if (coord.y == simHeight() - 1u) {
      B = -C.y;
    }
  }

  let div = (R - L + T - B) * 0.5;
  textureStore(targetTex, coord, vec4<f32>(div, 0.0, 0.0, 1.0));
}
`,

  pressure: /* wgsl */ `
${WGSL_COMMON}
@group(0) @binding(1) var pressureTex: texture_2d<f32>;
@group(0) @binding(2) var divergenceTex: texture_2d<f32>;
@group(0) @binding(3) var targetTex: texture_storage_2d<${TEXTURE_FORMAT}, write>;

@compute @workgroup_size(${WORKGROUP_X}, ${WORKGROUP_Y}, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let coord = gid.xy;
  if (!inBounds(coord)) {
    return;
  }

  let x = i32(coord.x);
  let y = i32(coord.y);
  let L = loadClamped(pressureTex, x - 1, y).x;
  let R = loadClamped(pressureTex, x + 1, y).x;
  let T = loadClamped(pressureTex, x, y - 1).x;
  let B = loadClamped(pressureTex, x, y + 1).x;
  let div = loadClamped(divergenceTex, x, y).x;
  let value = (L + R + B + T - div) * 0.25;

  textureStore(targetTex, coord, vec4<f32>(value, 0.0, 0.0, 1.0));
}
`,

  gradientSubtract: /* wgsl */ `
${WGSL_COMMON}
@group(0) @binding(1) var pressureTex: texture_2d<f32>;
@group(0) @binding(2) var velocityTex: texture_2d<f32>;
@group(0) @binding(3) var targetTex: texture_storage_2d<${TEXTURE_FORMAT}, write>;

@compute @workgroup_size(${WORKGROUP_X}, ${WORKGROUP_Y}, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let coord = gid.xy;
  if (!inBounds(coord)) {
    return;
  }

  let x = i32(coord.x);
  let y = i32(coord.y);
  let L = loadClamped(pressureTex, x - 1, y).x;
  let R = loadClamped(pressureTex, x + 1, y).x;
  let T = loadClamped(pressureTex, x, y - 1).x;
  let B = loadClamped(pressureTex, x, y + 1).x;
  let velocity = loadClamped(velocityTex, x, y).xy;
  let projected = velocity - vec2<f32>(R - L, T - B);

  textureStore(targetTex, coord, vec4<f32>(projected, 0.0, 1.0));
}
`,

  advect: /* wgsl */ `
${WGSL_COMMON}
@group(0) @binding(1) var velocityTex: texture_2d<f32>;
@group(0) @binding(2) var sourceTex: texture_2d<f32>;
@group(0) @binding(3) var linearSampler: sampler;
@group(0) @binding(4) var targetTex: texture_storage_2d<${TEXTURE_FORMAT}, write>;

@compute @workgroup_size(${WORKGROUP_X}, ${WORKGROUP_Y}, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let coord = gid.xy;
  if (!inBounds(coord)) {
    return;
  }

  let vUv = normalizedUvYUp(coord);
  let dt = params.c.x;
  let dissipation = params.c.y;
  let useBFECC = select(0.0, 1.0, params.c.z >= 0.5);
  let velocity = sampleYUp(velocityTex, linearSampler, vUv).xy;
  let coordPlain = vUv - velocity * dt * texelSize();
  let samplePlain = sampleYUp(sourceTex, linearSampler, coordPlain);

  let spotOld = vUv - velocity * dt * texelSize();
  let velBack = sampleYUp(velocityTex, linearSampler, spotOld).xy;
  let spotForward = spotOld + velBack * dt * texelSize();
  let error = spotForward - vUv;
  let spotMid = vUv - error * 0.5;
  let velMid = sampleYUp(velocityTex, linearSampler, spotMid).xy;
  let coordBFECC = spotMid - velMid * dt * texelSize();
  let sampleBFECC = sampleYUp(sourceTex, linearSampler, coordBFECC);
  let result = (samplePlain * (1.0 - useBFECC) + sampleBFECC * useBFECC) * dissipation;

  textureStore(targetTex, coord, vec4<f32>(result.rgb, 1.0));
}
`,
}

function makeStorageTarget(
  width: number,
  height: number,
  linear: boolean,
  name: string,
): StorageTexture {
  const texture = new StorageTexture(width, height)
  texture.name = name
  texture.format = RGBAFormat
  texture.type = HalfFloatType
  texture.generateMipmaps = false
  ;(texture as Any).mipmapsAutoUpdate = false

  if (!linear) {
    texture.minFilter = NearestFilter
    texture.magFilter = NearestFilter
  }

  return texture
}

function makeStorageDouble(
  width: number,
  height: number,
  linear: boolean,
  name: string,
): StorageDouble {
  return {
    read: makeStorageTarget(width, height, linear, `${name}.read`),
    write: makeStorageTarget(width, height, linear, `${name}.write`),
  }
}

function resizeStorage(texture: StorageTexture, width: number, height: number): void {
  texture.setSize(width, height, 1)
}

function resizeStorageDouble(target: StorageDouble, width: number, height: number): void {
  resizeStorage(target.read, width, height)
  resizeStorage(target.write, width, height)
}

function swap(target: StorageDouble): void {
  const tmp = target.read
  target.read = target.write
  target.write = tmp
}

function disposeDouble(target: StorageDouble): void {
  target.read.dispose()
  target.write.dispose()
}

function makeParams(width: number, height: number): Float32Array {
  const params = new Float32Array(UNIFORM_FLOATS)
  params[0] = width
  params[1] = height
  params[2] = 1 / width
  params[3] = 1 / height
  return params
}

export class WGSLFluidSimulation implements IFluidSimulation {
  readonly simResolution: number
  readonly dyeResolution: number

  pressureIterations: number
  densityDissipation: number
  velocityDissipation: number
  pressureDissipation: number
  curlStrength: number
  splatRadius: number
  splatForce: number
  baseDelta: number
  enableVorticity: boolean
  bfecc: boolean
  reflectWalls: boolean
  enableDye = false
  dyeDissipation: number

  readonly densityNode: TextureNode
  readonly dyeNode: TextureNode
  readonly velocityNode: TextureNode
  readonly pressureNode: TextureNode
  readonly divergenceNode: TextureNode
  readonly curlNode: TextureNode

  private readonly renderer: Renderer
  private readonly backend: WebGPUBackendLike
  private readonly device: GPUDevice
  private readonly velocity: StorageDouble
  private readonly density: StorageDouble
  private readonly dye: StorageDouble
  private readonly pressure: StorageDouble
  private readonly divergence: StorageTexture
  private readonly curl: StorageTexture
  private readonly pipelines: Record<KernelName, GPUComputePipeline>
  private readonly linearSampler: GPUSampler
  private readonly uniformBuffers: GPUBuffer[] = []
  private readonly textureViews = new Map<number, GPUTextureView>()
  private readonly bindGroups = new Map<string, GPUBindGroup>()
  private readonly splats: QueuedSplat[] = []

  private frameUniformIndex = 0
  private targetsNeedClear = true
  private viewportWidth = 1
  private viewportHeight = 1
  private simWidth: number
  private simHeight: number
  private dyeWidth: number
  private dyeHeight: number

  constructor(renderer: Renderer, options: FluidSimulationOptions = {}) {
    this.renderer = renderer
    this.backend = this.getWebGPUBackend(renderer)
    this.device = this.backend.device

    const profile = FLUID_PROFILES[options.profile ?? 'balanced']
    this.simResolution = options.simResolution ?? profile.simResolution
    this.dyeResolution = options.dyeResolution ?? profile.dyeResolution
    this.pressureIterations = options.pressureIterations ?? profile.pressureIterations
    this.densityDissipation = options.densityDissipation ?? 0.91
    this.velocityDissipation = options.velocityDissipation ?? 0.985
    this.pressureDissipation = options.pressureDissipation ?? 0.8
    this.curlStrength = options.curlStrength ?? 0.55
    this.splatRadius = options.splatRadius ?? 0.00042
    this.splatForce = options.splatForce ?? 6
    this.baseDelta = options.baseDelta ?? 1 / 60
    this.enableVorticity = options.enableVorticity ?? false
    this.bfecc = options.bfecc ?? true
    this.reflectWalls = options.reflectWalls ?? true
    this.dyeDissipation = options.dyeDissipation ?? this.densityDissipation

    this.simWidth = this.simResolution
    this.simHeight = this.simResolution
    this.dyeWidth = this.dyeResolution
    this.dyeHeight = this.dyeResolution

    this.velocity = makeStorageDouble(this.simWidth, this.simHeight, true, 'fluid.wgsl.velocity')
    this.density = makeStorageDouble(this.dyeWidth, this.dyeHeight, true, 'fluid.wgsl.density')
    this.dye = makeStorageDouble(this.dyeWidth, this.dyeHeight, true, 'fluid.wgsl.dye')
    this.pressure = makeStorageDouble(this.simWidth, this.simHeight, false, 'fluid.wgsl.pressure')
    this.divergence = makeStorageTarget(
      this.simWidth,
      this.simHeight,
      false,
      'fluid.wgsl.divergence',
    )
    this.curl = makeStorageTarget(this.simWidth, this.simHeight, false, 'fluid.wgsl.curl')

    this.initGpuTextures()

    this.densityNode = textureFn(this.density.read) as TextureNode
    this.dyeNode = textureFn(this.dye.read) as TextureNode
    this.velocityNode = textureFn(this.velocity.read) as TextureNode
    this.pressureNode = textureFn(this.pressure.read) as TextureNode
    this.divergenceNode = textureFn(this.divergence) as TextureNode
    this.curlNode = textureFn(this.curl) as TextureNode

    this.linearSampler = this.device.createSampler({
      label: 'fluid.wgsl.linearSampler',
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'nearest',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    })
    this.pipelines = this.createPipelines()
  }

  get velocityTexture(): Texture {
    return this.velocity.read
  }

  get velocityProjectedTexture(): Texture {
    return this.velocity.write
  }

  get densityTexture(): Texture {
    return this.density.read
  }

  get dyeTexture(): Texture {
    return this.dye.read
  }

  resize(width: number, height: number): void {
    this.viewportWidth = Math.max(1, width)
    this.viewportHeight = Math.max(1, height)
    const aspect = this.viewportWidth / this.viewportHeight

    let newSimW: number, newSimH: number, newDyeW: number, newDyeH: number
    if (aspect >= 1) {
      newSimW = this.simResolution
      newSimH = Math.max(1, Math.round(this.simResolution / aspect))
      newDyeW = this.dyeResolution
      newDyeH = Math.max(1, Math.round(this.dyeResolution / aspect))
    } else {
      newSimW = Math.max(1, Math.round(this.simResolution * aspect))
      newSimH = this.simResolution
      newDyeW = Math.max(1, Math.round(this.dyeResolution * aspect))
      newDyeH = this.dyeResolution
    }

    let resized = false
    if (newSimW !== this.simWidth || newSimH !== this.simHeight) {
      this.simWidth = newSimW
      this.simHeight = newSimH
      resizeStorageDouble(this.velocity, newSimW, newSimH)
      resizeStorageDouble(this.pressure, newSimW, newSimH)
      resizeStorage(this.divergence, newSimW, newSimH)
      resizeStorage(this.curl, newSimW, newSimH)
      this.targetsNeedClear = true
      resized = true
    }

    if (newDyeW !== this.dyeWidth || newDyeH !== this.dyeHeight) {
      this.dyeWidth = newDyeW
      this.dyeHeight = newDyeH
      resizeStorageDouble(this.density, newDyeW, newDyeH)
      resizeStorageDouble(this.dye, newDyeW, newDyeH)
      this.targetsNeedClear = true
      resized = true
    }

    if (resized) {
      this.initGpuTextures()
      this.textureViews.clear()
      this.bindGroups.clear()
    }
  }

  addSplat(x: number, y: number, dx: number, dy: number, options: FluidSplatOptions = {}): void {
    this.splats.push({
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y)),
      dx,
      dy,
      radius: options.radius ?? this.splatRadius,
      color: options.color,
      dyeColor: options.dyeColor,
    })
  }

  step(deltaSeconds: number): void {
    const dt = Math.min(Math.max(deltaSeconds, 1e-6), 1 / 60)
    const dtScale = this.baseDelta > 0 ? dt / this.baseDelta : 1
    const encoder = this.device.createCommandEncoder({ label: 'fluid.wgsl.step' })
    this.frameUniformIndex = 0

    if (this.targetsNeedClear) {
      this.clearTargets(encoder)
      this.targetsNeedClear = false
    }

    for (let i = 0; i < this.splats.length; i += 1) {
      this.applySplat(encoder, this.splats[i])
    }
    this.splats.length = 0

    if (this.enableVorticity) {
      this.dispatch(encoder, 'curl', this.simWidth, this.simHeight, [
        { binding: 1, texture: this.velocity.read },
        { binding: 2, texture: this.curl },
      ])
    }

    if (this.enableVorticity) {
      const params = makeParams(this.simWidth, this.simHeight)
      params[8] = this.curlStrength
      params[9] = dt
      this.dispatch(
        encoder,
        'vorticity',
        this.simWidth,
        this.simHeight,
        [
          { binding: 1, texture: this.velocity.read },
          { binding: 2, texture: this.curl },
          { binding: 3, texture: this.velocity.write },
        ],
        params,
      )
      swap(this.velocity)
    }

    const divergenceParams = makeParams(this.simWidth, this.simHeight)
    divergenceParams[8] = this.reflectWalls ? 1 : 0
    this.dispatch(
      encoder,
      'divergence',
      this.simWidth,
      this.simHeight,
      [
        { binding: 1, texture: this.velocity.read },
        { binding: 2, texture: this.divergence },
      ],
      divergenceParams,
    )

    const pressureClearParams = makeParams(this.simWidth, this.simHeight)
    pressureClearParams[4] = Math.pow(this.pressureDissipation, dtScale)
    this.dispatch(
      encoder,
      'decay',
      this.simWidth,
      this.simHeight,
      [
        { binding: 1, texture: this.pressure.read },
        { binding: 2, texture: this.pressure.write },
      ],
      pressureClearParams,
    )
    swap(this.pressure)

    for (let i = 0; i < this.pressureIterations; i += 1) {
      this.dispatch(encoder, 'pressure', this.simWidth, this.simHeight, [
        { binding: 1, texture: this.pressure.read },
        { binding: 2, texture: this.divergence },
        { binding: 3, texture: this.pressure.write },
      ])
      swap(this.pressure)
    }

    this.dispatch(encoder, 'gradientSubtract', this.simWidth, this.simHeight, [
      { binding: 1, texture: this.pressure.read },
      { binding: 2, texture: this.velocity.read },
      { binding: 3, texture: this.velocity.write },
    ])
    swap(this.velocity)

    const bfecc = this.bfecc ? 1 : 0
    this.advectTexture(
      encoder,
      this.velocity,
      this.simWidth,
      this.simHeight,
      Math.pow(this.velocityDissipation, dtScale),
      dt,
      bfecc,
    )
    this.advectTexture(
      encoder,
      this.density,
      this.dyeWidth,
      this.dyeHeight,
      Math.pow(this.densityDissipation, dtScale),
      dt,
      bfecc,
    )

    if (this.enableDye) {
      this.advectTexture(
        encoder,
        this.dye,
        this.dyeWidth,
        this.dyeHeight,
        Math.pow(this.dyeDissipation, dtScale),
        dt,
        bfecc,
      )
    }

    this.device.queue.submit([encoder.finish()])
    this.refreshPublicNodes()
  }

  dispose(): void {
    disposeDouble(this.velocity)
    disposeDouble(this.density)
    disposeDouble(this.dye)
    disposeDouble(this.pressure)
    this.divergence.dispose()
    this.curl.dispose()
    for (const buffer of this.uniformBuffers) buffer.destroy()
    this.uniformBuffers.length = 0
    this.textureViews.clear()
    this.bindGroups.clear()
  }

  private getWebGPUBackend(renderer: Renderer): WebGPUBackendLike {
    const backend = (renderer as Any).backend as WebGPUBackendLike | undefined
    if (!backend?.isWebGPUBackend || !backend.device) {
      throw new Error('WGSLFluidSimulation requires WebGPURenderer with the WebGPU backend.')
    }
    return backend
  }

  private createPipelines(): Record<KernelName, GPUComputePipeline> {
    const entries = Object.entries(WGSL_SHADERS) as [KernelName, string][]
    return entries.reduce(
      (pipelines, [name, code]) => {
        const module = this.device.createShaderModule({
          label: `fluid.wgsl.${name}.module`,
          code,
        })
        pipelines[name] = this.device.createComputePipeline({
          label: `fluid.wgsl.${name}.pipeline`,
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
      this.velocity.read,
      this.velocity.write,
      this.density.read,
      this.density.write,
      this.dye.read,
      this.dye.write,
      this.pressure.read,
      this.pressure.write,
      this.divergence,
      this.curl,
    ]
  }

  private getGpuTexture(texture: StorageTexture): GPUTexture {
    const gpuTexture = this.backend.get(texture).texture
    if (!gpuTexture) throw new Error(`Missing GPUTexture for ${texture.name || 'StorageTexture'}.`)
    return gpuTexture
  }

  private getTextureView(texture: StorageTexture): GPUTextureView {
    let view = this.textureViews.get(texture.id)
    if (!view) {
      view = this.getGpuTexture(texture).createView()
      this.textureViews.set(texture.id, view)
    }
    return view
  }

  private writeUniform(params: Float32Array): { index: number; buffer: GPUBuffer } {
    const index = this.frameUniformIndex
    this.frameUniformIndex += 1

    let buffer = this.uniformBuffers[index]
    if (!buffer) {
      buffer = this.device.createBuffer({
        label: `fluid.wgsl.uniform.${index}`,
        size: UNIFORM_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })
      this.uniformBuffers[index] = buffer
    }

    this.device.queue.writeBuffer(
      buffer,
      0,
      params.buffer as ArrayBuffer,
      params.byteOffset,
      params.byteLength,
    )
    return { index, buffer }
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
    if (!bindGroup) {
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
        label: `fluid.wgsl.${name}.bindGroup`,
        layout: this.pipelines[name].getBindGroupLayout(0),
        entries,
      })
      this.bindGroups.set(key, bindGroup)
    }
    return bindGroup
  }

  private dispatch(
    encoder: GPUCommandEncoder,
    name: KernelName,
    width: number,
    height: number,
    resources: BindingResource[],
    params = makeParams(width, height),
  ): void {
    const uniform = this.writeUniform(params)
    const pass = encoder.beginComputePass({ label: `fluid.wgsl.${name}` })
    pass.setPipeline(this.pipelines[name])
    pass.setBindGroup(0, this.getBindGroup(name, uniform.index, uniform.buffer, resources))
    pass.dispatchWorkgroups(Math.ceil(width / WORKGROUP_X), Math.ceil(height / WORKGROUP_Y), 1)
    pass.end()
  }

  private clearTargets(encoder: GPUCommandEncoder): void {
    this.clearTexture(encoder, this.velocity.read, this.simWidth, this.simHeight)
    this.clearTexture(encoder, this.velocity.write, this.simWidth, this.simHeight)
    this.clearTexture(encoder, this.pressure.read, this.simWidth, this.simHeight)
    this.clearTexture(encoder, this.pressure.write, this.simWidth, this.simHeight)
    this.clearTexture(encoder, this.divergence, this.simWidth, this.simHeight)
    this.clearTexture(encoder, this.curl, this.simWidth, this.simHeight)
    this.clearTexture(encoder, this.density.read, this.dyeWidth, this.dyeHeight)
    this.clearTexture(encoder, this.density.write, this.dyeWidth, this.dyeHeight)
    this.clearTexture(encoder, this.dye.read, this.dyeWidth, this.dyeHeight)
    this.clearTexture(encoder, this.dye.write, this.dyeWidth, this.dyeHeight)
  }

  private clearTexture(
    encoder: GPUCommandEncoder,
    texture: StorageTexture,
    width: number,
    height: number,
  ): void {
    this.dispatch(encoder, 'fill', width, height, [{ binding: 1, texture }])
  }

  private applySplat(encoder: GPUCommandEncoder, splat: QueuedSplat): void {
    const color = splat.color ?? ([splat.dx, splat.dy, 1] as [number, number, number])
    this.applySplatToDouble(encoder, this.velocity, this.simWidth, this.simHeight, splat, color)
    this.applySplatToDouble(encoder, this.density, this.dyeWidth, this.dyeHeight, splat, color)

    if (this.enableDye && splat.dyeColor) {
      this.applySplatToDouble(
        encoder,
        this.dye,
        this.dyeWidth,
        this.dyeHeight,
        splat,
        splat.dyeColor,
      )
    }
  }

  private applySplatToDouble(
    encoder: GPUCommandEncoder,
    target: StorageDouble,
    width: number,
    height: number,
    splat: QueuedSplat,
    color: [number, number, number],
  ): void {
    const params = makeParams(width, height)
    params[4] = color[0]
    params[5] = color[1]
    params[6] = color[2]
    params[7] = 1
    params[8] = splat.x
    params[9] = splat.y
    params[10] = Math.max(1e-6, 3 * Math.sqrt(splat.radius))
    params[11] = this.viewportWidth / this.viewportHeight

    this.dispatch(
      encoder,
      'splat',
      width,
      height,
      [
        { binding: 1, texture: target.read },
        { binding: 2, texture: target.write },
      ],
      params,
    )
    swap(target)
  }

  private advectTexture(
    encoder: GPUCommandEncoder,
    target: StorageDouble,
    width: number,
    height: number,
    dissipation: number,
    dt: number,
    bfecc: number,
  ): void {
    const params = makeParams(width, height)
    params[8] = dt
    params[9] = dissipation
    params[10] = bfecc

    this.dispatch(
      encoder,
      'advect',
      width,
      height,
      [
        { binding: 1, texture: this.velocity.read },
        { binding: 2, texture: target.read },
        { binding: 3, sampler: 'linear' },
        { binding: 4, texture: target.write },
      ],
      params,
    )
    swap(target)
  }

  private refreshPublicNodes(): void {
    this.densityNode.value = this.density.read
    this.dyeNode.value = this.dye.read
    this.velocityNode.value = this.velocity.read
    this.pressureNode.value = this.pressure.read
    this.divergenceNode.value = this.divergence
    this.curlNode.value = this.curl
  }
}
