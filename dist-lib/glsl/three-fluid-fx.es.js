import { Scene, OrthographicCamera, BufferGeometry, Float32BufferAttribute, Mesh, Uint16BufferAttribute, Vector2, ShaderMaterial, OneFactor, AddEquation, CustomBlending, Vector3, WebGLRenderTarget, ClampToEdgeWrapping, LinearFilter, NearestFilter, HalfFloatType, RGBAFormat, UnsignedByteType, SRGBColorSpace, Uniform, Color } from "three";
const SIM_VERTEX = (
  /* glsl */
  `
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform vec2 texelSize;

void main() {
  vUv = position.xy * 0.5 + 0.5;
  vL = vUv - vec2(texelSize.x, 0.0);
  vR = vUv + vec2(texelSize.x, 0.0);
  vT = vUv + vec2(0.0, texelSize.y);
  vB = vUv - vec2(0.0, texelSize.y);
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`
);
const CLEAR_FRAGMENT = (
  /* glsl */
  `
precision mediump float;
varying highp vec2 vUv;
uniform sampler2D uTexture;
uniform float value;

void main() {
  gl_FragColor = value * texture2D(uTexture, vUv);
}
`
);
const SPLAT_VERTEX = (
  /* glsl */
  `
varying vec2 vLocalUv;
uniform vec2 uCenter;
uniform vec2 uScale;

void main() {
  vLocalUv = position.xy;
  gl_Position = vec4(position.xy * uScale + uCenter, 0.0, 1.0);
}
`
);
const SPLAT_FRAGMENT = (
  /* glsl */
  `
precision highp float;
varying vec2 vLocalUv;
uniform vec3 color;

void main() {
  float r = length(vLocalUv);
  if (r > 1.0) discard;
  float a = 1.0 - r;
  a *= a;
  gl_FragColor = vec4(color * a, a);
}
`
);
const CURL_FRAGMENT = (
  /* glsl */
  `
precision mediump float;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;
uniform sampler2D uVelocity;

void main() {
  float L = texture2D(uVelocity, vL).y;
  float R = texture2D(uVelocity, vR).y;
  float T = texture2D(uVelocity, vT).x;
  float B = texture2D(uVelocity, vB).x;
  float vorticity = R - L - T + B;
  gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
}
`
);
const VORTICITY_FRAGMENT = (
  /* glsl */
  `
precision highp float;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float curl;
uniform float dt;

void main() {
  float L = texture2D(uCurl, vL).x;
  float R = texture2D(uCurl, vR).x;
  float T = texture2D(uCurl, vT).x;
  float B = texture2D(uCurl, vB).x;
  float C = texture2D(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 0.0001;
  force *= curl * C;
  force.y *= -1.0;
  vec2 vel = texture2D(uVelocity, vUv).xy;
  gl_FragColor = vec4(vel + force * dt, 0.0, 1.0);
}
`
);
const DIVERGENCE_FRAGMENT = (
  /* glsl */
  `
precision mediump float;
varying highp vec2 vUv;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;
uniform sampler2D uVelocity;
uniform float uReflectWalls;

void main() {
  float L = texture2D(uVelocity, vL).x;
  float R = texture2D(uVelocity, vR).x;
  float T = texture2D(uVelocity, vT).y;
  float B = texture2D(uVelocity, vB).y;
  vec2 C = texture2D(uVelocity, vUv).xy;
  // No-flow-through-walls (reflection): mirror the velocity at boundaries.
  // Disable to let flow leave the screen — mofu / FluidCursor behaviour.
  if (uReflectWalls > 0.5) {
    if (vL.x < 0.0) { L = -C.x; }
    if (vR.x > 1.0) { R = -C.x; }
    if (vT.y > 1.0) { T = -C.y; }
    if (vB.y < 0.0) { B = -C.y; }
  }
  float div = 0.5 * (R - L + T - B);
  gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
}
`
);
const PRESSURE_FRAGMENT = (
  /* glsl */
  `
precision mediump float;
varying highp vec2 vUv;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;

void main() {
  float L = texture2D(uPressure, vL).x;
  float R = texture2D(uPressure, vR).x;
  float T = texture2D(uPressure, vT).x;
  float B = texture2D(uPressure, vB).x;
  float divergence = texture2D(uDivergence, vUv).x;
  float pressure = (L + R + B + T - divergence) * 0.25;
  gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
}
`
);
const GRADIENT_SUBTRACT_FRAGMENT = (
  /* glsl */
  `
precision mediump float;
varying highp vec2 vUv;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uVelocity;

void main() {
  float L = texture2D(uPressure, vL).x;
  float R = texture2D(uPressure, vR).x;
  float T = texture2D(uPressure, vT).x;
  float B = texture2D(uPressure, vB).x;
  vec2 velocity = texture2D(uVelocity, vUv).xy;
  velocity.xy -= vec2(R - L, T - B);
  gl_FragColor = vec4(velocity, 0.0, 1.0);
}
`
);
const ADVECT_FRAGMENT = (
  /* glsl */
  `
precision highp float;
varying vec2 vUv;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 texelSize;
uniform float dt;
uniform float dissipation;
uniform float uBFECC;

void main() {
  if (uBFECC < 0.5) {
    vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
    gl_FragColor = dissipation * texture2D(uSource, coord);
  } else {
    vec2 vel = texture2D(uVelocity, vUv).xy;
    vec2 spotOld = vUv - vel * dt * texelSize;
    vec2 velBack = texture2D(uVelocity, spotOld).xy;
    vec2 spotForward = spotOld + velBack * dt * texelSize;
    vec2 error = spotForward - vUv;
    vec2 spotMid = vUv - error * 0.5;
    vec2 velMid = texture2D(uVelocity, spotMid).xy;
    vec2 coord = spotMid - velMid * dt * texelSize;
    gl_FragColor = dissipation * texture2D(uSource, coord);
  }
  gl_FragColor.a = 1.0;
}
`
);
const FLUID_PROFILES = {
  performance: { simResolution: 128, dyeResolution: 256, pressureIterations: 6 },
  balanced: { simResolution: 256, dyeResolution: 512, pressureIterations: 12 },
  quality: { simResolution: 384, dyeResolution: 1024, pressureIterations: 20 }
};
function makeTarget(width, height, linear) {
  const filter = linear ? LinearFilter : NearestFilter;
  return new WebGLRenderTarget(width, height, {
    depthBuffer: false,
    stencilBuffer: false,
    format: RGBAFormat,
    type: HalfFloatType,
    minFilter: filter,
    magFilter: filter,
    wrapS: ClampToEdgeWrapping,
    wrapT: ClampToEdgeWrapping,
    generateMipmaps: false
  });
}
function makeDoubleFBO(width, height, linear) {
  return {
    read: makeTarget(width, height, linear),
    write: makeTarget(width, height, linear)
  };
}
function swap(target) {
  const read = target.read;
  target.read = target.write;
  target.write = read;
}
function disposeDouble(target) {
  target.read.dispose();
  target.write.dispose();
}
class FluidSimulation {
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
  renderer;
  scene = new Scene();
  camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  geometry = new BufferGeometry();
  mesh;
  splatScene = new Scene();
  splatGeometry = new BufferGeometry();
  splatMesh;
  velocity;
  density;
  dye;
  pressure;
  divergence;
  curl;
  /**
   * Toggle the optional dye channel — a separate RGB FBO advected by velocity.
   * Off by default to keep ordinary examples free of the extra advect pass.
   * Turn on when using `addSplat({ dyeColor })` and `dyeTexture`.
   */
  enableDye = false;
  /** Per-step decay of the dye FBO. Mirrors `densityDissipation` semantics. */
  dyeDissipation;
  clearMaterial;
  splatMaterial;
  curlMaterial;
  vorticityMaterial;
  divergenceMaterial;
  pressureMaterial;
  gradientSubtractMaterial;
  advectVelocityMaterial;
  advectDensityMaterial;
  advectDyeMaterial;
  splats = [];
  viewportWidth = 1;
  viewportHeight = 1;
  // FBO dimensions adapt to viewport aspect on resize so the velocity field
  // is stored in screen-aligned cells. Otherwise a square FBO stretched onto
  // a wide viewport gives non-uniform metric — vec2(dx, dy) sampled as colour
  // would visually rotate/skew.
  simWidth;
  simHeight;
  dyeWidth;
  dyeHeight;
  constructor(renderer, options = {}) {
    this.renderer = renderer;
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
    this.geometry.setAttribute(
      "position",
      new Float32BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3)
    );
    this.mesh = new Mesh(this.geometry, void 0);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.splatGeometry.setAttribute(
      "position",
      new Float32BufferAttribute(
        new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]),
        3
      )
    );
    this.splatGeometry.setIndex(new Uint16BufferAttribute(new Uint16Array([0, 1, 2, 1, 3, 2]), 1));
    this.splatMesh = new Mesh(this.splatGeometry, void 0);
    this.splatMesh.frustumCulled = false;
    this.splatScene.add(this.splatMesh);
    this.simWidth = this.simResolution;
    this.simHeight = this.simResolution;
    this.dyeWidth = this.dyeResolution;
    this.dyeHeight = this.dyeResolution;
    this.velocity = makeDoubleFBO(this.simWidth, this.simHeight, true);
    this.density = makeDoubleFBO(this.dyeWidth, this.dyeHeight, true);
    this.dye = makeDoubleFBO(this.dyeWidth, this.dyeHeight, true);
    this.pressure = makeDoubleFBO(this.simWidth, this.simHeight, false);
    this.dyeDissipation = options.dyeDissipation ?? this.densityDissipation;
    this.divergence = makeTarget(this.simWidth, this.simHeight, false);
    this.curl = makeTarget(this.simWidth, this.simHeight, false);
    const simTexel = new Vector2(1 / this.simWidth, 1 / this.simHeight);
    const dyeTexel = new Vector2(1 / this.dyeWidth, 1 / this.dyeHeight);
    this.clearMaterial = this.createMaterial(CLEAR_FRAGMENT, {
      texelSize: { value: simTexel.clone() },
      uTexture: { value: null },
      value: { value: this.pressureDissipation }
    });
    this.splatMaterial = new ShaderMaterial({
      vertexShader: SPLAT_VERTEX,
      fragmentShader: SPLAT_FRAGMENT,
      uniforms: {
        uCenter: { value: new Vector2() },
        uScale: { value: new Vector2() },
        color: { value: new Vector3() }
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      transparent: true,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: OneFactor,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: OneFactor
    });
    this.splatMesh.material = this.splatMaterial;
    this.curlMaterial = this.createMaterial(CURL_FRAGMENT, {
      texelSize: { value: simTexel.clone() },
      uVelocity: { value: null }
    });
    this.vorticityMaterial = this.createMaterial(VORTICITY_FRAGMENT, {
      texelSize: { value: simTexel.clone() },
      uVelocity: { value: null },
      uCurl: { value: null },
      curl: { value: this.curlStrength },
      dt: { value: 0.016 }
    });
    this.divergenceMaterial = this.createMaterial(DIVERGENCE_FRAGMENT, {
      texelSize: { value: simTexel.clone() },
      uVelocity: { value: null },
      uReflectWalls: { value: 1 }
    });
    this.pressureMaterial = this.createMaterial(PRESSURE_FRAGMENT, {
      texelSize: { value: simTexel.clone() },
      uPressure: { value: null },
      uDivergence: { value: null }
    });
    this.gradientSubtractMaterial = this.createMaterial(GRADIENT_SUBTRACT_FRAGMENT, {
      texelSize: { value: simTexel.clone() },
      uPressure: { value: null },
      uVelocity: { value: null }
    });
    this.advectVelocityMaterial = this.createMaterial(ADVECT_FRAGMENT, {
      texelSize: { value: simTexel.clone() },
      uVelocity: { value: null },
      uSource: { value: null },
      dt: { value: 0.016 },
      dissipation: { value: 1 },
      uBFECC: { value: 0 }
    });
    this.advectDensityMaterial = this.createMaterial(ADVECT_FRAGMENT, {
      texelSize: { value: dyeTexel.clone() },
      uVelocity: { value: null },
      uSource: { value: null },
      dt: { value: 0.016 },
      dissipation: { value: 1 },
      uBFECC: { value: 0 }
    });
    this.advectDyeMaterial = this.createMaterial(ADVECT_FRAGMENT, {
      texelSize: { value: dyeTexel.clone() },
      uVelocity: { value: null },
      uSource: { value: null },
      dt: { value: 0.016 },
      dissipation: { value: 1 },
      uBFECC: { value: 0 }
    });
  }
  /**
   * Velocity field after the full step (post-advection). This is the value
   * that drives subsequent simulation; use it for particle systems and any
   * downstream physics.
   */
  get velocityTexture() {
    return this.velocity.read.texture;
  }
  /**
   * Velocity field after pressure projection but **before self-advection** —
   * the divergence-free snapshot. This is what FluidCursor / mofu's color.frag
   * reads as `vel_0`. Use for visualisation when you want a "cleaner" field
   * (less self-mixing, sharper edges).
   *
   * Internally this is `velocity.write.texture` after step(): the velocity
   * pipeline has three ping-pong swaps (vorticity → grad-subtract → advect),
   * which leaves the pre-advect snapshot in the write buffer at the end.
   */
  get velocityProjectedTexture() {
    return this.velocity.write.texture;
  }
  get densityTexture() {
    return this.density.read.texture;
  }
  /**
   * Advected per-stroke dye field. RGB stores the colour written by splats
   * with `dyeColor`. Only updated when `enableDye` is on.
   */
  get dyeTexture() {
    return this.dye.read.texture;
  }
  resize(width, height) {
    this.viewportWidth = Math.max(1, width);
    this.viewportHeight = Math.max(1, height);
    const aspect = this.viewportWidth / this.viewportHeight;
    let newSimW;
    let newSimH;
    let newDyeW;
    let newDyeH;
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
    if (newSimW !== this.simWidth || newSimH !== this.simHeight) {
      this.simWidth = newSimW;
      this.simHeight = newSimH;
      this.velocity.read.setSize(newSimW, newSimH);
      this.velocity.write.setSize(newSimW, newSimH);
      this.pressure.read.setSize(newSimW, newSimH);
      this.pressure.write.setSize(newSimW, newSimH);
      this.divergence.setSize(newSimW, newSimH);
      this.curl.setSize(newSimW, newSimH);
      const tx = 1 / newSimW;
      const ty = 1 / newSimH;
      this.clearMaterial.uniforms.texelSize.value.set(tx, ty);
      this.curlMaterial.uniforms.texelSize.value.set(tx, ty);
      this.vorticityMaterial.uniforms.texelSize.value.set(tx, ty);
      this.divergenceMaterial.uniforms.texelSize.value.set(tx, ty);
      this.pressureMaterial.uniforms.texelSize.value.set(tx, ty);
      this.gradientSubtractMaterial.uniforms.texelSize.value.set(tx, ty);
      this.advectVelocityMaterial.uniforms.texelSize.value.set(tx, ty);
    }
    if (newDyeW !== this.dyeWidth || newDyeH !== this.dyeHeight) {
      this.dyeWidth = newDyeW;
      this.dyeHeight = newDyeH;
      this.density.read.setSize(newDyeW, newDyeH);
      this.density.write.setSize(newDyeW, newDyeH);
      this.dye.read.setSize(newDyeW, newDyeH);
      this.dye.write.setSize(newDyeW, newDyeH);
      const tx = 1 / newDyeW;
      const ty = 1 / newDyeH;
      this.advectDensityMaterial.uniforms.texelSize.value.set(tx, ty);
      this.advectDyeMaterial.uniforms.texelSize.value.set(tx, ty);
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
    const previousTarget = this.renderer.getRenderTarget();
    const previousAutoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    this.vorticityMaterial.uniforms.curl.value = this.curlStrength;
    const bfecc = this.bfecc ? 1 : 0;
    this.advectVelocityMaterial.uniforms.uBFECC.value = bfecc;
    this.advectDensityMaterial.uniforms.uBFECC.value = bfecc;
    for (let i = 0; i < this.splats.length; i += 1) {
      this.applySplat(this.splats[i]);
    }
    this.splats.length = 0;
    if (this.enableVorticity) {
      this.curlMaterial.uniforms.uVelocity.value = this.velocity.read.texture;
      this.blit(this.curl, this.curlMaterial);
      this.vorticityMaterial.uniforms.uVelocity.value = this.velocity.read.texture;
      this.vorticityMaterial.uniforms.uCurl.value = this.curl.texture;
      this.vorticityMaterial.uniforms.dt.value = dt;
      this.blit(this.velocity.write, this.vorticityMaterial);
      swap(this.velocity);
    }
    this.divergenceMaterial.uniforms.uVelocity.value = this.velocity.read.texture;
    this.divergenceMaterial.uniforms.uReflectWalls.value = this.reflectWalls ? 1 : 0;
    this.blit(this.divergence, this.divergenceMaterial);
    this.clearMaterial.uniforms.uTexture.value = this.pressure.read.texture;
    this.clearMaterial.uniforms.value.value = Math.pow(this.pressureDissipation, dtScale);
    this.blit(this.pressure.write, this.clearMaterial);
    swap(this.pressure);
    this.pressureMaterial.uniforms.uDivergence.value = this.divergence.texture;
    for (let i = 0; i < this.pressureIterations; i += 1) {
      this.pressureMaterial.uniforms.uPressure.value = this.pressure.read.texture;
      this.blit(this.pressure.write, this.pressureMaterial);
      swap(this.pressure);
    }
    this.gradientSubtractMaterial.uniforms.uPressure.value = this.pressure.read.texture;
    this.gradientSubtractMaterial.uniforms.uVelocity.value = this.velocity.read.texture;
    this.blit(this.velocity.write, this.gradientSubtractMaterial);
    swap(this.velocity);
    this.advectVelocityMaterial.uniforms.uVelocity.value = this.velocity.read.texture;
    this.advectVelocityMaterial.uniforms.uSource.value = this.velocity.read.texture;
    this.advectVelocityMaterial.uniforms.dissipation.value = Math.pow(this.velocityDissipation, dtScale);
    this.advectVelocityMaterial.uniforms.dt.value = dt;
    this.blit(this.velocity.write, this.advectVelocityMaterial);
    swap(this.velocity);
    this.advectDensityMaterial.uniforms.uVelocity.value = this.velocity.read.texture;
    this.advectDensityMaterial.uniforms.uSource.value = this.density.read.texture;
    this.advectDensityMaterial.uniforms.dissipation.value = Math.pow(this.densityDissipation, dtScale);
    this.advectDensityMaterial.uniforms.dt.value = dt;
    this.blit(this.density.write, this.advectDensityMaterial);
    swap(this.density);
    if (this.enableDye) {
      this.advectDyeMaterial.uniforms.uBFECC.value = bfecc;
      this.advectDyeMaterial.uniforms.uVelocity.value = this.velocity.read.texture;
      this.advectDyeMaterial.uniforms.uSource.value = this.dye.read.texture;
      this.advectDyeMaterial.uniforms.dissipation.value = Math.pow(this.dyeDissipation, dtScale);
      this.advectDyeMaterial.uniforms.dt.value = dt;
      this.blit(this.dye.write, this.advectDyeMaterial);
      swap(this.dye);
    }
    this.renderer.setRenderTarget(previousTarget);
    this.renderer.autoClear = previousAutoClear;
  }
  dispose() {
    this.scene.remove(this.mesh);
    this.splatScene.remove(this.splatMesh);
    this.geometry.dispose();
    this.splatGeometry.dispose();
    this.clearMaterial.dispose();
    this.splatMaterial.dispose();
    this.curlMaterial.dispose();
    this.vorticityMaterial.dispose();
    this.divergenceMaterial.dispose();
    this.pressureMaterial.dispose();
    this.gradientSubtractMaterial.dispose();
    this.advectVelocityMaterial.dispose();
    this.advectDensityMaterial.dispose();
    this.advectDyeMaterial.dispose();
    disposeDouble(this.velocity);
    disposeDouble(this.density);
    disposeDouble(this.dye);
    disposeDouble(this.pressure);
    this.divergence.dispose();
    this.curl.dispose();
  }
  createMaterial(fragmentShader, uniforms) {
    return new ShaderMaterial({
      vertexShader: SIM_VERTEX,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    });
  }
  blit(target, material) {
    this.mesh.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
  }
  applySplat(splat) {
    const aspect = this.viewportWidth / this.viewportHeight;
    const color = splat.color ?? [splat.dx, splat.dy, 1];
    const halfSize = 3 * Math.sqrt(splat.radius);
    const u = this.splatMaterial.uniforms;
    u.uCenter.value.set(splat.x * 2 - 1, splat.y * 2 - 1);
    u.uScale.value.set(halfSize / aspect, halfSize);
    u.color.value.set(color[0], color[1], color[2]);
    this.renderer.setRenderTarget(this.velocity.read);
    this.renderer.render(this.splatScene, this.camera);
    this.renderer.setRenderTarget(this.density.read);
    this.renderer.render(this.splatScene, this.camera);
    if (this.enableDye && splat.dyeColor) {
      u.color.value.set(splat.dyeColor[0], splat.dyeColor[1], splat.dyeColor[2]);
      this.renderer.setRenderTarget(this.dye.read);
      this.renderer.render(this.splatScene, this.camera);
    }
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
const FULLSCREEN_VERTEX = (
  /* glsl */
  `
varying vec2 vUv;

void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`
);
class FullscreenPass {
  constructor(material) {
    this.material = material;
    this.geometry.setAttribute(
      "position",
      new Float32BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3)
    );
    this.mesh = new Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }
  material;
  scene = new Scene();
  camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  geometry = new BufferGeometry();
  mesh;
  render(renderer, target = null) {
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
  }
  dispose() {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
function createSceneTarget(width, height) {
  const target = new WebGLRenderTarget(width, height, {
    depthBuffer: true,
    stencilBuffer: false,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    wrapS: ClampToEdgeWrapping,
    wrapT: ClampToEdgeWrapping,
    type: UnsignedByteType,
    format: RGBAFormat,
    generateMipmaps: false,
    samples: 4
  });
  target.texture.colorSpace = SRGBColorSpace;
  return target;
}
class Pass {
  /**
   * Constructs a new pass.
   */
  constructor() {
    this.isPass = true;
    this.enabled = true;
    this.needsSwap = true;
    this.clear = false;
    this.renderToScreen = false;
  }
  /**
   * Sets the size of the pass.
   *
   * @abstract
   * @param {number} width - The width to set.
   * @param {number} height - The height to set.
   */
  setSize() {
  }
  /**
   * This method holds the render logic of a pass. It must be implemented in all derived classes.
   *
   * @abstract
   * @param {WebGLRenderer} renderer - The renderer.
   * @param {WebGLRenderTarget} writeBuffer - The write buffer. This buffer is intended as the rendering
   * destination for the pass.
   * @param {WebGLRenderTarget} readBuffer - The read buffer. The pass can access the result from the
   * previous pass from this buffer.
   * @param {number} deltaTime - The delta time in seconds.
   * @param {boolean} maskActive - Whether masking is active or not.
   */
  render() {
    console.error("THREE.Pass: .render() must be implemented in derived pass.");
  }
  /**
   * Frees the GPU-related resources allocated by this instance. Call this
   * method whenever the pass is no longer used in your app.
   *
   * @abstract
   */
  dispose() {
  }
}
const _camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
class FullscreenTriangleGeometry extends BufferGeometry {
  constructor() {
    super();
    this.setAttribute("position", new Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
    this.setAttribute("uv", new Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
  }
}
const _geometry = new FullscreenTriangleGeometry();
class FullScreenQuad {
  /**
   * Constructs a new full screen quad.
   *
   * @param {?Material} material - The material to render te full screen quad with.
   */
  constructor(material) {
    this._mesh = new Mesh(_geometry, material);
  }
  /**
   * Frees the GPU-related resources allocated by this instance. Call this
   * method whenever the instance is no longer used in your app.
   */
  dispose() {
    this._mesh.geometry.dispose();
  }
  /**
   * Renders the full screen quad.
   *
   * @param {WebGLRenderer} renderer - The renderer.
   */
  render(renderer) {
    renderer.render(this._mesh, _camera);
  }
  /**
   * The quad's material.
   *
   * @type {?Material}
   */
  get material() {
    return this._mesh.material;
  }
  set material(value) {
    this._mesh.material = value;
  }
}
const VERTEX = (
  /* glsl */
  `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
);
const OPACITY_FRAGMENT = (
  /* glsl */
  `
varying vec2 vUv;
uniform sampler2D tBase;
uniform sampler2D tOverlay;
uniform float uOpacity;

void main() {
  vec4 base = texture2D(tBase, vUv);
  vec4 overlay = texture2D(tOverlay, vUv);
  gl_FragColor = mix(base, overlay, clamp(uOpacity, 0.0, 1.0));
}
`
);
class FluidEffectPass extends Pass {
  /**
   * Final visibility of this pass over its input. Unlike per-effect
   * `intensity`, this is a pure post-composite alpha: 0 returns the original
   * input, 1 returns the effect output unchanged.
   */
  opacity = 1;
  /** The pass's shader material — uniforms exposed for direct tweaking
   *  (animations, tooling) without subclassing. Read-only reference; the
   *  uniforms inside it are the actual mutable state. */
  material;
  fsQuad;
  opacityMaterial;
  opacityQuad;
  opacityTarget;
  /**
   * @param fragmentShader GLSL fragment-shader source. Reads `tDiffuse`
   *   (input from previous pass) and any custom uniforms.
   * @param uniforms       Uniform records used by the fragment shader.
   * @param options        Material flags. `toneMapped` defaults to `false`
   *   (tone mapping is expected to happen in the chain's final `OutputPass`,
   *   not per-effect).
   */
  constructor(fragmentShader, uniforms, options = {}) {
    super();
    this.needsSwap = true;
    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
      toneMapped: options.toneMapped ?? false
    });
    this.fsQuad = new FullScreenQuad(this.material);
    this.opacityMaterial = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: OPACITY_FRAGMENT,
      uniforms: {
        tBase: new Uniform(null),
        tOverlay: new Uniform(null),
        uOpacity: new Uniform(1)
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: options.toneMapped ?? false
    });
    this.opacityQuad = new FullScreenQuad(this.opacityMaterial);
    this.opacityTarget = new WebGLRenderTarget(1, 1, {
      depthBuffer: false,
      stencilBuffer: false
    });
  }
  /** Override to react to viewport changes — typically updates `uTexel`. */
  setSize(_width, _height) {
  }
  render(renderer, writeBuffer, readBuffer, _deltaTime, _maskActive) {
    this.updateUniforms(readBuffer);
    const target = this.renderToScreen ? null : writeBuffer;
    if (this.opacity >= 0.999) {
      renderer.setRenderTarget(target);
      if (this.clear) renderer.clear();
      this.fsQuad.render(renderer);
      return;
    }
    if (this.opacityTarget.width !== readBuffer.width || this.opacityTarget.height !== readBuffer.height) {
      this.opacityTarget.setSize(readBuffer.width, readBuffer.height);
    }
    renderer.setRenderTarget(this.opacityTarget);
    renderer.clear();
    this.fsQuad.render(renderer);
    const u = this.opacityMaterial.uniforms;
    u.tBase.value = readBuffer.texture;
    u.tOverlay.value = this.opacityTarget.texture;
    u.uOpacity.value = Math.max(0, Math.min(this.opacity, 1));
    renderer.setRenderTarget(target);
    if (this.clear) renderer.clear();
    this.opacityQuad.render(renderer);
  }
  dispose() {
    this.material.dispose();
    this.fsQuad.dispose();
    this.opacityMaterial.dispose();
    this.opacityQuad.dispose();
    this.opacityTarget.dispose();
  }
}
const FRAGMENT$j = (
  /* glsl */
  `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tFluid;
uniform float uIntensity;

void main() {
  vec3 fluid = texture2D(tFluid, vUv).rgb;
  vec2 vel = fluid.rg;
  vec2 uv = vUv - vel * uIntensity * 0.0003;
  uv = clamp(uv, 0.0, 1.0);
  gl_FragColor = texture2D(tDiffuse, uv);
}
`
);
class SimpleDistortionPass extends FluidEffectPass {
  constructor(fluid) {
    super(FRAGMENT$j, {
      tDiffuse: new Uniform(null),
      tFluid: new Uniform(null),
      uIntensity: new Uniform(1)
    });
    this.fluid = fluid;
  }
  fluid;
  intensity = 1;
  updateUniforms(readBuffer) {
    this.material.uniforms.tDiffuse.value = readBuffer.texture;
    this.material.uniforms.tFluid.value = this.fluid.densityTexture;
    this.material.uniforms.uIntensity.value = this.intensity;
  }
}
const FRAGMENT$i = (
  /* glsl */
  `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tFluid;
uniform float uIntensity;

void main() {
  vec3 fluid = texture2D(tFluid, vUv).rgb;
  float density = clamp(fluid.b, 0.0, 1.0);
  vec2 vel = fluid.rg;

  float speed = max(length(vel), 1e-4);
  vec2 dir = vel / speed;
  float strength = pow(density, 1.4) * uIntensity * 0.012;
  vec2 shift = dir * strength;

  float r = texture2D(tDiffuse, vUv + shift).r;
  float g = texture2D(tDiffuse, vUv).g;
  float b = texture2D(tDiffuse, vUv - shift).b;

  gl_FragColor = vec4(r, g, b, 1.0);
}
`
);
class RGBShiftDistortionPass extends FluidEffectPass {
  constructor(fluid) {
    super(FRAGMENT$i, {
      tDiffuse: new Uniform(null),
      tFluid: new Uniform(null),
      uIntensity: new Uniform(1)
    });
    this.fluid = fluid;
  }
  fluid;
  intensity = 1;
  updateUniforms(readBuffer) {
    this.material.uniforms.tDiffuse.value = readBuffer.texture;
    this.material.uniforms.tFluid.value = this.fluid.densityTexture;
    this.material.uniforms.uIntensity.value = this.intensity;
  }
}
const FRAGMENT$h = (
  /* glsl */
  `
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
);
class ChromaticDistortionPass extends FluidEffectPass {
  constructor(fluid) {
    super(FRAGMENT$h, {
      tDiffuse: new Uniform(null),
      tFluid: new Uniform(null),
      uIntensity: new Uniform(1),
      uTexel: new Uniform(new Vector2(1 / 512, 1 / 512))
    });
    this.fluid = fluid;
  }
  fluid;
  intensity = 1;
  updateUniforms(readBuffer) {
    this.material.uniforms.tDiffuse.value = readBuffer.texture;
    this.material.uniforms.tFluid.value = this.fluid.densityTexture;
    this.material.uniforms.uIntensity.value = this.intensity;
    const img = this.fluid.densityTexture.image;
    this.material.uniforms.uTexel.value.set(1 / img.width, 1 / img.height);
  }
}
const FRAGMENT$g = (
  /* glsl */
  `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tFluid;
uniform float uIntensity;
uniform vec2 uTexel;

void main() {
  float hL = texture2D(tFluid, vUv - vec2(uTexel.x * 2.0, 0.0)).b;
  float hR = texture2D(tFluid, vUv + vec2(uTexel.x * 2.0, 0.0)).b;
  float hD = texture2D(tFluid, vUv - vec2(0.0, uTexel.y * 2.0)).b;
  float hU = texture2D(tFluid, vUv + vec2(0.0, uTexel.y * 2.0)).b;
  vec2 normal = vec2(hR - hL, hU - hD);

  vec2 offset = normal * uIntensity * 0.6;
  float r = texture2D(tDiffuse, vUv + offset * 0.95).r;
  float g = texture2D(tDiffuse, vUv + offset).g;
  float b = texture2D(tDiffuse, vUv + offset * 1.05).b;

  gl_FragColor = vec4(r, g, b, 1.0);
}
`
);
class WaterDistortionPass extends FluidEffectPass {
  constructor(fluid) {
    super(FRAGMENT$g, {
      tDiffuse: new Uniform(null),
      tFluid: new Uniform(null),
      uIntensity: new Uniform(1),
      uTexel: new Uniform(new Vector2(1 / 512, 1 / 512))
    });
    this.fluid = fluid;
  }
  fluid;
  intensity = 1;
  updateUniforms(readBuffer) {
    this.material.uniforms.tDiffuse.value = readBuffer.texture;
    this.material.uniforms.tFluid.value = this.fluid.densityTexture;
    this.material.uniforms.uIntensity.value = this.intensity;
    const img = this.fluid.densityTexture.image;
    this.material.uniforms.uTexel.value.set(1 / img.width, 1 / img.height);
  }
}
const FRAGMENT$f = (
  /* glsl */
  `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tFluid;
uniform float uIntensity;
uniform float uTime;
uniform vec2 uTexel;

float causticWeb(vec2 uv, float t) {
  // The formula degenerates near p = 0 (1/length blows up); the canonical
  // Shadertoy version offsets by a large constant to keep p far from origin.
  const float TAU = 6.28318530718;
  vec2 p = mod(uv * TAU, TAU) - 250.0;
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 5; n++) {
    float tt = t * (1.0 - 3.5 / float(n + 1));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y),
                 sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(
      p.x / (sin(i.x + tt) / inten),
      p.y / (cos(i.y + tt) / inten)
    ));
  }
  c /= 5.0;
  c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 8.0), 0.0, 1.0);
}

void main() {
  vec3 fluid = texture2D(tFluid, vUv).rgb;
  float hC = fluid.b;
  vec2 vel = fluid.rg;

  float hL = texture2D(tFluid, vUv - vec2(uTexel.x * 2.0, 0.0)).b;
  float hR = texture2D(tFluid, vUv + vec2(uTexel.x * 2.0, 0.0)).b;
  float hD = texture2D(tFluid, vUv - vec2(0.0, uTexel.y * 2.0)).b;
  float hU = texture2D(tFluid, vUv + vec2(0.0, uTexel.y * 2.0)).b;
  vec2 normal = vec2(hR - hL, hU - hD);

  vec2 offset = normal * uIntensity * 0.6;
  float r = texture2D(tDiffuse, vUv + offset * 0.95).r;
  float g = texture2D(tDiffuse, vUv + offset).g;
  float b = texture2D(tDiffuse, vUv + offset * 1.05).b;

  // Evaluate the Hoskins/joltz0r field as a small tileable light texture.
  // The fluid only gates/disturbs the light; it should not draw the caustic.
  float surface = smoothstep(0.015, 0.16, hC);
  float slope = smoothstep(0.0015, 0.04, length(normal));
  vec2 cuv = vUv * 4.0 + vel * 0.0012;
  float web = causticWeb(cuv, uTime * 0.5 + 23.0);
  vec3 caustic = clamp(vec3(web) + vec3(0.0, 0.35, 0.5), 0.0, 1.0);
  float energy = pow(web, 1.25) * surface * mix(0.4, 1.0, slope);

  vec3 color = vec3(r, g, b) + caustic * energy * uIntensity * 0.38;
  gl_FragColor = vec4(color, 1.0);
}
`
);
class WaterCausticsDistortionPass extends FluidEffectPass {
  constructor(fluid) {
    super(FRAGMENT$f, {
      tDiffuse: new Uniform(null),
      tFluid: new Uniform(null),
      uIntensity: new Uniform(1),
      uTime: new Uniform(0),
      uTexel: new Uniform(new Vector2(1 / 512, 1 / 512))
    });
    this.fluid = fluid;
  }
  fluid;
  intensity = 1;
  /** Animation time, in seconds. The caustic web evolves continuously with this. */
  time = 0;
  updateUniforms(readBuffer) {
    this.material.uniforms.tDiffuse.value = readBuffer.texture;
    this.material.uniforms.tFluid.value = this.fluid.densityTexture;
    this.material.uniforms.uIntensity.value = this.intensity;
    this.material.uniforms.uTime.value = this.time;
    const img = this.fluid.densityTexture.image;
    this.material.uniforms.uTexel.value.set(1 / img.width, 1 / img.height);
  }
}
const FRAGMENT$e = (
  /* glsl */
  `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tFluid;
uniform sampler2D tDye;
uniform float uIntensity;
uniform vec2 uTexel;
uniform vec3 uCursorColor;
uniform float uVibrance;

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

vec3 vibrant(vec3 col, float v) {
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  return clamp(mix(vec3(lum), col, 1.0 + v), 0.0, 1.0);
}

void main() {
  vec3 scene = texture2D(tDiffuse, vUv).rgb;

  vec3 dye = texture2D(tDye, vUv).rgb * 0.5;
  dye += texture2D(tDye, vUv + uTexel * vec2( 1.0,  1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2(-1.0,  1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2( 1.0, -1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2(-1.0, -1.0)).rgb * 0.125;

  float far = 0.0;
  far += length(texture2D(tDye, vUv + uTexel * vec2( 8.0,  0.0)).rgb);
  far += length(texture2D(tDye, vUv + uTexel * vec2(-8.0,  0.0)).rgb);
  far += length(texture2D(tDye, vUv + uTexel * vec2( 0.0,  8.0)).rgb);
  far += length(texture2D(tDye, vUv + uTexel * vec2( 0.0, -8.0)).rgb);
  far *= 0.25;
  float core = smoothstep(0.02, 0.55, far * uIntensity * 4.0);

  vec2 vel = texture2D(tFluid, vUv).rg;
  float kinetic = clamp(length(vel) * 0.02, 0.0, 1.0);

  vec3 hsv = rgb2hsv(uCursorColor);
  float sat = clamp(hsv.y * mix(0.20, 1.0, core) + kinetic * hsv.y * 0.35, 0.0, 1.0);
  float val = hsv.z * mix(0.78, 1.0, core);
  vec3 tint = vibrant(hsv2rgb(vec3(hsv.x, sat, val)), uVibrance);

  float density = clamp(length(dye) * uIntensity * 3.0, 0.0, 0.95);
  gl_FragColor = vec4(mix(scene, tint, density), 1.0);
}
`
);
class DefaultOverlayPass extends FluidEffectPass {
  constructor(fluid) {
    const initialColor = new Color(0.85, 0.95, 1);
    super(
      FRAGMENT$e,
      {
        tDiffuse: new Uniform(null),
        tFluid: new Uniform(null),
        tDye: new Uniform(null),
        uIntensity: new Uniform(1),
        uTexel: new Uniform(new Vector2(1 / 512, 1 / 512)),
        uCursorColor: new Uniform(initialColor.clone()),
        uVibrance: new Uniform(0)
      }
    );
    this.fluid = fluid;
    this.cursorColor = initialColor;
  }
  fluid;
  intensity = 1;
  vibrance = 0;
  cursorColor;
  updateUniforms(readBuffer) {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tFluid.value = this.fluid.densityTexture;
    u.tDye.value = this.fluid.dyeTexture;
    u.uIntensity.value = this.intensity;
    u.uCursorColor.value.copy(this.cursorColor);
    u.uVibrance.value = this.vibrance;
    const img = this.fluid.dyeTexture.image;
    u.uTexel.value.set(1 / img.width, 1 / img.height);
  }
}
const FRAGMENT$d = (
  /* glsl */
  `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tDye;
uniform float uIntensity;
uniform vec2 uTexel;
uniform vec3 uCursorColor;
uniform float uVibrance;

vec3 vibrant(vec3 col, float v) {
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  return clamp(mix(vec3(lum), col, 1.0 + v), 0.0, 1.0);
}

void main() {
  vec3 scene = texture2D(tDiffuse, vUv).rgb;

  vec3 dye = texture2D(tDye, vUv).rgb * 0.5;
  dye += texture2D(tDye, vUv + uTexel * vec2( 1.0,  1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2(-1.0,  1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2( 1.0, -1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2(-1.0, -1.0)).rgb * 0.125;

  float dL = length(texture2D(tDye, vUv - vec2(uTexel.x * 2.0, 0.0)).rgb);
  float dR = length(texture2D(tDye, vUv + vec2(uTexel.x * 2.0, 0.0)).rgb);
  float dD = length(texture2D(tDye, vUv - vec2(0.0, uTexel.y * 2.0)).rgb);
  float dU = length(texture2D(tDye, vUv + vec2(0.0, uTexel.y * 2.0)).rgb);
  vec2 grad = vec2(dR - dL, dU - dD);
  float gmag = length(grad);
  vec2 ndir = grad / max(gmag, 1e-5);

  float lit = dot(ndir, normalize(vec2(-0.6, 0.8)));
  float strength = smoothstep(0.0, 0.04, gmag);
  float shade = mix(1.0, mix(0.78, 1.0, lit * 0.5 + 0.5), strength);

  float density = clamp(length(dye) * uIntensity * 3.0, 0.0, 0.95);
  vec3 tint = vibrant(uCursorColor, uVibrance) * shade;
  gl_FragColor = vec4(mix(scene, tint, density), 1.0);
}
`
);
class VolumeCursorOverlayPass extends FluidEffectPass {
  constructor(fluid) {
    const initialColor = new Color(0.85, 0.95, 1);
    super(
      FRAGMENT$d,
      {
        tDiffuse: new Uniform(null),
        tDye: new Uniform(null),
        uIntensity: new Uniform(1),
        uTexel: new Uniform(new Vector2(1 / 512, 1 / 512)),
        uCursorColor: new Uniform(initialColor.clone()),
        uVibrance: new Uniform(0)
      }
    );
    this.fluid = fluid;
    this.cursorColor = initialColor;
  }
  fluid;
  intensity = 1;
  vibrance = 0;
  cursorColor;
  updateUniforms(readBuffer) {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tDye.value = this.fluid.dyeTexture;
    u.uIntensity.value = this.intensity;
    u.uCursorColor.value.copy(this.cursorColor);
    u.uVibrance.value = this.vibrance;
    const img = this.fluid.dyeTexture.image;
    u.uTexel.value.set(1 / img.width, 1 / img.height);
  }
}
const FRAGMENT$c = (
  /* glsl */
  `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tFluid;
uniform float uIntensity;
uniform vec3 uCursorColor;
uniform float uVibrance;

vec3 vibrant(vec3 col, float v) {
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  return clamp(mix(vec3(lum), col, 1.0 + v), 0.0, 1.0);
}

void main() {
  vec3 scene = texture2D(tDiffuse, vUv).rgb;
  vec3 fluid = texture2D(tFluid, vUv).rgb;
  vec2 vel = fluid.rg;
  float here = clamp(fluid.b, 0.0, 1.0);

  float tail = 0.0;
  float wsum = 0.0;
  for (float i = 1.0; i < 8.0; i += 1.0) {
    vec2 offset = vel * i * 0.04;
    float w = 1.0 - i / 8.0;
    tail += texture2D(tFluid, vUv - offset).b * w;
    wsum += w;
  }
  tail /= wsum;

  float head = pow(here, 4.0);
  float glow = (tail * 0.7 + head * 1.4) * uIntensity;

  vec3 result = scene + vibrant(uCursorColor, uVibrance) * glow;
  gl_FragColor = vec4(result, 1.0);
}
`
);
class TrailOverlayPass extends FluidEffectPass {
  constructor(fluid) {
    const initialColor = new Color(0.85, 0.95, 1);
    super(
      FRAGMENT$c,
      {
        tDiffuse: new Uniform(null),
        tFluid: new Uniform(null),
        uIntensity: new Uniform(1),
        uCursorColor: new Uniform(initialColor.clone()),
        uVibrance: new Uniform(0)
      }
    );
    this.fluid = fluid;
    this.cursorColor = initialColor;
  }
  fluid;
  intensity = 1;
  vibrance = 0;
  cursorColor;
  updateUniforms(readBuffer) {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tFluid.value = this.fluid.densityTexture;
    u.uIntensity.value = this.intensity;
    u.uCursorColor.value.copy(this.cursorColor);
    u.uVibrance.value = this.vibrance;
  }
}
const FRAGMENT$b = (
  /* glsl */
  `
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
);
class OilOverlayPass extends FluidEffectPass {
  constructor(fluid) {
    super(
      FRAGMENT$b,
      {
        tDiffuse: new Uniform(null),
        tFluid: new Uniform(null),
        uIntensity: new Uniform(1),
        uTime: new Uniform(0),
        uVibrance: new Uniform(0)
      }
    );
    this.fluid = fluid;
  }
  fluid;
  intensity = 1;
  time = 0;
  vibrance = 0;
  updateUniforms(readBuffer) {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tFluid.value = this.fluid.densityTexture;
    u.uIntensity.value = this.intensity;
    u.uTime.value = this.time;
    u.uVibrance.value = this.vibrance;
  }
}
const FRAGMENT$a = (
  /* glsl */
  `
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
);
class VelocityOverlayPass extends FluidEffectPass {
  constructor(fluid) {
    super(
      FRAGMENT$a,
      {
        tDiffuse: new Uniform(null),
        tVelocity: new Uniform(null),
        uIntensity: new Uniform(1)
      }
    );
    this.fluid = fluid;
  }
  fluid;
  intensity = 1;
  updateUniforms(readBuffer) {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tVelocity.value = this.fluid.velocityProjectedTexture;
    u.uIntensity.value = this.intensity;
  }
}
const FRAGMENT$9 = (
  /* glsl */
  `
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

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  vec3 scene = texture2D(tDiffuse, vUv).rgb;
  vec3 fluid = texture2D(tFluid, vUv).rgb;
  vec2 vel = fluid.rg;

  float glow = 0.0;
  vec3 color = vec3(0.0);
  for (float i = 0.0; i < 6.0; i += 1.0) {
    vec2 offset = vel * i * 0.035;
    vec2 origin = vUv - offset;
    float d = texture2D(tFluid, origin).b;
    float w = (1.0 - i / 7.0) * d;
    glow += w;
    float hueA = origin.x * 1.6 + origin.y * 0.9 + uTime * 0.05;
    float hueB = origin.y * 1.2 - origin.x * 0.4 - uTime * 0.03;
    vec3 a = hsv2rgb(vec3(fract(hueA), 0.9, 1.0));
    vec3 b = hsv2rgb(vec3(fract(hueB), 0.85, 0.95));
    color += mix(a, b, 0.5) * w;
  }
  if (glow > 0.0) color /= glow;

  color = vibrant(color, uVibrance);
  float intensity = clamp(glow * uIntensity * 0.55, 0.0, 1.4);
  vec3 result = scene + color * intensity;
  gl_FragColor = vec4(result, 1.0);
}
`
);
class ColorfulOverlayPass extends FluidEffectPass {
  constructor(fluid) {
    super(
      FRAGMENT$9,
      {
        tDiffuse: new Uniform(null),
        tFluid: new Uniform(null),
        uIntensity: new Uniform(1),
        uTime: new Uniform(0),
        uVibrance: new Uniform(0)
      }
    );
    this.fluid = fluid;
  }
  fluid;
  intensity = 1;
  time = 0;
  vibrance = 0;
  updateUniforms(readBuffer) {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tFluid.value = this.fluid.densityTexture;
    u.uIntensity.value = this.intensity;
    u.uTime.value = this.time;
    u.uVibrance.value = this.vibrance;
  }
}
const FRAGMENT$8 = (
  /* glsl */
  `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tVelocity;
uniform float uIntensity;
uniform float uTime;
uniform float uVibrance;

vec3 vibrant(vec3 c, float v) {
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  return clamp(mix(vec3(lum), c, 1.0 + v), 0.0, 1.0);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  vec3 scene = texture2D(tDiffuse, vUv).rgb;
  vec2 vel = texture2D(tVelocity, vUv).xy * 0.04;
  float speed = length(vel);

  float angle = atan(vel.y, vel.x);
  float hueA = angle / 6.28318 + 0.5 + uTime * 0.05;
  float hueB = vUv.x * 1.2 + vUv.y * 0.8 + uTime * 0.04;

  vec3 a = hsv2rgb(vec3(fract(hueA), 0.92, 1.0));
  vec3 b = hsv2rgb(vec3(fract(hueB), 0.7, 0.95));
  vec3 color = vibrant(mix(a, b, 0.35), uVibrance);

  // pow(s, 2.5) kills the low-speed haze that otherwise tints the whole
  // scene whenever fluid is alive, while preserving bright vortex cores.
  float s = clamp(speed * 8.0, 0.0, 1.0);
  float strength = pow(s, 2.5) * 1.6 * uIntensity;
  vec3 result = scene + color * strength;
  gl_FragColor = vec4(result, 1.0);
}
`
);
class RainbowFishOverlayPass extends FluidEffectPass {
  constructor(fluid) {
    super(
      FRAGMENT$8,
      {
        tDiffuse: new Uniform(null),
        tVelocity: new Uniform(null),
        uIntensity: new Uniform(1),
        uTime: new Uniform(0),
        uVibrance: new Uniform(0)
      }
    );
    this.fluid = fluid;
  }
  fluid;
  intensity = 1;
  time = 0;
  vibrance = 0;
  updateUniforms(readBuffer) {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tVelocity.value = this.fluid.velocityProjectedTexture;
    u.uIntensity.value = this.intensity;
    u.uTime.value = this.time;
    u.uVibrance.value = this.vibrance;
  }
}
const FRAGMENT$7 = (
  /* glsl */
  `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tFluid;
uniform float uIntensity;
uniform float uVibrance;

vec3 vibrant(vec3 c, float v) {
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  return clamp(mix(vec3(lum), c, 1.0 + v), 0.0, 1.0);
}

void main() {
  vec3 scene = texture2D(tDiffuse, vUv).rgb;
  float density = clamp(texture2D(tFluid, vUv).b, 0.0, 1.0);
  vec3 tint = vibrant(vec3(1.0, 0.45, 0.22), uVibrance);
  gl_FragColor = vec4(scene + tint * density * uIntensity, 1.0);
}
`
);
class GlazeOverlayPass extends FluidEffectPass {
  constructor(fluid) {
    super(
      FRAGMENT$7,
      {
        tDiffuse: new Uniform(null),
        tFluid: new Uniform(null),
        uIntensity: new Uniform(1),
        uVibrance: new Uniform(0)
      }
    );
    this.fluid = fluid;
  }
  fluid;
  intensity = 1;
  vibrance = 0;
  updateUniforms(readBuffer) {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tFluid.value = this.fluid.densityTexture;
    u.uIntensity.value = this.intensity;
    u.uVibrance.value = this.vibrance;
  }
}
const FRAGMENT$6 = (
  /* glsl */
  `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uIntensity;
uniform sampler2D tDiffuse;
uniform sampler2D tFluid;
uniform float uVibrance;

vec3 vibrant(vec3 c, float v) {
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  return clamp(mix(vec3(lum), c, 1.0 + v), 0.0, 1.0);
}

void main() {
  vec3 scene = texture2D(tDiffuse, vUv).rgb;
  vec3 fluid = texture2D(tFluid, vUv).rgb;
  vec2 vel = fluid.rg;

  float fingers = 0.0;
  for (float i = 0.0; i < 5.0; i++) {
    vec2 offset = vel * (i + 1.0) * 0.05;
    float trail = texture2D(tFluid, vUv - offset).b;
    fingers += trail * (1.0 - i / 5.0);
  }
  fingers *= uIntensity;

  vec3 burnColor = vec3(1.0, 0.3, 0.0);
  vec3 emberColor = vec3(0.8, 0.15, 0.0);
  vec3 ghostColor = mix(emberColor, burnColor, clamp(fingers, 0.0, 1.0));

  float tips = pow(clamp(fingers, 0.0, 1.0), 2.0);
  ghostColor += burnColor * tips * 2.0;

  float smoke = fingers * 0.3;
  vec3 smokeColor = vec3(0.1, 0.1, 0.15) * smoke;

  vec3 fireColor = ghostColor + smokeColor;

  float flicker = 0.8 + 0.2 * sin(uTime * 15.0 + fingers * 20.0);
  fireColor *= flicker;

  float alpha = fingers * 0.5 * flicker + smoke * 0.2;
  alpha = clamp(alpha, 0.0, 0.85);

  vec3 result = mix(scene, vibrant(fireColor, uVibrance), alpha);
  gl_FragColor = vec4(result, 1.0);
}
`
);
class BurnOverlayPass extends FluidEffectPass {
  constructor(fluid) {
    super(
      FRAGMENT$6,
      {
        tDiffuse: new Uniform(null),
        tFluid: new Uniform(null),
        uIntensity: new Uniform(1),
        uTime: new Uniform(0),
        uVibrance: new Uniform(0)
      }
    );
    this.fluid = fluid;
  }
  fluid;
  intensity = 1;
  time = 0;
  vibrance = 0;
  updateUniforms(readBuffer) {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tFluid.value = this.fluid.densityTexture;
    u.uIntensity.value = this.intensity;
    u.uTime.value = this.time;
    u.uVibrance.value = this.vibrance;
  }
}
const FRAGMENT$5 = (
  /* glsl */
  `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tDye;
uniform float uIntensity;
uniform vec2 uTexel;

void main() {
  vec3 scene = texture2D(tDiffuse, vUv).rgb;

  vec3 dye = texture2D(tDye, vUv).rgb * 0.5;
  dye += texture2D(tDye, vUv + uTexel * vec2( 1.0,  1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2(-1.0,  1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2( 1.0, -1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2(-1.0, -1.0)).rgb * 0.125;

  float density = clamp(length(dye) * uIntensity * 3.0, 0.0, 0.95);
  vec3 smokeColor = vec3(0.95, 0.97, 1.0);
  gl_FragColor = vec4(mix(scene, smokeColor, density), 1.0);
}
`
);
class SmokeOverlayPass extends FluidEffectPass {
  constructor(fluid) {
    super(
      FRAGMENT$5,
      {
        tDiffuse: new Uniform(null),
        tDye: new Uniform(null),
        uIntensity: new Uniform(1),
        uTexel: new Uniform(new Vector2(1 / 512, 1 / 512))
      }
    );
    this.fluid = fluid;
  }
  fluid;
  intensity = 1;
  updateUniforms(readBuffer) {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tDye.value = this.fluid.dyeTexture;
    u.uIntensity.value = this.intensity;
    const img = this.fluid.dyeTexture.image;
    u.uTexel.value.set(1 / img.width, 1 / img.height);
  }
}
const FRAGMENT$4 = (
  /* glsl */
  `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tDye;
uniform float uIntensity;
uniform vec2 uTexel;
uniform float uVibrance;

vec3 vibrant(vec3 c, float v) {
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  return clamp(mix(vec3(lum), c, 1.0 + v), 0.0, 1.0);
}

void main() {
  vec3 scene = texture2D(tDiffuse, vUv).rgb;

  vec3 dye = texture2D(tDye, vUv).rgb * 0.5;
  dye += texture2D(tDye, vUv + uTexel * vec2( 1.0,  1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2(-1.0,  1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2( 1.0, -1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2(-1.0, -1.0)).rgb * 0.125;

  // Stroke colours are stored at ~0.3 amplitude (see attachPointerSplats).
  // The 3.0 gain restores them to a vibrant, saturated look.
  // Vibrance is applied in unit-amplitude space: pull out direction, boost,
  // then re-scale, so the magnitude (= alpha contribution) is preserved.
  float dyeAmp = length(dye);
  vec3 dyeBoosted = dyeAmp > 1e-5
    ? vibrant(dye / dyeAmp, uVibrance) * dyeAmp
    : dye;
  vec3 result = scene + dyeBoosted * uIntensity * 3.0;
  gl_FragColor = vec4(result, 1.0);
}
`
);
class ArtInkOverlayPass extends FluidEffectPass {
  constructor(fluid) {
    super(
      FRAGMENT$4,
      {
        tDiffuse: new Uniform(null),
        tDye: new Uniform(null),
        uIntensity: new Uniform(1),
        uTexel: new Uniform(new Vector2(1 / 512, 1 / 512)),
        uVibrance: new Uniform(0)
      }
    );
    this.fluid = fluid;
  }
  fluid;
  intensity = 1;
  vibrance = 0;
  updateUniforms(readBuffer) {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tDye.value = this.fluid.dyeTexture;
    u.uIntensity.value = this.intensity;
    u.uVibrance.value = this.vibrance;
    const img = this.fluid.dyeTexture.image;
    u.uTexel.value.set(1 / img.width, 1 / img.height);
  }
}
const FRAGMENT$3 = (
  /* glsl */
  `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tDye;
uniform float uIntensity;
uniform vec2 uTexel;
uniform float uVibrance;

vec3 vibrant(vec3 c, float v) {
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  return clamp(mix(vec3(lum), c, 1.0 + v), 0.0, 1.0);
}

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  vec3 scene = texture2D(tDiffuse, vUv).rgb;

  vec3 dye = texture2D(tDye, vUv).rgb * 0.5;
  dye += texture2D(tDye, vUv + uTexel * vec2( 1.0,  1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2(-1.0,  1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2( 1.0, -1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2(-1.0, -1.0)).rgb * 0.125;

  float amp = length(dye);
  if (amp < 1e-4) {
    gl_FragColor = vec4(scene, 1.0);
    return;
  }

  float baseHue = rgb2hsv(dye / amp).x;
  float depth = pow(clamp(amp * 2.5, 0.0, 1.0), 0.7);

  float shiftMag = 0.32 + sin(baseHue * 6.28318 * 3.0) * 0.13;
  float hue = fract(baseHue + (1.0 - depth) * shiftMag);
  float sat = mix(0.75, 1.0, depth);

  vec3 col = vibrant(hsv2rgb(vec3(hue, sat, 1.0)), uVibrance);
  vec3 result = scene + col * depth * uIntensity * 1.2;
  gl_FragColor = vec4(result, 1.0);
}
`
);
class RainbowInkOverlayPass extends FluidEffectPass {
  constructor(fluid) {
    super(
      FRAGMENT$3,
      {
        tDiffuse: new Uniform(null),
        tDye: new Uniform(null),
        uIntensity: new Uniform(1),
        uTexel: new Uniform(new Vector2(1 / 512, 1 / 512)),
        uVibrance: new Uniform(0)
      }
    );
    this.fluid = fluid;
  }
  fluid;
  intensity = 1;
  vibrance = 0;
  updateUniforms(readBuffer) {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tDye.value = this.fluid.dyeTexture;
    u.uIntensity.value = this.intensity;
    u.uVibrance.value = this.vibrance;
    const img = this.fluid.dyeTexture.image;
    u.uTexel.value.set(1 / img.width, 1 / img.height);
  }
}
const FRAGMENT$2 = (
  /* glsl */
  `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tDye;
uniform float uIntensity;
uniform vec2 uTexel;
uniform float uVibrance;

vec3 vibrant(vec3 c, float v) {
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  return clamp(mix(vec3(lum), c, 1.0 + v), 0.0, 1.0);
}

void main() {
  vec3 scene = texture2D(tDiffuse, vUv).rgb;

  vec3 dye = texture2D(tDye, vUv).rgb * 0.5;
  dye += texture2D(tDye, vUv + uTexel * vec2( 1.0,  1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2(-1.0,  1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2( 1.0, -1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2(-1.0, -1.0)).rgb * 0.125;

  float density = length(dye);
  vec3 hue = density > 1e-4 ? vibrant(dye / density, uVibrance) : vec3(1.0);
  float alpha = (1.0 - exp(-density * uIntensity * 3.0)) * 0.72;

  vec3 wash = mix(scene, hue * 1.1, alpha);
  vec3 result = wash + scene * hue * alpha * 0.35;
  gl_FragColor = vec4(result, 1.0);
}
`
);
class ColorWaterOverlayPass extends FluidEffectPass {
  constructor(fluid) {
    super(
      FRAGMENT$2,
      {
        tDiffuse: new Uniform(null),
        tDye: new Uniform(null),
        uIntensity: new Uniform(1),
        uTexel: new Uniform(new Vector2(1 / 512, 1 / 512)),
        uVibrance: new Uniform(0)
      }
    );
    this.fluid = fluid;
  }
  fluid;
  intensity = 1;
  vibrance = 0;
  updateUniforms(readBuffer) {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tDye.value = this.fluid.dyeTexture;
    u.uIntensity.value = this.intensity;
    u.uVibrance.value = this.vibrance;
    const img = this.fluid.dyeTexture.image;
    u.uTexel.value.set(1 / img.width, 1 / img.height);
  }
}
const FRAGMENT$1 = (
  /* glsl */
  `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tVelocity;
uniform sampler2D tDye;
uniform float uIntensity;
uniform vec2 uTexel;
uniform float uVibrance;

vec3 vibrant(vec3 c, float v) {
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  return clamp(mix(vec3(lum), c, 1.0 + v), 0.0, 1.0);
}

void main() {
  vec3 dye = texture2D(tDye, vUv).rgb * 0.5;
  dye += texture2D(tDye, vUv + uTexel * vec2( 1.0,  1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2(-1.0,  1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2( 1.0, -1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2(-1.0, -1.0)).rgb * 0.125;

  vec2 vel = texture2D(tVelocity, vUv).xy * 0.04;
  float density = length(dye);
  float refractGate = clamp(density * 4.0, 0.0, 1.0);
  vec2 distortedUv = vUv + vel * refractGate * 0.012;
  vec3 scene = texture2D(tDiffuse, distortedUv).rgb;

  float dyeAmp = length(dye);
  vec3 dyeBoosted = dyeAmp > 1e-5
    ? vibrant(dye / dyeAmp, uVibrance) * dyeAmp
    : dye;
  vec3 tint = min(dyeBoosted * uIntensity * 1.4, vec3(1.6));
  vec3 result = scene + scene * tint;

  gl_FragColor = vec4(result, 1.0);
}
`
);
class LiquidLensOverlayPass extends FluidEffectPass {
  constructor(fluid) {
    super(
      FRAGMENT$1,
      {
        tDiffuse: new Uniform(null),
        tVelocity: new Uniform(null),
        tDye: new Uniform(null),
        uIntensity: new Uniform(1),
        uTexel: new Uniform(new Vector2(1 / 512, 1 / 512)),
        uVibrance: new Uniform(0)
      }
    );
    this.fluid = fluid;
  }
  fluid;
  intensity = 1;
  vibrance = 0;
  updateUniforms(readBuffer) {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tVelocity.value = this.fluid.velocityTexture;
    u.tDye.value = this.fluid.dyeTexture;
    u.uIntensity.value = this.intensity;
    u.uVibrance.value = this.vibrance;
    const img = this.fluid.dyeTexture.image;
    u.uTexel.value.set(1 / img.width, 1 / img.height);
  }
}
const FRAGMENT = (
  /* glsl */
  `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tFluid;
uniform float uIntensity;
uniform vec3 uTint;

void main() {
  vec3 scene = texture2D(tDiffuse, vUv).rgb;
  float density = clamp(texture2D(tFluid, vUv).b, 0.0, 1.0);
  gl_FragColor = vec4(scene + uTint * density * uIntensity, 1.0);
}
`
);
class DensityTintOverlayPass extends FluidEffectPass {
  constructor(fluid) {
    const initialColor = new Color(0.1, 0.42, 0.36);
    super(FRAGMENT, {
      tDiffuse: new Uniform(null),
      tFluid: new Uniform(null),
      uIntensity: new Uniform(0.14),
      uTint: new Uniform(initialColor.clone())
    });
    this.fluid = fluid;
    this.color = initialColor;
  }
  fluid;
  /** Density-to-tint multiplier. Defaults match the original particle-
   *  displacement composite: `scene += vec3(0.10, 0.42, 0.36) * density * 0.14`,
   *  i.e. a teal tint at 0.14 intensity. */
  intensity = 0.14;
  /** Tint colour added to the scene proportionally to fluid density. */
  color;
  updateUniforms(readBuffer) {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tFluid.value = this.fluid.densityTexture;
    u.uIntensity.value = this.intensity;
    u.uTint.value.copy(this.color);
  }
}
export {
  ArtInkOverlayPass,
  BurnOverlayPass,
  ChromaticDistortionPass,
  ColorWaterOverlayPass,
  ColorfulOverlayPass,
  DefaultOverlayPass,
  DensityTintOverlayPass,
  FLUID_PROFILES,
  FULLSCREEN_VERTEX,
  FluidEffectPass,
  FluidSimulation,
  FullscreenPass,
  GlazeOverlayPass,
  LiquidLensOverlayPass,
  OilOverlayPass,
  RGBShiftDistortionPass,
  RainbowFishOverlayPass,
  RainbowInkOverlayPass,
  SimpleDistortionPass,
  SmokeOverlayPass,
  TrailOverlayPass,
  VelocityOverlayPass,
  VolumeCursorOverlayPass,
  WaterCausticsDistortionPass,
  WaterDistortionPass,
  attachPointerSplats,
  createSceneTarget
};
//# sourceMappingURL=three-fluid-fx.es.js.map
