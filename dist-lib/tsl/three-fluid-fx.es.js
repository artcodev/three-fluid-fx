import { StorageTexture, RGBAFormat, HalfFloatType, NearestFilter, TempNode, Vector2, NodeUpdateType } from "three/webgpu";
import { texture, uniform, uv, Fn, vec2, vec4, nodeObject, convertToTexture, max, smoothstep, vec3, float, mix, dot, atan } from "three/tsl";
const FLUID_PROFILES = {
  performance: { simResolution: 128, dyeResolution: 256, pressureIterations: 6 },
  balanced: { simResolution: 256, dyeResolution: 512, pressureIterations: 12 },
  quality: { simResolution: 384, dyeResolution: 1024, pressureIterations: 20 }
};
const WORKGROUP_X = 8;
const WORKGROUP_Y = 8;
const UNIFORM_FLOATS = 16;
const UNIFORM_BYTES = UNIFORM_FLOATS * 4;
const TEXTURE_FORMAT = "rgba16float";
const WGSL_COMMON = (
  /* wgsl */
  `
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
);
const WGSL_SHADERS = {
  fill: (
    /* wgsl */
    `
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
`
  ),
  decay: (
    /* wgsl */
    `
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
`
  ),
  splat: (
    /* wgsl */
    `
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
`
  ),
  curl: (
    /* wgsl */
    `
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
`
  ),
  vorticity: (
    /* wgsl */
    `
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
`
  ),
  divergence: (
    /* wgsl */
    `
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
`
  ),
  pressure: (
    /* wgsl */
    `
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
`
  ),
  gradientSubtract: (
    /* wgsl */
    `
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
`
  ),
  advect: (
    /* wgsl */
    `
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
`
  )
};
function makeStorageTarget(width, height, linear, name) {
  const texture2 = new StorageTexture(width, height);
  texture2.name = name;
  texture2.format = RGBAFormat;
  texture2.type = HalfFloatType;
  texture2.generateMipmaps = false;
  texture2.mipmapsAutoUpdate = false;
  if (!linear) {
    texture2.minFilter = NearestFilter;
    texture2.magFilter = NearestFilter;
  }
  return texture2;
}
function makeStorageDouble(width, height, linear, name) {
  return {
    read: makeStorageTarget(width, height, linear, `${name}.read`),
    write: makeStorageTarget(width, height, linear, `${name}.write`)
  };
}
function resizeStorage(texture2, width, height) {
  texture2.setSize(width, height, 1);
}
function resizeStorageDouble(target, width, height) {
  resizeStorage(target.read, width, height);
  resizeStorage(target.write, width, height);
}
function swap(target) {
  const tmp = target.read;
  target.read = target.write;
  target.write = tmp;
}
function disposeDouble(target) {
  target.read.dispose();
  target.write.dispose();
}
function makeParams(width, height) {
  const params = new Float32Array(UNIFORM_FLOATS);
  params[0] = width;
  params[1] = height;
  params[2] = 1 / width;
  params[3] = 1 / height;
  return params;
}
class WGSLFluidSimulation {
  simResolution;
  dyeResolution;
  pressureIterations;
  densityDissipation;
  velocityDissipation;
  pressureDissipation;
  curlStrength;
  splatRadius;
  splatForce;
  baseDelta;
  enableVorticity;
  bfecc;
  reflectWalls;
  enableDye = false;
  dyeDissipation;
  densityNode;
  dyeNode;
  velocityNode;
  pressureNode;
  divergenceNode;
  curlNode;
  renderer;
  backend;
  device;
  velocity;
  density;
  dye;
  pressure;
  divergence;
  curl;
  pipelines;
  linearSampler;
  uniformBuffers = [];
  textureViews = /* @__PURE__ */ new Map();
  bindGroups = /* @__PURE__ */ new Map();
  splats = [];
  frameUniformIndex = 0;
  targetsNeedClear = true;
  viewportWidth = 1;
  viewportHeight = 1;
  simWidth;
  simHeight;
  dyeWidth;
  dyeHeight;
  constructor(renderer, options = {}) {
    this.renderer = renderer;
    this.backend = this.getWebGPUBackend(renderer);
    this.device = this.backend.device;
    const profile = FLUID_PROFILES[options.profile ?? "balanced"];
    this.simResolution = options.simResolution ?? profile.simResolution;
    this.dyeResolution = options.dyeResolution ?? profile.dyeResolution;
    this.pressureIterations = options.pressureIterations ?? profile.pressureIterations;
    this.densityDissipation = options.densityDissipation ?? 0.91;
    this.velocityDissipation = options.velocityDissipation ?? 0.985;
    this.pressureDissipation = options.pressureDissipation ?? 0.8;
    this.curlStrength = options.curlStrength ?? 0.55;
    this.splatRadius = options.splatRadius ?? 42e-5;
    this.splatForce = options.splatForce ?? 6;
    this.baseDelta = options.baseDelta ?? 1 / 60;
    this.enableVorticity = options.enableVorticity ?? false;
    this.bfecc = options.bfecc ?? true;
    this.reflectWalls = options.reflectWalls ?? true;
    this.dyeDissipation = options.dyeDissipation ?? this.densityDissipation;
    this.simWidth = this.simResolution;
    this.simHeight = this.simResolution;
    this.dyeWidth = this.dyeResolution;
    this.dyeHeight = this.dyeResolution;
    this.velocity = makeStorageDouble(this.simWidth, this.simHeight, true, "fluid.wgsl.velocity");
    this.density = makeStorageDouble(this.dyeWidth, this.dyeHeight, true, "fluid.wgsl.density");
    this.dye = makeStorageDouble(this.dyeWidth, this.dyeHeight, true, "fluid.wgsl.dye");
    this.pressure = makeStorageDouble(this.simWidth, this.simHeight, false, "fluid.wgsl.pressure");
    this.divergence = makeStorageTarget(
      this.simWidth,
      this.simHeight,
      false,
      "fluid.wgsl.divergence"
    );
    this.curl = makeStorageTarget(this.simWidth, this.simHeight, false, "fluid.wgsl.curl");
    this.initGpuTextures();
    this.densityNode = texture(this.density.read);
    this.dyeNode = texture(this.dye.read);
    this.velocityNode = texture(this.velocity.read);
    this.pressureNode = texture(this.pressure.read);
    this.divergenceNode = texture(this.divergence);
    this.curlNode = texture(this.curl);
    this.linearSampler = this.device.createSampler({
      label: "fluid.wgsl.linearSampler",
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "nearest",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge"
    });
    this.pipelines = this.createPipelines();
  }
  get velocityTexture() {
    return this.velocity.read;
  }
  get velocityProjectedTexture() {
    return this.velocity.write;
  }
  get densityTexture() {
    return this.density.read;
  }
  get dyeTexture() {
    return this.dye.read;
  }
  resize(width, height) {
    this.viewportWidth = Math.max(1, width);
    this.viewportHeight = Math.max(1, height);
    const aspect = this.viewportWidth / this.viewportHeight;
    let newSimW, newSimH, newDyeW, newDyeH;
    if (aspect >= 1) {
      newSimW = this.simResolution;
      newSimH = Math.max(1, Math.round(this.simResolution / aspect));
      newDyeW = this.dyeResolution;
      newDyeH = Math.max(1, Math.round(this.dyeResolution / aspect));
    } else {
      newSimW = Math.max(1, Math.round(this.simResolution * aspect));
      newSimH = this.simResolution;
      newDyeW = Math.max(1, Math.round(this.dyeResolution * aspect));
      newDyeH = this.dyeResolution;
    }
    let resized = false;
    if (newSimW !== this.simWidth || newSimH !== this.simHeight) {
      this.simWidth = newSimW;
      this.simHeight = newSimH;
      resizeStorageDouble(this.velocity, newSimW, newSimH);
      resizeStorageDouble(this.pressure, newSimW, newSimH);
      resizeStorage(this.divergence, newSimW, newSimH);
      resizeStorage(this.curl, newSimW, newSimH);
      this.targetsNeedClear = true;
      resized = true;
    }
    if (newDyeW !== this.dyeWidth || newDyeH !== this.dyeHeight) {
      this.dyeWidth = newDyeW;
      this.dyeHeight = newDyeH;
      resizeStorageDouble(this.density, newDyeW, newDyeH);
      resizeStorageDouble(this.dye, newDyeW, newDyeH);
      this.targetsNeedClear = true;
      resized = true;
    }
    if (resized) {
      this.initGpuTextures();
      this.textureViews.clear();
      this.bindGroups.clear();
    }
  }
  addSplat(x, y, dx, dy, options = {}) {
    this.splats.push({
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y)),
      dx,
      dy,
      radius: options.radius ?? this.splatRadius,
      color: options.color,
      dyeColor: options.dyeColor
    });
  }
  step(deltaSeconds) {
    const dt = Math.min(Math.max(deltaSeconds, 1e-6), 1 / 60);
    const dtScale = this.baseDelta > 0 ? dt / this.baseDelta : 1;
    const encoder = this.device.createCommandEncoder({ label: "fluid.wgsl.step" });
    this.frameUniformIndex = 0;
    if (this.targetsNeedClear) {
      this.clearTargets(encoder);
      this.targetsNeedClear = false;
    }
    for (let i = 0; i < this.splats.length; i += 1) {
      this.applySplat(encoder, this.splats[i]);
    }
    this.splats.length = 0;
    if (this.enableVorticity) {
      this.dispatch(encoder, "curl", this.simWidth, this.simHeight, [
        { binding: 1, texture: this.velocity.read },
        { binding: 2, texture: this.curl }
      ]);
    }
    if (this.enableVorticity) {
      const params = makeParams(this.simWidth, this.simHeight);
      params[8] = this.curlStrength;
      params[9] = dt;
      this.dispatch(
        encoder,
        "vorticity",
        this.simWidth,
        this.simHeight,
        [
          { binding: 1, texture: this.velocity.read },
          { binding: 2, texture: this.curl },
          { binding: 3, texture: this.velocity.write }
        ],
        params
      );
      swap(this.velocity);
    }
    const divergenceParams = makeParams(this.simWidth, this.simHeight);
    divergenceParams[8] = this.reflectWalls ? 1 : 0;
    this.dispatch(
      encoder,
      "divergence",
      this.simWidth,
      this.simHeight,
      [
        { binding: 1, texture: this.velocity.read },
        { binding: 2, texture: this.divergence }
      ],
      divergenceParams
    );
    const pressureClearParams = makeParams(this.simWidth, this.simHeight);
    pressureClearParams[4] = Math.pow(this.pressureDissipation, dtScale);
    this.dispatch(
      encoder,
      "decay",
      this.simWidth,
      this.simHeight,
      [
        { binding: 1, texture: this.pressure.read },
        { binding: 2, texture: this.pressure.write }
      ],
      pressureClearParams
    );
    swap(this.pressure);
    for (let i = 0; i < this.pressureIterations; i += 1) {
      this.dispatch(encoder, "pressure", this.simWidth, this.simHeight, [
        { binding: 1, texture: this.pressure.read },
        { binding: 2, texture: this.divergence },
        { binding: 3, texture: this.pressure.write }
      ]);
      swap(this.pressure);
    }
    this.dispatch(encoder, "gradientSubtract", this.simWidth, this.simHeight, [
      { binding: 1, texture: this.pressure.read },
      { binding: 2, texture: this.velocity.read },
      { binding: 3, texture: this.velocity.write }
    ]);
    swap(this.velocity);
    const bfecc = this.bfecc ? 1 : 0;
    this.advectTexture(
      encoder,
      this.velocity,
      this.simWidth,
      this.simHeight,
      Math.pow(this.velocityDissipation, dtScale),
      dt,
      bfecc
    );
    this.advectTexture(
      encoder,
      this.density,
      this.dyeWidth,
      this.dyeHeight,
      Math.pow(this.densityDissipation, dtScale),
      dt,
      bfecc
    );
    if (this.enableDye) {
      this.advectTexture(
        encoder,
        this.dye,
        this.dyeWidth,
        this.dyeHeight,
        Math.pow(this.dyeDissipation, dtScale),
        dt,
        bfecc
      );
    }
    this.device.queue.submit([encoder.finish()]);
    this.refreshPublicNodes();
  }
  dispose() {
    disposeDouble(this.velocity);
    disposeDouble(this.density);
    disposeDouble(this.dye);
    disposeDouble(this.pressure);
    this.divergence.dispose();
    this.curl.dispose();
    for (const buffer of this.uniformBuffers) buffer.destroy();
    this.uniformBuffers.length = 0;
    this.textureViews.clear();
    this.bindGroups.clear();
  }
  getWebGPUBackend(renderer) {
    const backend = renderer.backend;
    if (!backend?.isWebGPUBackend || !backend.device) {
      throw new Error("WGSLFluidSimulation requires WebGPURenderer with the WebGPU backend.");
    }
    return backend;
  }
  createPipelines() {
    const entries = Object.entries(WGSL_SHADERS);
    return entries.reduce(
      (pipelines, [name, code]) => {
        const module = this.device.createShaderModule({
          label: `fluid.wgsl.${name}.module`,
          code
        });
        pipelines[name] = this.device.createComputePipeline({
          label: `fluid.wgsl.${name}.pipeline`,
          layout: "auto",
          compute: { module, entryPoint: "main" }
        });
        return pipelines;
      },
      {}
    );
  }
  initGpuTextures() {
    for (const texture2 of this.allTextures()) {
      this.renderer.initTexture(texture2);
    }
  }
  allTextures() {
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
      this.curl
    ];
  }
  getGpuTexture(texture2) {
    const gpuTexture = this.backend.get(texture2).texture;
    if (!gpuTexture) throw new Error(`Missing GPUTexture for ${texture2.name || "StorageTexture"}.`);
    return gpuTexture;
  }
  getTextureView(texture2) {
    let view = this.textureViews.get(texture2.id);
    if (!view) {
      view = this.getGpuTexture(texture2).createView();
      this.textureViews.set(texture2.id, view);
    }
    return view;
  }
  writeUniform(params) {
    const index = this.frameUniformIndex;
    this.frameUniformIndex += 1;
    let buffer = this.uniformBuffers[index];
    if (!buffer) {
      buffer = this.device.createBuffer({
        label: `fluid.wgsl.uniform.${index}`,
        size: UNIFORM_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
      this.uniformBuffers[index] = buffer;
    }
    this.device.queue.writeBuffer(
      buffer,
      0,
      params.buffer,
      params.byteOffset,
      params.byteLength
    );
    return { index, buffer };
  }
  getBindGroup(name, uniformIndex, uniformBuffer, resources) {
    const key = [
      name,
      uniformIndex,
      ...resources.map(
        (resource) => "texture" in resource ? `${resource.binding}:texture:${resource.texture.id}` : `${resource.binding}:sampler:${resource.sampler}`
      )
    ].join("|");
    let bindGroup = this.bindGroups.get(key);
    if (!bindGroup) {
      const entries = [
        {
          binding: 0,
          resource: { buffer: uniformBuffer }
        }
      ];
      for (const resource of resources) {
        entries.push(
          "texture" in resource ? { binding: resource.binding, resource: this.getTextureView(resource.texture) } : { binding: resource.binding, resource: this.linearSampler }
        );
      }
      bindGroup = this.device.createBindGroup({
        label: `fluid.wgsl.${name}.bindGroup`,
        layout: this.pipelines[name].getBindGroupLayout(0),
        entries
      });
      this.bindGroups.set(key, bindGroup);
    }
    return bindGroup;
  }
  dispatch(encoder, name, width, height, resources, params = makeParams(width, height)) {
    const uniform2 = this.writeUniform(params);
    const pass = encoder.beginComputePass({ label: `fluid.wgsl.${name}` });
    pass.setPipeline(this.pipelines[name]);
    pass.setBindGroup(0, this.getBindGroup(name, uniform2.index, uniform2.buffer, resources));
    pass.dispatchWorkgroups(Math.ceil(width / WORKGROUP_X), Math.ceil(height / WORKGROUP_Y), 1);
    pass.end();
  }
  clearTargets(encoder) {
    this.clearTexture(encoder, this.velocity.read, this.simWidth, this.simHeight);
    this.clearTexture(encoder, this.velocity.write, this.simWidth, this.simHeight);
    this.clearTexture(encoder, this.pressure.read, this.simWidth, this.simHeight);
    this.clearTexture(encoder, this.pressure.write, this.simWidth, this.simHeight);
    this.clearTexture(encoder, this.divergence, this.simWidth, this.simHeight);
    this.clearTexture(encoder, this.curl, this.simWidth, this.simHeight);
    this.clearTexture(encoder, this.density.read, this.dyeWidth, this.dyeHeight);
    this.clearTexture(encoder, this.density.write, this.dyeWidth, this.dyeHeight);
    this.clearTexture(encoder, this.dye.read, this.dyeWidth, this.dyeHeight);
    this.clearTexture(encoder, this.dye.write, this.dyeWidth, this.dyeHeight);
  }
  clearTexture(encoder, texture2, width, height) {
    this.dispatch(encoder, "fill", width, height, [{ binding: 1, texture: texture2 }]);
  }
  applySplat(encoder, splat) {
    const color = splat.color ?? [splat.dx, splat.dy, 1];
    this.applySplatToDouble(encoder, this.velocity, this.simWidth, this.simHeight, splat, color);
    this.applySplatToDouble(encoder, this.density, this.dyeWidth, this.dyeHeight, splat, color);
    if (this.enableDye && splat.dyeColor) {
      this.applySplatToDouble(
        encoder,
        this.dye,
        this.dyeWidth,
        this.dyeHeight,
        splat,
        splat.dyeColor
      );
    }
  }
  applySplatToDouble(encoder, target, width, height, splat, color) {
    const params = makeParams(width, height);
    params[4] = color[0];
    params[5] = color[1];
    params[6] = color[2];
    params[7] = 1;
    params[8] = splat.x;
    params[9] = splat.y;
    params[10] = Math.max(1e-6, 3 * Math.sqrt(splat.radius));
    params[11] = this.viewportWidth / this.viewportHeight;
    this.dispatch(
      encoder,
      "splat",
      width,
      height,
      [
        { binding: 1, texture: target.read },
        { binding: 2, texture: target.write }
      ],
      params
    );
    swap(target);
  }
  advectTexture(encoder, target, width, height, dissipation, dt, bfecc) {
    const params = makeParams(width, height);
    params[8] = dt;
    params[9] = dissipation;
    params[10] = bfecc;
    this.dispatch(
      encoder,
      "advect",
      width,
      height,
      [
        { binding: 1, texture: this.velocity.read },
        { binding: 2, texture: target.read },
        { binding: 3, sampler: "linear" },
        { binding: 4, texture: target.write }
      ],
      params
    );
    swap(target);
  }
  refreshPublicNodes() {
    this.densityNode.value = this.density.read;
    this.dyeNode.value = this.dye.read;
    this.velocityNode.value = this.velocity.read;
    this.pressureNode.value = this.pressure.read;
    this.divergenceNode.value = this.divergence;
    this.curlNode.value = this.curl;
  }
}
function hsv2rgb(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0:
      return [v, t, p];
    case 1:
      return [q, v, p];
    case 2:
      return [p, v, t];
    case 3:
      return [p, q, v];
    case 4:
      return [t, p, v];
    default:
      return [v, p, q];
  }
}
function attachPointerSplats(element, fluid, options = {}) {
  const coloredStrokes = options.coloredStrokes ?? false;
  const colorUpdateSpeed = options.colorUpdateSpeed ?? 10;
  const colorize = options.colorize;
  let strokeColor = hsv2rgb(Math.random(), 1, 1);
  let colorTimer = 0;
  const scaleColor = (c) => [c[0] * 0.3, c[1] * 0.3, c[2] * 0.3];
  let lastX = 0;
  let lastY = 0;
  let lastTime = 0;
  let hasPointer = false;
  let lastFireX = 0;
  let lastFireY = 0;
  let activePointerId = -1;
  let rectLeft = 0;
  let rectTop = 0;
  let rectWidth = 1;
  let rectHeight = 1;
  const refreshRect = () => {
    const rect = element.getBoundingClientRect();
    rectLeft = rect.left;
    rectTop = rect.top;
    rectWidth = Math.max(1, rect.width);
    rectHeight = Math.max(1, rect.height);
  };
  refreshRect();
  requestAnimationFrame(() => {
    refreshRect();
    requestAnimationFrame(refreshRect);
  });
  const ro = new ResizeObserver(refreshRect);
  ro.observe(element);
  const move = (event) => {
    if (rectWidth < 4 || rectHeight < 4) {
      refreshRect();
      if (rectWidth < 4 || rectHeight < 4) return;
    }
    const now = event.timeStamp || performance.now();
    const gap = now - lastTime;
    if (gap > 200) hasPointer = false;
    if (activePointerId !== -1 && event.pointerId !== activePointerId) hasPointer = false;
    activePointerId = event.pointerId;
    lastTime = now;
    const isStrokeStart = !hasPointer;
    if (coloredStrokes) {
      colorTimer += Math.min(Math.max(gap, 0), 100) / 1e3 * colorUpdateSpeed;
      if (isStrokeStart || colorTimer >= 1) {
        if (colorTimer >= 1) colorTimer %= 1;
        strokeColor = hsv2rgb(Math.random(), 1, 1);
      }
    }
    const x = (event.clientX - rectLeft) / rectWidth;
    const y = 1 - (event.clientY - rectTop) / rectHeight;
    const dx = hasPointer ? event.movementX || event.clientX - lastX : 0;
    const dy = hasPointer ? -(event.movementY || event.clientY - lastY) : 0;
    lastX = event.clientX;
    lastY = event.clientY;
    hasPointer = true;
    if (Math.abs(dx) + Math.abs(dy) < 0.25) return;
    const fireDist = lastFireX || lastFireY ? Math.hypot(event.clientX - lastFireX, event.clientY - lastFireY) : 0;
    if (gap > 0 && fireDist / gap > 6.5 && fireDist > 200) {
      hasPointer = false;
      lastFireX = event.clientX;
      lastFireY = event.clientY;
      return;
    }
    lastFireX = event.clientX;
    lastFireY = event.clientY;
    const force = fluid.splatForce;
    let dyeColor;
    if (colorize) dyeColor = colorize(dx, dy, now);
    if (dyeColor === void 0 && coloredStrokes) dyeColor = scaleColor(strokeColor);
    fluid.addSplat(x, y, dx * force, dy * force, dyeColor ? { dyeColor } : void 0);
  };
  const reset = () => {
    hasPointer = false;
  };
  element.addEventListener("pointermove", move);
  element.addEventListener("pointerout", reset);
  element.addEventListener("pointercancel", reset);
  window.addEventListener("blur", reset);
  document.addEventListener("visibilitychange", reset);
  window.addEventListener("resize", refreshRect);
  window.addEventListener("scroll", refreshRect, { passive: true });
  return () => {
    ro.disconnect();
    element.removeEventListener("pointermove", move);
    element.removeEventListener("pointerout", reset);
    element.removeEventListener("pointercancel", reset);
    window.removeEventListener("blur", reset);
    document.removeEventListener("visibilitychange", reset);
    window.removeEventListener("resize", refreshRect);
    window.removeEventListener("scroll", refreshRect);
  };
}
class ChromaticDistortionNode extends TempNode {
  static get type() {
    return "ChromaticDistortionNode";
  }
  sceneTexture;
  fluidTexture;
  intensityNode;
  // Inverse-size uniform — `1 / fluidWidth, 1 / fluidHeight` in pixels. Updated
  // every frame because the fluid FBO can resize on canvas-size changes.
  _invSize = uniform(new Vector2());
  constructor(sceneTexture, fluidTexture, intensityNode) {
    super("vec4");
    this.sceneTexture = sceneTexture;
    this.fluidTexture = fluidTexture;
    this.intensityNode = intensityNode;
    this.updateBeforeType = NodeUpdateType.FRAME;
  }
  updateBefore(_frame) {
    const map = this.fluidTexture.value;
    const w = map?.image?.width ?? 1;
    const h = map?.image?.height ?? 1;
    this._invSize.value.set(1 / w, 1 / h);
    return void 0;
  }
  setup(_builder) {
    const sceneTex = this.sceneTexture;
    const fluidTex = this.fluidTexture;
    const sceneUv = sceneTex.uvNode || uv();
    const fluidUv = fluidTex.uvNode || uv();
    const invSize = this._invSize;
    const intensity = this.intensityNode;
    const apply = Fn(() => {
      const offX = vec2(invSize.x.mul(2), 0);
      const offY = vec2(0, invSize.y.mul(2));
      const center = fluidTex.sample(fluidUv).rgb.mul(0.36);
      const blurred = center.add(fluidTex.sample(fluidUv.add(offX)).rgb.mul(0.16)).add(fluidTex.sample(fluidUv.sub(offX)).rgb.mul(0.16)).add(fluidTex.sample(fluidUv.add(offY)).rgb.mul(0.16)).add(fluidTex.sample(fluidUv.sub(offY)).rgb.mul(0.16));
      const vel = blurred.xy;
      const density = blurred.z.clamp(0, 1);
      const falloff = density.pow(1.2);
      const chroma = vel.mul(3e-3).mul(intensity).mul(falloff);
      const distUv = sceneUv.sub(vel.mul(2e-4).mul(intensity).mul(falloff));
      const r = sceneTex.sample(distUv.add(vec2(chroma.x, chroma.y))).r;
      const g = sceneTex.sample(distUv.add(vec2(chroma.x.negate(), chroma.y))).g;
      const b = sceneTex.sample(distUv.add(vec2(chroma.x.negate(), chroma.y.negate()))).b;
      return vec4(r, g, b, 1);
    });
    return apply();
  }
}
const chromaticDistortion = (sceneNode, fluidNode, intensity = 1) => nodeObject(
  new ChromaticDistortionNode(
    convertToTexture(sceneNode),
    convertToTexture(fluidNode),
    nodeObject(intensity)
  )
);
class SimpleDistortionNode extends TempNode {
  static get type() {
    return "SimpleDistortionNode";
  }
  sceneTexture;
  fluidTexture;
  intensityNode;
  constructor(sceneTexture, fluidTexture, intensityNode) {
    super("vec4");
    this.sceneTexture = sceneTexture;
    this.fluidTexture = fluidTexture;
    this.intensityNode = intensityNode;
  }
  setup(_builder) {
    const sceneTex = this.sceneTexture;
    const fluidTex = this.fluidTexture;
    const sceneUv = sceneTex.uvNode || uv();
    const fluidUv = fluidTex.uvNode || uv();
    const intensity = this.intensityNode;
    const apply = Fn(() => {
      const vel = fluidTex.sample(fluidUv).rg;
      const distUv = sceneUv.sub(vel.mul(intensity).mul(3e-4)).clamp(0, 1);
      return sceneTex.sample(distUv);
    });
    return apply();
  }
}
const simpleDistortion = (sceneNode, fluidNode, intensity = 1) => nodeObject(
  new SimpleDistortionNode(
    convertToTexture(sceneNode),
    convertToTexture(fluidNode),
    nodeObject(intensity)
  )
);
class RGBShiftDistortionNode extends TempNode {
  static get type() {
    return "RGBShiftDistortionNode";
  }
  sceneTexture;
  fluidTexture;
  intensityNode;
  constructor(sceneTexture, fluidTexture, intensityNode) {
    super("vec4");
    this.sceneTexture = sceneTexture;
    this.fluidTexture = fluidTexture;
    this.intensityNode = intensityNode;
  }
  setup(_builder) {
    const sceneTex = this.sceneTexture;
    const fluidTex = this.fluidTexture;
    const sceneUv = sceneTex.uvNode || uv();
    const fluidUv = fluidTex.uvNode || uv();
    const intensity = this.intensityNode;
    const apply = Fn(() => {
      const fluid = fluidTex.sample(fluidUv).rgb;
      const vel = fluid.xy;
      const density = fluid.z.clamp(0, 1);
      const speed = max(vel.length(), 1e-4);
      const dir = vel.div(speed);
      const strength = density.pow(1.4).mul(intensity).mul(0.012);
      const shift = dir.mul(strength);
      const r = sceneTex.sample(sceneUv.add(shift)).r;
      const g = sceneTex.sample(sceneUv).g;
      const b = sceneTex.sample(sceneUv.sub(shift)).b;
      return vec4(r, g, b, 1);
    });
    return apply();
  }
}
const rgbShiftDistortion = (sceneNode, fluidNode, intensity = 1) => nodeObject(
  new RGBShiftDistortionNode(
    convertToTexture(sceneNode),
    convertToTexture(fluidNode),
    nodeObject(intensity)
  )
);
class WaterDistortionNode extends TempNode {
  static get type() {
    return "WaterDistortionNode";
  }
  sceneTexture;
  fluidTexture;
  intensityNode;
  // `1 / fluidWidth, 1 / fluidHeight` — refreshed each frame because the
  // fluid FBO can resize on canvas changes.
  _invSize = uniform(new Vector2());
  constructor(sceneTexture, fluidTexture, intensityNode) {
    super("vec4");
    this.sceneTexture = sceneTexture;
    this.fluidTexture = fluidTexture;
    this.intensityNode = intensityNode;
    this.updateBeforeType = NodeUpdateType.FRAME;
  }
  updateBefore(_frame) {
    const map = this.fluidTexture.value;
    const w = map?.image?.width ?? 1;
    const h = map?.image?.height ?? 1;
    this._invSize.value.set(1 / w, 1 / h);
    return void 0;
  }
  setup(_builder) {
    const sceneTex = this.sceneTexture;
    const fluidTex = this.fluidTexture;
    const sceneUv = sceneTex.uvNode || uv();
    const fluidUv = fluidTex.uvNode || uv();
    const invSize = this._invSize;
    const intensity = this.intensityNode;
    const apply = Fn(() => {
      const offX = vec2(invSize.x.mul(2), 0);
      const offY = vec2(0, invSize.y.mul(2));
      const hL = fluidTex.sample(fluidUv.sub(offX)).b;
      const hR = fluidTex.sample(fluidUv.add(offX)).b;
      const hD = fluidTex.sample(fluidUv.sub(offY)).b;
      const hU = fluidTex.sample(fluidUv.add(offY)).b;
      const normal = vec2(hR.sub(hL), hU.sub(hD));
      const offset = normal.mul(intensity).mul(0.6);
      const r = sceneTex.sample(sceneUv.add(offset.mul(0.95))).r;
      const g = sceneTex.sample(sceneUv.add(offset)).g;
      const b = sceneTex.sample(sceneUv.add(offset.mul(1.05))).b;
      return vec4(r, g, b, 1);
    });
    return apply();
  }
}
const waterDistortion = (sceneNode, fluidNode, intensity = 1) => nodeObject(
  new WaterDistortionNode(
    convertToTexture(sceneNode),
    convertToTexture(fluidNode),
    nodeObject(intensity)
  )
);
class WaterCausticsDistortionNode extends TempNode {
  static get type() {
    return "WaterCausticsDistortionNode";
  }
  sceneTexture;
  fluidTexture;
  intensityNode;
  timeNode;
  _invSize = uniform(new Vector2());
  constructor(sceneTexture, fluidTexture, intensityNode, timeNode) {
    super("vec4");
    this.sceneTexture = sceneTexture;
    this.fluidTexture = fluidTexture;
    this.intensityNode = intensityNode;
    this.timeNode = timeNode;
    this.updateBeforeType = NodeUpdateType.FRAME;
  }
  updateBefore(_frame) {
    const map = this.fluidTexture.value;
    const w = map?.image?.width ?? 1;
    const h = map?.image?.height ?? 1;
    this._invSize.value.set(1 / w, 1 / h);
    return void 0;
  }
  setup(_builder) {
    const sceneTex = this.sceneTexture;
    const fluidTex = this.fluidTexture;
    const sceneUv = sceneTex.uvNode || uv();
    const fluidUv = fluidTex.uvNode || uv();
    const invSize = this._invSize;
    const intensity = this.intensityNode;
    const timeNode = this.timeNode;
    const TAU2 = 6.28318530718;
    const INTEN = 5e-3;
    const causticWeb = (rawUv, t) => {
      const p = rawUv.mul(TAU2).mod(TAU2).sub(250);
      let i = p;
      let c = float(1);
      for (let n = 0; n < 5; n++) {
        const tt = t.mul(1 - 3.5 / (n + 1));
        i = p.add(
          vec2(
            tt.sub(i.x).cos().add(tt.add(i.y).sin()),
            tt.sub(i.y).sin().add(tt.add(i.x).cos())
          )
        );
        const denomX = i.x.add(tt).sin().div(INTEN);
        const denomY = i.y.add(tt).cos().div(INTEN);
        const lenArg = vec2(p.x.div(denomX), p.y.div(denomY));
        c = c.add(float(1).div(lenArg.length()));
      }
      c = c.div(5);
      c = float(1.17).sub(c.pow(1.4));
      return c.abs().pow(8).clamp(0, 1);
    };
    const apply = Fn(() => {
      const offX = vec2(invSize.x.mul(2), 0);
      const offY = vec2(0, invSize.y.mul(2));
      const fluidCenter = fluidTex.sample(fluidUv).rgb;
      const hC = fluidCenter.z;
      const vel = fluidCenter.xy;
      const hL = fluidTex.sample(fluidUv.sub(offX)).b;
      const hR = fluidTex.sample(fluidUv.add(offX)).b;
      const hD = fluidTex.sample(fluidUv.sub(offY)).b;
      const hU = fluidTex.sample(fluidUv.add(offY)).b;
      const normal = vec2(hR.sub(hL), hU.sub(hD));
      const offset = normal.mul(intensity).mul(0.6);
      const r = sceneTex.sample(sceneUv.add(offset.mul(0.95))).r;
      const g = sceneTex.sample(sceneUv.add(offset)).g;
      const b = sceneTex.sample(sceneUv.add(offset.mul(1.05))).b;
      const surface = smoothstep(0.015, 0.16, hC);
      const slope = smoothstep(15e-4, 0.04, normal.length());
      const cuv = sceneUv.mul(4).add(vel.mul(12e-4));
      const web = causticWeb(cuv, timeNode.mul(0.5).add(23));
      const caustic = vec3(web, web, web).add(vec3(0, 0.35, 0.5)).clamp(0, 1);
      const energy = web.pow(1.25).mul(surface).mul(slope.mul(0.6).add(0.4));
      const color = vec3(r, g, b).add(caustic.mul(energy).mul(intensity).mul(0.38));
      return vec4(color, 1);
    });
    return apply();
  }
}
const waterCausticsDistortion = (sceneNode, fluidNode, intensity = 1, time = 0) => nodeObject(
  new WaterCausticsDistortionNode(
    convertToTexture(sceneNode),
    convertToTexture(fluidNode),
    nodeObject(intensity),
    nodeObject(time)
  )
);
const toNode$1 = (value, fallback) => nodeObject(value ?? fallback);
class DensityTintOverlayNode extends TempNode {
  static get type() {
    return "DensityTintOverlayNode";
  }
  sceneTexture;
  fluidTexture;
  intensityNode;
  tintNode;
  constructor(sceneTexture, fluidTexture, intensityNode, tintNode) {
    super("vec4");
    this.sceneTexture = sceneTexture;
    this.fluidTexture = fluidTexture;
    this.intensityNode = intensityNode;
    this.tintNode = tintNode;
  }
  setup(_builder) {
    const sceneTex = this.sceneTexture;
    const fluidTex = this.fluidTexture;
    const sceneUv = sceneTex.uvNode || uv();
    const fluidUv = fluidTex.uvNode || uv();
    const intensity = this.intensityNode;
    const tint = this.tintNode;
    const apply = Fn(() => {
      const scene = sceneTex.sample(sceneUv).rgb;
      const density = fluidTex.sample(fluidUv).b.clamp(0, 1);
      return vec4(scene.add(tint.mul(density).mul(intensity)), 1);
    });
    return apply();
  }
}
const densityTintOverlay = (sceneNode, fluidNode, options = {}) => nodeObject(
  new DensityTintOverlayNode(
    convertToTexture(sceneNode),
    convertToTexture(fluidNode),
    toNode$1(options.intensity, float(0.14)),
    toNode$1(options.tint, vec3(0.1, 0.42, 0.36))
  )
);
const TAU = 6.28318530718;
const toNode = (value, fallback) => nodeObject(value ?? fallback);
class FluidOverlayNode extends TempNode {
  static get type() {
    return "FluidOverlayNode";
  }
  style;
  sceneTexture;
  densityTexture;
  dyeTexture;
  velocityTexture;
  intensityNode;
  timeNode;
  texelNode;
  cursorColorNode;
  vibranceNode;
  velocityScaleNode;
  opacityNode;
  constructor(style, sceneTexture, densityTexture, dyeTexture, velocityTexture, options) {
    super("vec4");
    this.style = style;
    this.sceneTexture = sceneTexture;
    this.densityTexture = densityTexture;
    this.dyeTexture = dyeTexture;
    this.velocityTexture = velocityTexture;
    this.intensityNode = options.intensity;
    this.timeNode = options.time;
    this.texelNode = options.texel;
    this.cursorColorNode = options.cursorColor;
    this.vibranceNode = options.vibrance;
    this.velocityScaleNode = options.velocityScale;
    this.opacityNode = options.opacity;
  }
  setup(_builder) {
    const sceneTex = this.sceneTexture;
    const densityTex = this.densityTexture;
    const dyeTex = this.dyeTexture;
    const velocityTex = this.velocityTexture;
    const sceneUv = sceneTex.uvNode || uv();
    const fluidUv = densityTex.uvNode || uv();
    const intensity = this.intensityNode;
    const timeNode = this.timeNode;
    const texel = this.texelNode;
    const cursorColor = this.cursorColorNode;
    const vibrance = this.vibranceNode;
    const velocityScale = this.velocityScaleNode;
    const opacity = this.opacityNode;
    const sampleDye5 = (uv2) => {
      let d = dyeTex.sample(uv2).rgb.mul(0.5);
      d = d.add(dyeTex.sample(uv2.add(texel.mul(vec2(1, 1)))).rgb.mul(0.125));
      d = d.add(dyeTex.sample(uv2.add(texel.mul(vec2(-1, 1)))).rgb.mul(0.125));
      d = d.add(dyeTex.sample(uv2.add(texel.mul(vec2(1, -1)))).rgb.mul(0.125));
      d = d.add(dyeTex.sample(uv2.add(texel.mul(vec2(-1, -1)))).rgb.mul(0.125));
      return d;
    };
    const palette = (phase) => {
      const p = phase.fract();
      return vec3(
        p.mul(TAU).sin().mul(0.5).add(0.5),
        p.add(0.333).mul(TAU).sin().mul(0.5).add(0.5),
        p.add(0.666).mul(TAU).sin().mul(0.5).add(0.5)
      );
    };
    const oilPalette = (phase) => {
      const ember = vec3(1, 0.33, 0.2);
      const mint = vec3(0.08, 0.78, 0.68);
      const cream = vec3(1, 0.84, 0.55);
      return mix(
        mix(ember, cream, smoothstep(0.15, 0.85, phase)),
        mint,
        smoothstep(0.55, 1, phase).mul(0.42)
      );
    };
    const hsv2rgb2 = (c) => {
      const K = vec4(1, 2 / 3, 1 / 3, 3);
      const p = c.xxx.add(K.xyz).fract().mul(6).sub(K.www).abs();
      return c.z.mul(mix(K.xxx, p.sub(K.xxx).clamp(0, 1), c.y));
    };
    const vibrant = (color, amount) => {
      const lum = dot(color, vec3(0.299, 0.587, 0.114));
      return mix(vec3(lum, lum, lum), color, float(1).add(amount)).clamp(0, 1);
    };
    const farDye = () => {
      const offX = vec2(texel.x.mul(8), 0);
      const offY = vec2(0, texel.y.mul(8));
      let far = dyeTex.sample(fluidUv.add(offX)).rgb.length();
      far = far.add(dyeTex.sample(fluidUv.sub(offX)).rgb.length());
      far = far.add(dyeTex.sample(fluidUv.add(offY)).rgb.length());
      far = far.add(dyeTex.sample(fluidUv.sub(offY)).rgb.length());
      return far.mul(0.25);
    };
    const trailTail = (vel) => {
      let tail = float(0);
      let wsum = float(0);
      for (let i = 1; i < 8; i += 1) {
        const weight = 1 - i / 8;
        tail = tail.add(densityTex.sample(fluidUv.sub(vel.mul(i * 0.04))).b.mul(weight));
        wsum = wsum.add(weight);
      }
      return tail.div(wsum);
    };
    const apply = Fn(() => {
      const densitySample = densityTex.sample(fluidUv).rgb;
      const velocitySample = velocityTex.sample(fluidUv).rg.mul(velocityScale);
      const density = densitySample.b.clamp(0, 1);
      const vel = densitySample.rg;
      const dye = sampleDye5(fluidUv);
      const dyeAmp = dye.length();
      const dyeHue = dye.div(dyeAmp.add(1e-5)).clamp(0, 1);
      const scene = sceneTex.sample(sceneUv).rgb;
      const speed = vel.length();
      const composite = (overlay) => vec4(mix(scene, overlay, opacity.clamp(0, 1)), 1);
      if (this.style === "default") {
        const core = smoothstep(0.02, 0.55, farDye().mul(intensity).mul(4));
        const kinetic = speed.mul(0.02).clamp(0, 1);
        const tint2 = vibrant(
          cursorColor.mul(float(0.48).add(core.mul(0.52))).add(vec3(kinetic.mul(0.12))),
          vibrance
        );
        const alpha = dyeAmp.mul(intensity).mul(3).clamp(0, 0.95);
        return composite(mix(scene, tint2, alpha));
      }
      if (this.style === "volumeCursor") {
        const offX = vec2(texel.x.mul(1.5), 0);
        const offY = vec2(0, texel.y.mul(1.5));
        const grad = vec2(
          dyeTex.sample(fluidUv.add(offX)).rgb.length().sub(dyeTex.sample(fluidUv.sub(offX)).rgb.length()),
          dyeTex.sample(fluidUv.add(offY)).rgb.length().sub(dyeTex.sample(fluidUv.sub(offY)).rgb.length())
        );
        const ndir = grad.div(grad.length().add(1e-4));
        const lit = dot(ndir, vec2(-0.6, 0.8)).mul(0.5).add(0.5).clamp(0.2, 1);
        const shade = dyeAmp.pow(0.42).mul(lit);
        const tint2 = vibrant(cursorColor.mul(float(0.3).add(shade.mul(1.1))).clamp(0, 1), vibrance);
        const alpha = dyeAmp.mul(intensity).mul(2.2).clamp(0, 0.88);
        return composite(mix(scene, tint2, alpha));
      }
      if (this.style === "trail") {
        const tail = trailTail(vel);
        const head = density.pow(4);
        const glow = tail.mul(0.7).add(head.mul(1.4)).mul(intensity);
        return composite(scene.add(vibrant(cursorColor, vibrance).mul(glow)));
      }
      if (this.style === "oil") {
        let trail = density;
        for (let i = 1; i < 6; i += 1) {
          const offset = vel.mul(i * 0.035);
          trail = trail.add(densityTex.sample(fluidUv.sub(offset)).b.mul(1 - i / 7));
        }
        const glow = trail.mul(intensity).clamp(0, 1);
        const color = vibrant(
          oilPalette(glow.mul(0.62).add(speed.mul(0.015)).add(timeNode.mul(0.025)).fract()),
          vibrance
        );
        const alpha = glow.mul(0.58).add(speed.mul(0.012)).clamp(0, 0.86);
        const additive = scene.add(color.mul(alpha).mul(0.86));
        return composite(mix(additive, color, alpha.mul(0.14)));
      }
      if (this.style === "velocity") {
        const raw = velocitySample;
        const scaled = raw.mul(0.04).mul(intensity);
        const len = scaled.length().clamp(0, 1);
        const velocityColor = vec3(scaled.mul(1.5).add(0.1), 1);
        return composite(scene.add(velocityColor.mul(len)));
      }
      if (this.style === "colorful") {
        let glow = float(0);
        let color = vec3(0);
        for (let i = 0; i < 6; i += 1) {
          const origin = fluidUv.sub(vel.mul(i * 0.035));
          const d = densityTex.sample(origin).b;
          const w = d.mul(1 - i / 7);
          glow = glow.add(w);
          const hueA = origin.x.mul(1.6).add(origin.y.mul(0.9)).add(timeNode.mul(0.05));
          const hueB = origin.y.mul(1.2).sub(origin.x.mul(0.4)).sub(timeNode.mul(0.03));
          const a = hsv2rgb2(vec3(hueA.fract(), 0.9, 1));
          const b = hsv2rgb2(vec3(hueB.fract(), 0.85, 0.95));
          color = color.add(mix(a, b, 0.5).mul(w));
        }
        color = color.div(glow.max(1e-4));
        const amount = glow.mul(intensity).mul(0.55).clamp(0, 1.4);
        return composite(scene.add(vibrant(color, vibrance).mul(amount)));
      }
      if (this.style === "rainbowFish") {
        const fishVel = velocitySample.mul(0.04);
        const fishSpeed = fishVel.length();
        const angle = atan(fishVel.y, fishVel.x);
        const hueA = angle.div(TAU).add(0.5).add(timeNode.mul(0.05));
        const hueB = fluidUv.x.mul(1.2).add(fluidUv.y.mul(0.8)).add(timeNode.mul(0.04));
        const a = hsv2rgb2(vec3(hueA.fract(), 0.92, 1));
        const b = hsv2rgb2(vec3(hueB.fract(), 0.7, 0.95));
        const color = vibrant(mix(a, b, 0.35), vibrance);
        const s = fishSpeed.mul(8).clamp(0, 1);
        const strength = s.pow(2.5).mul(1.6).mul(intensity);
        return composite(scene.add(color.mul(strength)));
      }
      if (this.style === "glaze") {
        return composite(
          scene.add(
            vibrant(vec3(1, 0.45, 0.22), vibrance).mul(density).mul(intensity)
          )
        );
      }
      if (this.style === "burn") {
        let fingers = float(0);
        for (let i = 0; i < 5; i += 1) {
          const offset = vel.mul((i + 1) * 0.05);
          fingers = fingers.add(densityTex.sample(fluidUv.sub(offset)).b.mul(1 - i / 5));
        }
        fingers = fingers.mul(intensity);
        const burnColor = vec3(1, 0.3, 0);
        const emberColor = vec3(0.8, 0.15, 0);
        let fireColor = mix(emberColor, burnColor, fingers.clamp(0, 1));
        fireColor = fireColor.add(burnColor.mul(fingers.clamp(0, 1).pow(2)).mul(2));
        const smoke = fingers.mul(0.3);
        fireColor = fireColor.add(vec3(0.1, 0.1, 0.15).mul(smoke));
        const flicker = timeNode.mul(15).add(fingers.mul(20)).sin().mul(0.2).add(0.8);
        fireColor = fireColor.mul(flicker);
        const alpha = fingers.mul(0.5).mul(flicker).add(smoke.mul(0.2)).clamp(0, 0.85);
        return composite(mix(scene, vibrant(fireColor, vibrance), alpha));
      }
      if (this.style === "smoke") {
        const alpha = dyeAmp.mul(intensity).mul(2.6).clamp(0, 0.78);
        const smoke = vec3(0.9, 0.92, 0.94).mul(float(0.22).add(alpha.mul(0.9)));
        return composite(mix(scene, smoke, alpha));
      }
      if (this.style === "artInk") {
        const alpha = dyeAmp.mul(intensity).mul(2.2).clamp(0, 1);
        return composite(scene.add(vibrant(dyeHue, vibrance).mul(alpha).mul(1.55)));
      }
      if (this.style === "rainbowInk") {
        const phase = sceneUv.x.mul(0.45).add(sceneUv.y.mul(0.35)).add(dyeAmp.mul(0.2)).add(timeNode.mul(0.03));
        const tint2 = vibrant(mix(dyeHue, palette(phase), 0.45), vibrance);
        const alpha = dyeAmp.mul(intensity).mul(2.35).clamp(0, 1);
        return composite(scene.add(tint2.mul(alpha).mul(1.35)));
      }
      if (this.style === "colorWater") {
        const alpha = dyeAmp.mul(intensity).mul(2.1).clamp(0, 0.72);
        const wash = mix(scene, vibrant(dyeHue, vibrance), alpha);
        return composite(wash.add(scene.mul(dyeHue).mul(alpha).mul(0.35)));
      }
      const gate = dyeAmp.mul(4).clamp(0, 1);
      const distortedUv = sceneUv.add(vel.mul(gate).mul(0.012));
      const refracted = sceneTex.sample(distortedUv).rgb;
      const tint = vibrant(dyeHue, vibrance).mul(dyeAmp).mul(intensity).mul(1.4).clamp(0, 1.6);
      return composite(refracted.add(refracted.mul(tint)));
    });
    return apply();
  }
}
const fluidOverlay = (style, sceneNode, densityNode, dyeNode, velocityNode, options = {}) => nodeObject(
  new FluidOverlayNode(
    style,
    convertToTexture(sceneNode),
    convertToTexture(densityNode),
    convertToTexture(dyeNode),
    convertToTexture(velocityNode),
    {
      intensity: toNode(options.intensity, float(1)),
      time: toNode(options.time, float(0)),
      texel: toNode(options.texel, vec2(1 / 512, 1 / 512)),
      cursorColor: toNode(options.cursorColor, vec3(0.85, 0.95, 1)),
      vibrance: toNode(options.vibrance, float(0)),
      velocityScale: toNode(options.velocityScale, float(1)),
      opacity: toNode(options.opacity, float(1))
    }
  )
);
const styleWrapper = (style) => (sceneNode, densityNode, dyeNode, velocityNode, options = {}) => fluidOverlay(style, sceneNode, densityNode, dyeNode, velocityNode, options);
const defaultOverlay = styleWrapper("default");
const volumeCursorOverlay = styleWrapper("volumeCursor");
const trailOverlay = styleWrapper("trail");
const oilOverlay = styleWrapper("oil");
const velocityOverlay = styleWrapper("velocity");
const colorfulOverlay = styleWrapper("colorful");
const rainbowFishOverlay = styleWrapper("rainbowFish");
const glazeOverlay = styleWrapper("glaze");
const burnOverlay = styleWrapper("burn");
const smokeOverlay = styleWrapper("smoke");
const artInkOverlay = styleWrapper("artInk");
const rainbowInkOverlay = styleWrapper("rainbowInk");
const colorWaterOverlay = styleWrapper("colorWater");
const liquidLensOverlay = styleWrapper("liquidLens");
export {
  ChromaticDistortionNode,
  DensityTintOverlayNode,
  FLUID_PROFILES,
  FluidOverlayNode,
  WGSLFluidSimulation as FluidSimulation,
  RGBShiftDistortionNode,
  SimpleDistortionNode,
  WGSLFluidSimulation,
  WaterCausticsDistortionNode,
  WaterDistortionNode,
  artInkOverlay,
  attachPointerSplats,
  burnOverlay,
  chromaticDistortion,
  colorWaterOverlay,
  colorfulOverlay,
  defaultOverlay,
  densityTintOverlay,
  fluidOverlay,
  glazeOverlay,
  liquidLensOverlay,
  oilOverlay,
  rainbowFishOverlay,
  rainbowInkOverlay,
  rgbShiftDistortion,
  simpleDistortion,
  smokeOverlay,
  trailOverlay,
  velocityOverlay,
  volumeCursorOverlay,
  waterCausticsDistortion,
  waterDistortion
};
//# sourceMappingURL=three-fluid-fx.es.js.map
