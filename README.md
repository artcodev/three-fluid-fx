# three-fluid-fx

> A drop-in 2D Stable-Fluids solver for [three.js](https://threejs.org/),
> tuned for real-time visual effects. Ships WebGL/GLSL and WebGPU/TSL
> pipelines.

**Built to remove the pain of wiring a fluid sim into a three.js project.**
If you've ever needed one of these and ended up reading a SIGGRAPH paper
to get there — this library is for you.

🌊 **[Live Demo & Documentation](https://three-fluid-fx.artcreativecode.com/)** &nbsp;·&nbsp; 📖 **[Interactive Tutorials](https://three-fluid-fx.artcreativecode.com/tutorials/effects-guide/)**

<table>
  <tr>
    <td width="50%" align="center">
      <a href="https://three-fluid-fx.artcreativecode.com/examples/glsl/minimal/overlay/">
        <img src="https://three-fluid-fx.artcreativecode.com/assets/previews/fx-example-overlay.png" width="100%" alt="Fluid cursor overlay" />
      </a>
      <br/>
      <strong>Fluid cursor overlay</strong>
      <br/>
      Coloured ink / trail that follows the pointer.
      <br/>
      <a href="https://three-fluid-fx.artcreativecode.com/examples/glsl/minimal/overlay/">live demo</a>
      ·
      <a href="examples/glsl/minimal/overlay/main.ts">source</a>
    </td>
    <td width="50%" align="center">
      <a href="https://three-fluid-fx.artcreativecode.com/examples/glsl/minimal/distortion/">
        <img src="https://three-fluid-fx.artcreativecode.com/assets/previews/fx-example-distortion.png" width="100%" alt="Fluid screen distortion" />
      </a>
      <br/>
      <strong>Fluid screen distortion (UV refraction)</strong>
      <br/>
      Smear / heat-haze / liquid-lens by sampling your scene with <code>tFluid.rg</code>.
      <br/>
      <a href="https://three-fluid-fx.artcreativecode.com/examples/glsl/minimal/distortion/">live demo</a>
      ·
      <a href="examples/glsl/minimal/distortion/main.ts">source</a>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <a href="https://three-fluid-fx.artcreativecode.com/examples/glsl/minimal/particles-trefoil/">
        <img src="https://three-fluid-fx.artcreativecode.com/assets/previews/fx-example-particles-trefoil.png" width="100%" alt="Particle displacement" />
      </a>
      <br/>
      <strong>Particle displacement (vertex shader)</strong>
      <br/>
      Push procedural particle positions with the velocity field — no GPGPU required.
      <br/>
      <a href="https://three-fluid-fx.artcreativecode.com/examples/glsl/minimal/particles-trefoil/">live demo</a>
      ·
      <a href="examples/glsl/minimal/particles-trefoil/main.ts">source</a>
    </td>
    <td width="50%" align="center">
      <a href="https://three-fluid-fx.artcreativecode.com/examples/glsl/minimal/particles-3d/">
        <img src="https://three-fluid-fx.artcreativecode.com/assets/previews/fx-example-particles-3d.png" width="100%" alt="GPGPU particle displacement" />
      </a>
      <br/>
      <strong>GPGPU particle displacement</strong>
      <br/>
      Full ping-pong particle system advected by the velocity texture (2D and 3D).
      <br/>
      <a href="https://three-fluid-fx.artcreativecode.com/examples/glsl/minimal/particles-3d/">live demo (3D)</a>
      ·
      <a href="examples/glsl/minimal/particles-2d/main.ts">2D source</a>
      ·
      <a href="examples/glsl/minimal/particles-3d/main.ts">3D source</a>
    </td>
  </tr>
</table>

You bring a three.js scene; the library hands you solver outputs and a
five-line API. In the WebGL/GLSL pipeline those outputs are textures
(`velocityTexture`, `densityTexture`). In the WebGPU/TSL pipeline they are
both raw textures and `TextureNode`s. Everything else — how to composite them,
what to distort, which particles to push — stays in your shaders, where it
belongs.

> ℹ️ **Not a new algorithm.** This is a three.js-focused _packaging_ of
> Jos Stam's _Stable Fluids_ (SIGGRAPH 1999), with vorticity confinement
> (Fedkiw 2001) and optional BFECC advection. See
> [Acknowledgements & scope](#acknowledgements--scope) for prior art and credits.

### Don't use this if you need

- ❌ CFD-grade physical accuracy (this is not Navier-Stokes engineering)
- ❌ free-surface water with splashes (use FLIP / SPH)
- ❌ 3D volumetric fluid (smoke volumes, fire as a volume) — this is 2D only
- ❌ rigid-body collision coupling — the solver doesn't know about your scene

### Why it's "easy"

- **Plain-property API.** No `configure()` calls; write `fluid.curlStrength = 0.7` any time.
- **Profile presets.** One option (`profile: 'balanced'`) sets resolution + iterations.
- **Drop-in helper** for pointer splats; everything else is opt-in and tree-shakable.
- **No DOM dependency** in the solver itself — runs in OffscreenCanvas / Worker.
- **Plain-JS friendly** — `.d.ts` is opt-in metadata, never required at runtime.

### Tech facts

- Tree-shakable ESM + CJS bundles (~13 KB gzipped for the full GLSL pipeline
  with all 20 passes, ~11 KB gzipped for the TSL pipeline). `three` stays a
  peer dependency.
- WebGL2 / HalfFloat FBOs in the default GLSL pipeline; WebGPU/WGSL compute in
  the TSL pipeline.
- GLSL pipeline: 20 `Pass` subclasses, compatible with three.js
  `EffectComposer` and the standard post-processing pipeline (see below).
- TSL pipeline: `RenderPipeline`-ready node functions and WGSL-backed fluid
  simulation via `three-fluid-fx/tsl`.
- Drop-in across React-Three-Fiber, plain three.js, or `<script>`-based pages.

### WebGL post-processing passes

The default `three-fluid-fx` entry is compatible with three.js
`EffectComposer` and the standard post-processing pipeline. It ships 20 `Pass`
subclasses that chain alongside
`RenderPass`, `OutputPass`, `BloomPass`, etc. without configuration:

- **5 distortion passes** — `SimpleDistortionPass`, `RGBShiftDistortionPass`,
  `ChromaticDistortionPass`, `WaterDistortionPass`, `WaterCausticsDistortionPass`
- **15 overlay passes** — `DefaultOverlayPass`, `VolumeCursorOverlayPass`,
  `TrailOverlayPass`, `OilOverlayPass`, `VelocityOverlayPass`,
  `ColorfulOverlayPass`, `RainbowFishOverlayPass`, `GlazeOverlayPass`,
  `BurnOverlayPass`, `SmokeOverlayPass`, `ArtInkOverlayPass`,
  `RainbowInkOverlayPass`, `ColorWaterOverlayPass`, `LiquidLensOverlayPass`,
  `DensityTintOverlayPass`

Each pass exposes plain properties (`intensity`, `vibrance`, `cursorColor`, …)
and reads from `tDiffuse` — the convention `ShaderPass.textureID` uses by
default — so chaining "just works":

```ts
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { ChromaticDistortionPass } from 'three-fluid-fx'

const distortion = new ChromaticDistortionPass(fluid)
distortion.intensity = 0.5

const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
composer.addPass(distortion)
composer.addPass(new OutputPass()) // canonical final pass: tone mapping + sRGB

// Loop:
fluid.step(dt)
composer.render(dt)
```

### WebGPU / TSL nodes

The `three-fluid-fx/tsl` entry uses a WGSL compute solver and exposes TSL node
functions for composition. These are meant for `WebGPURenderer` and
`RenderPipeline`, not `EffectComposer`:

```ts
import { RenderPipeline, WebGPURenderer } from 'three/webgpu'
import { pass } from 'three/tsl'
import { attachPointerSplats, FluidSimulation, simpleDistortion } from 'three-fluid-fx/tsl'

const renderer = new WebGPURenderer()
await renderer.init()

const fluid = new FluidSimulation(renderer)
attachPointerSplats(renderer.domElement, fluid)

const scenePass = pass(scene, camera)
const pipeline = new RenderPipeline(renderer)
pipeline.outputNode = simpleDistortion(scenePass, fluid.densityNode, 1)

renderer.setAnimationLoop(() => {
  fluid.step(1 / 60)
  pipeline.render()
})
```

## Install

```bash
npm install three-fluid-fx three
# or
pnpm add three-fluid-fx three
```

Requires `three >= 0.183.0`. The default subpath `three-fluid-fx` is the
WebGL/GLSL pipeline. Use `three-fluid-fx/tsl` for the WebGPU/TSL pipeline; it
requires a WebGPU-capable browser/runtime.

## Quick start

```ts
import { WebGLRenderer, Timer } from 'three'
import { FluidSimulation, attachPointerSplats } from 'three-fluid-fx'

const renderer = new WebGLRenderer({ antialias: true })
const fluid = new FluidSimulation(renderer, {
  splatRadius: 0.001,
  splatForce: 6,
})

// live-tunable, just plain properties
fluid.curlStrength = 0.7
fluid.splatForce = 8 // change at any time, picked up next frame

// optional helper for mouse/touch — reads splatRadius/splatForce from fluid
attachPointerSplats(renderer.domElement, fluid)

const clock = new Timer()
renderer.setAnimationLoop(() => {
  clock.update()
  fluid.step(clock.getDelta())
  // sample fluid.velocityTexture / fluid.densityTexture in your own material
})
```

### Plain JavaScript (no bundler, no TypeScript)

```html
<div id="stage" style="width: 100vw; height: 100vh"></div>

<script type="importmap">
  {
    "imports": {
      "three": "https://esm.sh/three@0.183.0",
      "three-fluid-fx": "https://esm.sh/three-fluid-fx@0.1.0"
    }
  }
</script>

<script type="module">
  import { WebGLRenderer } from 'three'
  import { attachPointerSplats, FluidSimulation } from 'three-fluid-fx'

  const stage = document.getElementById('stage')
  const renderer = new WebGLRenderer({ antialias: true })
  stage.appendChild(renderer.domElement)

  const fluid = new FluidSimulation(renderer, {
    splatRadius: 0.001,
    splatForce: 6,
  })

  attachPointerSplats(renderer.domElement, fluid)

  function frame() {
    const width = stage.clientWidth
    const height = stage.clientHeight
    renderer.setSize(width, height, false)
    fluid.resize(width, height)
    fluid.step(1 / 60)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
</script>
```

## API

### `class FluidSimulation`

```ts
new FluidSimulation(renderer: WebGLRenderer, options?: FluidSimulationOptions)
```

All tunables are **plain properties** — write to them at any time, the solver picks
the new value on the next `step()`. This makes Tweakpane / dat.gui / any UI integration
a one-liner: `pane.addBinding(fluid, 'curlStrength', { min: 0, max: 2 })`.

### Quality profiles

Baseline resolution and Jacobi-iteration counts are picked at construction
time. `resize(width, height)` reshapes the internal targets to the viewport
aspect, but it does not change the selected profile's base resolution. Use a
profile preset:

```ts
import { FluidSimulation, FLUID_PROFILES } from 'three-fluid-fx'

new FluidSimulation(renderer, { profile: 'performance' }) // mobile / weak GPU
new FluidSimulation(renderer, { profile: 'balanced' }) // default — desktop
new FluidSimulation(renderer, { profile: 'quality' }) // presentation / high-end
```

|             | sim FBO | dye FBO | pressure iters | relative cost |
| ----------- | ------- | ------- | -------------- | ------------- |
| performance | 128²    | 256²    | 6              | 1×            |
| balanced    | 256²    | 512²    | 12             | ~6×           |
| quality     | 384²    | 1024²   | 20             | ~25×          |

Individual options always override profile values:

```ts
new FluidSimulation(renderer, {
  profile: 'balanced',
  pressureIterations: 8, // overrides balanced default of 12
})
```

| Property              | Default   | What it does                                      |
| --------------------- | --------- | ------------------------------------------------- |
| `pressureIterations`  | `12`      | Jacobi iterations for the balanced profile.       |
| `curlStrength`        | `0.55`    | Vorticity confinement strength.                   |
| `enableVorticity`     | `false`   | Toggle the curl + vorticity passes (Fedkiw 2001). |
| `bfecc`               | `true`    | BFECC advection (sharper, ~5× cost in advect).    |
| `velocityDissipation` | `0.985`   | Per-second decay of velocity field.               |
| `densityDissipation`  | `0.91`    | Per-second decay of density field.                |
| `dyeDissipation`      | `0.91`    | Per-second decay of the optional dye field.       |
| `pressureDissipation` | `0.8`     | Decay of residual pressure between frames.        |
| `splatRadius`         | `0.00042` | Default radius for `addSplat()` (UV² units).      |
| `splatForce`          | `6`       | Default force for `attachPointerSplats`.          |
| `reflectWalls`        | `true`    | Reflect flow from the viewport edges.             |
| `enableDye`           | `false`   | Update the optional per-stroke dye texture.       |

Read-only outputs:

```ts
fluid.velocityTexture // THREE.Texture, .xy is the post-advection flow field
fluid.velocityProjectedTexture // THREE.Texture, projected pre-advection flow snapshot
fluid.densityTexture // THREE.Texture, .rg is flow-like display data, .b is density
fluid.dyeTexture // THREE.Texture, .rgb is the optional colored dye field
```

TSL/WebGPU exposes the same simulation state as `TextureNode`s, which are the
inputs expected by the TSL effect factories:

```ts
fluid.velocityNode // TextureNode, .xy is the post-advection flow field
fluid.densityNode // TextureNode, .rg is flow-like display data, .b is density
fluid.dyeNode // TextureNode, .rgb is the optional colored dye field
fluid.pressureNode // TextureNode, advanced/debug pressure field
fluid.divergenceNode // TextureNode, advanced/debug divergence field
fluid.curlNode // TextureNode, advanced/debug curl field
```

GLSL passes and TSL factories are paired by effect family:

| GLSL pass class                     | TSL factory                 |
| ----------------------------------- | --------------------------- |
| `SimpleDistortionPass`              | `simpleDistortion()`        |
| `RGBShiftDistortionPass`            | `rgbShiftDistortion()`      |
| `ChromaticDistortionPass`           | `chromaticDistortion()`     |
| `WaterDistortionPass`               | `waterDistortion()`         |
| `WaterCausticsDistortionPass`       | `waterCausticsDistortion()` |
| `DefaultOverlayPass`                | `defaultOverlay()`          |
| `VolumeCursorOverlayPass`           | `volumeCursorOverlay()`     |
| `TrailOverlayPass`                  | `trailOverlay()`            |
| `OilOverlayPass`                    | `oilOverlay()`              |
| `VelocityOverlayPass`               | `velocityOverlay()`         |
| `ColorfulOverlayPass`               | `colorfulOverlay()`         |
| `RainbowFishOverlayPass`            | `rainbowFishOverlay()`      |
| `GlazeOverlayPass`                  | `glazeOverlay()`            |
| `BurnOverlayPass`                   | `burnOverlay()`             |
| `SmokeOverlayPass`                  | `smokeOverlay()`            |
| `ArtInkOverlayPass`                 | `artInkOverlay()`           |
| `RainbowInkOverlayPass`             | `rainbowInkOverlay()`       |
| `ColorWaterOverlayPass`             | `colorWaterOverlay()`       |
| `LiquidLensOverlayPass`             | `liquidLensOverlay()`       |
| `DensityTintOverlayPass`            | `densityTintOverlay()`      |

Methods:

```ts
fluid.resize(width, height)
fluid.addSplat(x01, y01, dx, dy, { radius?, color?, dyeColor? })
fluid.step(deltaSeconds)
fluid.dispose()
```

### `attachPointerSplats(element, fluid)`

Attaches pointer listeners and pushes splats into the solver. Splat radius and
force are read from `fluid.splatRadius` / `fluid.splatForce` on every event —
set them in the constructor or write them at runtime; live-tuning works
without re-attaching. Returns a teardown function.

Options:

```ts
attachPointerSplats(renderer.domElement, fluid, {
  coloredStrokes: true,
  colorUpdateSpeed: 10,
  colorize: (dx, dy, timeMs) => [Math.abs(dx) * 0.003, 0.08, Math.abs(dy) * 0.003],
})
```

### `FullscreenPass(material)`

Tiny full-screen quad pass for compositing your shader on top of the solver's outputs.
Use `FULLSCREEN_VERTEX` as your vertex shader.

### `createSceneTarget(width, height)`

Convenience factory for a `WebGLRenderTarget` configured for sRGB display sampling.

## Tutorials

The site, tutorials, and live example pages now use one Astro engine. Source for
the hand-authored guides lives in `src/content/tutorials/`; reusable tutorial UI
lives in `src/components/tutorials/`; example route metadata lives in
`src/data/examples.ts`. The static site build writes to `dist/`.

```bash
pnpm dev           # Astro site + live examples at http://127.0.0.1:4321/
pnpm build         # typecheck + static site build -> dist/
pnpm docs:dev      # alias for pnpm dev
pnpm docs:build    # Astro site build -> dist/
```

The public tutorial surface is Astro-only. General guides live at `/tutorials/`,
and every runnable demo has a personal walkthrough at
`/tutorials/<pipeline>/<level>/<slug>/`. The runnable demos live at
`/examples/<pipeline>/<level>/<slug>/` and are generated from the same Astro
manifest while importing `examples/<pipeline>/<level>/<slug>/main.ts`.

### Core guides

These are source links. When `pnpm dev` is running, the same guides are served
under `http://127.0.0.1:4321/tutorials/`.

- [Getting Started](src/content/tutorials/getting-started.mdx) — solver lifecycle, pointer splats, resize handling, outputs, profiles, and parameters.
- [Effects Guide](src/content/tutorials/effects-guide.mdx) — overlay and distortion families, what they read, and when to use each one.
- [Particles Guide](src/content/tutorials/particles-guide.mdx) — procedural particles, GPGPU particles, camera data, and tuning without ambiguity.
- [GLSL vs TSL](src/content/tutorials/glsl-vs-tsl.mdx) — choosing the WebGL/GLSL or WebGPU/TSL pipeline.

### Demo walkthroughs

Per-demo walkthrough content is generated from
[src/data/exampleTutorials.ts](src/data/exampleTutorials.ts), with route
metadata in [src/data/examples.ts](src/data/examples.ts). When `pnpm dev` is
running, walkthroughs live at `/tutorials/<pipeline>/<level>/<slug>/`.

- [Hello World source](examples/glsl/minimal/helloworld/main.ts) — smallest solver integration.
- [Overlay source](examples/glsl/full/overlay/main.ts) — scene compositing, dye-aware strokes, and style controls.
- [Distortion source](examples/glsl/full/distortion/main.ts) — UV refraction, chromatic styles, water, and caustics.
- [Simple Particles source](examples/glsl/full/particles-trefoil/main.ts) — procedural particle displacement without GPGPU state.
- [GPGPU Particles 2D source](examples/glsl/full/particles-2d/main.ts) and [GPGPU Particles 3D source](examples/glsl/full/particles-3d/main.ts) — persistent particle state driven by the fluid field.
- [TSL Combined Demo source](examples/tsl/full/combined/main.ts) — combined WebGPU composition surface.
- [TSL Mega Demo source](examples/tsl/full/mega/main.ts) — hero-style morphing WebGPU particle composition.

## Repo layout

```
src/
├── core/                                       ← published library (only three is required)
│   ├── shared/
│   │   └── pointerSplats.ts                    ← pipeline-agnostic
│   ├── glsl/                                   ← WebGL/GLSL entry: 'three-fluid-fx'
│   │   ├── simulation/
│   │   ├── effects/                            ← EffectComposer-ready Pass subclasses
│   │   │   ├── distortion/                     ←  5 distortion passes
│   │   │   └── overlay/                        ← 15 overlay passes
│   │   └── index.ts
│   └── tsl/                                    ← WebGPU/TSL entry: 'three-fluid-fx/tsl'
│       ├── simulation/                         ← WGSL compute solver
│       ├── effects/                            ← RenderPipeline/TSL node functions
│       └── index.ts
├── content/tutorials/                          ← Astro MDX tutorial source
├── data/examples.ts                            ← examples manifest / route metadata
├── components/
│   ├── examples/                               ← catalog cards and shared example UI
│   ├── site/                                   ← header/footer shared by site pages
│   └── tutorials/                              ← tutorial UI blocks
├── layouts/                                    ← site, tutorial, and fullscreen example shells
├── pages/
│   ├── examples/                               ← Astro-generated live example routes
│   └── tutorials/                              ← Astro-generated tutorial routes
└── scripts/example-pages.ts                    ← imports the selected example main.ts

examples/
├── extras/                                     ← demo helpers (not published)
│   ├── controls/                               ← Tweakpane wrapper, param ranges
│   ├── backgrounds/{glsl,tsl}/                 ← background implementations
│   ├── particles/{glsl,tsl}/                   ← example particle systems
│   └── resolveProfile.ts                       ← URL profile resolver (?profile=balanced)
├── glsl/{minimal,full}/<slug>/main.ts          ← WebGL runtime entrypoints
└── tsl/{minimal,full}/<slug>/main.ts           ← WebGPU runtime entrypoints

examples-js/                                   ← generated from examples/
├── glsl/{minimal,full}/<slug>/main.js
└── tsl/{minimal,full}/<slug>/main.js
```

## Develop

```bash
pnpm install
pnpm dev               # Astro site + live examples at http://127.0.0.1:4321/
pnpm build             # typecheck + Astro static build -> dist/
pnpm build:js          # regenerate examples-js/
pnpm build:lib         # library build (both pipelines + .d.ts) → dist-lib/{glsl,tsl}/
pnpm build:lib:glsl    # GLSL bundle only → dist-lib/glsl/
pnpm build:lib:tsl     # TSL bundle only  → dist-lib/tsl/
pnpm docs:dev          # alias for pnpm dev
pnpm docs:build        # Astro site build -> dist/
```

## Notes on design

- **No `configure(...)` method.** Properties are public; the solver re-reads them
  each frame. This keeps GUI integration trivial.
- **No GUI in the library.** Tweakpane is a dependency of the **examples**, not of
  the library. Tree-shakers will drop nothing extra; users who don't need a GUI
  never pay for one.
- **GPGPU particles are not part of the library.** They live in
  `examples/extras/particles/` as an example of how to use
  `fluid.velocityTexture` to drive your own particle system.

## Acknowledgements & scope

**This library does not introduce new fluid-simulation algorithms.** The
mathematics is Jos Stam's _Stable Fluids_ (SIGGRAPH 1999) with Fedkiw's
vorticity confinement (2001) and optional BFECC advection — all 20+ years
old and widely implemented. The WebGL adaptation patterns are well-trodden
ground, popularised by PavelDoGreat's WebGL-Fluid-Simulation and walked
through clearly by the mofu-dev tutorial.

**What this package contributes** is _packaging and ergonomics for three.js
projects_: tree-shakable npm entries with a plain-property API, profile
presets, three.js-native texture outputs, and small helpers
(`attachPointerSplats`, `FullscreenPass`). The solver is opinionated towards
real-time VFX — not CFD accuracy.

If you want to learn the algorithm, read Stam's paper and the mofu-dev
tutorial. If you want to drop a velocity/density field into your three.js
scene in five lines, use this.

### Algorithms (not authored by this project)

- Jos Stam, [_Stable Fluids_](https://www.dgp.toronto.edu/people/stam/reality/Research/pdf/ns.pdf) (SIGGRAPH 1999) — pressure projection method.
- Fedkiw, Stam, Jensen, _Visual Simulation of Smoke_ (SIGGRAPH 2001) — vorticity confinement.
- Kim, Liu, Llamas, Rossignac, _Advections with Significantly Reduced Dissipation and Diffusion_ (2007) — BFECC.

### WebGL adaptations and tutorials this work studied

- [PavelDoGreat/WebGL-Fluid-Simulation](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation) (MIT) — popularised the WebGL adaptation techniques used here.
- [mofu-dev — _Stable Fluids_](https://mofu-dev.com/en/blog/stable-fluids/) — clear walkthrough of the algorithm.
- [mnmxmx/fluid-three](https://github.com/mnmxmx/fluid-three) — the implementation accompanying the mofu-dev post.

### What this project authored

The public API (`FluidSimulation`, `attachPointerSplats`, profile presets),
the three.js integration layer, the example tutorials and the packaging.
The shaders are derivatives of the prior-art shader code listed above.

## License

MIT © Artem Korenevych. See [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
