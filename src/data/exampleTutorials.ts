import type { ExampleCase, ExampleEngine, ExampleEntry, ExampleLevel } from './examples'
import { formatEngine, formatLevel } from './examples'

interface TutorialStep {
  title: string
  body: string
}

interface TutorialParameter {
  name: string
  role: string
  tune: string
}

interface CaseTutorial {
  focus: string
  outcome: string[]
  mentalModel: string
  implementation: TutorialStep[]
  parameters: TutorialParameter[]
  sourceFocus: string[]
  productionNotes: string[]
}

export interface DemoTutorial {
  title: string
  description: string
  section: string
  badge: string
  intro: string
  focus: string
  outcome: string[]
  mentalModel: string
  implementation: TutorialStep[]
  parameters: TutorialParameter[]
  sourceFocus: string[]
  productionNotes: string[]
  snippet: string
  relatedGuideHref: string
  relatedGuideLabel: string
}

const engineCopy: Record<
  ExampleEngine,
  {
    label: string
    importPath: string
    renderPath: string
    output: string
  }
> = {
  glsl: {
    label: 'WebGL / GLSL',
    importPath: 'three-fluid-fx',
    renderPath: 'EffectComposer passes, ShaderMaterial uniforms, and WebGL render targets.',
    output: 'Texture objects: velocityTexture, densityTexture, and dyeTexture when dye is enabled.',
  },
  tsl: {
    label: 'WebGPU / TSL',
    importPath: 'three-fluid-fx/tsl',
    renderPath: 'RenderPipeline output nodes, TSL factories, and WGSL compute helpers.',
    output: 'TextureNode fields: velocityNode, densityNode, and dyeNode when dye is enabled.',
  },
}

const levelCopy: Record<
  ExampleLevel,
  {
    label: string
    intent: string
    implementation: string
  }
> = {
  minimal: {
    label: 'Minimal',
    intent: 'This version keeps the integration small so the moving parts are visible.',
    implementation:
      'It avoids GUI state and preset switching. Read it first when you need the smallest reliable version of the technique.',
  },
  full: {
    label: 'Full',
    intent: 'This version is the production tuning surface for the same idea.',
    implementation:
      'It keeps the core render path but adds controls, style choices, background handling, and parameters that matter when shipping the effect.',
  },
}

const caseTutorials: Record<ExampleCase, CaseTutorial> = {
  helloworld: {
    focus: 'Create the solver, attach pointer splats, resize it with the canvas, and render the density field directly.',
    outcome: [
      'Understand the smallest useful FluidSimulation lifecycle.',
      'Know why the solver output is invisible until you render or sample it.',
      'Keep resize, pixel ratio, and dt handling explicit.',
    ],
    mentalModel:
      'Hello World is not an effect stack. It is the baseline proof that pointer input is writing energy into a GPU fluid field and that the render loop is stepping that field correctly.',
    implementation: [
      {
        title: 'Create the renderer and solver together',
        body: 'The renderer owns the GPU context. The simulation allocates its render targets against that context, so construction belongs near renderer setup.',
      },
      {
        title: 'Attach pointer splats',
        body: 'Pointer movement writes velocity and density impulses. The helper is intentionally thin, so splatRadius and splatForce remain normal runtime parameters.',
      },
      {
        title: 'Render the density output',
        body: 'The demo draws the fluid field itself. Later examples replace this final draw with overlays, distortion passes, or particles.',
      },
    ],
    parameters: [
      {
        name: 'profile',
        role: 'Chooses the default render-target sizes and pressure baseline.',
        tune: 'Use performance for embeds, balanced for normal pages, and quality for hero captures.',
      },
      {
        name: 'splatRadius',
        role: 'Brush size in normalized UV units.',
        tune: 'Start small for crisp trails. Raise it when the pointer should feel like smoke or water.',
      },
      {
        name: 'splatForce',
        role: 'Velocity gain from pointer movement.',
        tune: 'Raise it until the field clearly reacts. Lower it if fast mouse movement tears the shape.',
      },
      {
        name: 'densityDissipation',
        role: 'How long the visible mask remains alive.',
        tune: 'High values make long trails. Lower values make quick puffs.',
      },
    ],
    sourceFocus: [
      'Renderer setup and animation loop.',
      'FluidSimulation construction options.',
      'resize() and fluid.resize(width, height).',
      'The draw path that turns density into pixels.',
    ],
    productionNotes: [
      'Keep the simulation resize tied to the visible canvas size, not just window.innerWidth.',
      'Clamp devicePixelRatio for small demos and documentation embeds.',
      'Use this demo as a smoke test before debugging any higher-level effect.',
    ],
  },
  overlay: {
    focus: 'Paint vibrant, fluid-driven brush strokes, smoke, and neon ink trails over your existing scene.',
    outcome: [
      'Know which fluid channels overlays read.',
      'Choose between density-only trails and dye-aware color strokes.',
      'Tune intensity without hiding the underlying three.js scene.',
    ],
    mentalModel:
      'Think of it as a dynamic, interactive paint layer. Your 3D scene renders normally, and the fluid solver acts as an intelligent brush that weaves colorful, dissipating trails perfectly onto the glass of the screen.',
    implementation: [
      {
        title: 'Render the scene first',
        body: 'The background is not part of the fluid solver. It is your normal three.js scene or background pass.',
      },
      {
        title: 'Run the solver once per frame',
        body: 'The overlay should sample the latest fluid output. Do the simulation step before the composer or RenderPipeline output is evaluated.',
      },
      {
        title: 'Choose the overlay family',
        body: 'Clean trails can use density only. Ink, smoke, and watercolor styles should enable dye so the stroke color has its own lifetime.',
      },
    ],
    parameters: [
      {
        name: 'intensity',
        role: 'Visual gain of the overlay color.',
        tune: 'Raise until the trail reads clearly. Reduce it when the scene loses contrast.',
      },
      {
        name: 'enableDye',
        role: 'Allocates and updates the colored dye field.',
        tune: 'Enable it for ink, smoke, watercolor, and any style where stroke color matters.',
      },
      {
        name: 'dyeDissipation',
        role: 'How long colored strokes remain visible.',
        tune: 'Set higher than densityDissipation when color should linger after the mask softens.',
      },
      {
        name: 'vibrance',
        role: 'Saturation boost inside many overlay styles.',
        tune: 'Use lower values for UI pages and higher values for demo reels.',
      },
    ],
    sourceFocus: [
      'Scene/background setup before the fluid effect.',
      'Overlay style creation and style switching.',
      'Dye-related pointer options.',
      'The per-frame order: fluid.step(dt), then render/composite.',
    ],
    productionNotes: [
      'Do not make the overlay responsible for pointer input. Keep pointer splats attached to the solver.',
      'If the effect should be subtle, reduce intensity before weakening the solver.',
      'Use dye only when needed. Density-only overlays are cheaper and easier to art-direct.',
    ],
  },
  distortion: {
    focus: 'Melt, refract, and smear your scene using fluid momentum to create realistic glass, water, or heat-haze effects.',
    outcome: [
      'Understand why distortion reads flow instead of drawing fluid color.',
      'Know how intensity, splatForce, and dissipation affect perceived refraction.',
      'Choose the right distortion family for heat haze, glass, chromatic smear, or water.',
    ],
    mentalModel:
      "Distortion doesn't paint colors; it bends light. The fluid's velocity field acts as a screen-space UV displacement map, warping the typography and 3D objects underneath it exactly where the cursor drags them.",
    implementation: [
      {
        title: 'Render a scene texture',
        body: 'The distortion needs pixels to refract. In WebGL that usually means an EffectComposer chain; in TSL it means a scene node in the RenderPipeline.',
      },
      {
        title: 'Sample the fluid flow',
        body: 'The main signal is the velocity stored in the fluid output. Strong gestures create larger UV offsets.',
      },
      {
        title: 'Clamp the visual gain',
        body: 'Distortion becomes ugly faster than overlays. Keep intensity modest and tune the solver force separately.',
      },
    ],
    parameters: [
      {
        name: 'intensity',
        role: 'Amount of UV displacement applied to the scene.',
        tune: 'Start low. Raise until motion is visible but edges do not tear.',
      },
      {
        name: 'splatForce',
        role: 'How much pointer motion enters the velocity field.',
        tune: 'Use force for interaction feel, then use intensity for final visual scale.',
      },
      {
        name: 'velocityDissipation',
        role: 'How long the refractive motion keeps moving.',
        tune: 'High values feel like glass or water. Lower values feel like quick heat shimmer.',
      },
      {
        name: 'densityDissipation',
        role: 'Mask lifetime for density-aware distortion styles.',
        tune: 'Raise it for water and chromatic effects that use density as a height or visibility mask.',
      },
    ],
    sourceFocus: [
      'Composer or RenderPipeline setup.',
      'Which distortion style is selected.',
      'The shader or node path that turns flow into UV offsets.',
      'Time uniform updates for animated water and caustics.',
    ],
    productionNotes: [
      'Keep distortion below the threshold where text becomes unreadable.',
      'For UI overlays, prefer heat-haze intensity over strong chromatic split.',
      'For water, use larger splats and slower density decay so the surface has body.',
    ],
  },
  'particles-trefoil': {
    focus: 'Tear apart and dynamically bend procedural geometries (like knots or typography) using fluid winds, with zero GPGPU overhead.',
    outcome: [
      'Understand the difference between procedural particles and GPGPU particles.',
      'Use fluid flow as render-time displacement instead of integrated motion.',
      'Keep the base shape readable while still reacting to the cursor.',
    ],
    mentalModel:
      'Instead of running an expensive physics simulation, we sample the fluid flow directly in the vertex shader. The fluid acts like a real-time magnetic wind that stretches, twists, and displaces the rigid shape only where the cursor touches it, instantly snapping back when the wind dies.',
    implementation: [
      {
        title: 'Generate the base shape from instance id',
        body: 'The knot formula gives every particle a deterministic home position. There is no position texture to update.',
      },
      {
        title: 'Sample the fluid at the projected point',
        body: 'The shader uses the particle position to find the matching screen-space fluid sample.',
      },
      {
        title: 'Blend flow into displacement',
        body: 'Threshold and range controls decide when the brush is strong enough to bend the shape.',
      },
    ],
    parameters: [
      {
        name: 'displacement',
        role: 'Maximum offset added to the procedural position.',
        tune: 'Raise until the cursor is visible. Lower it if the knot stops reading as a knot.',
      },
      {
        name: 'dispThreshold',
        role: 'Minimum fluid activity before particles move.',
        tune: 'Increase it to ignore background noise and keep the shape stable.',
      },
      {
        name: 'dispRange',
        role: 'Softness of the transition above the threshold.',
        tune: 'Wider ranges feel organic. Narrow ranges feel graphic and sharp.',
      },
      {
        name: 'dragStrength',
        role: 'Extra pull along screen-space flow.',
        tune: 'Use small values. Too much drag turns the procedural object into a smear.',
      },
    ],
    sourceFocus: [
      'The trefoil position formula.',
      'Fluid sampling in the vertex or TSL node path.',
      'Threshold and displacement controls.',
      'Point size and rotation updates.',
    ],
    productionNotes: [
      'Use procedural particles when the object has a strong identity: a knot, logo, text, shell, or mask.',
      'Do not add GPGPU state unless the particles need memory.',
      'Clamp fast flow so quick pointer movements do not explode the shape.',
    ],
  },
  'particles-2d': {
    focus: 'Drive thousands of interactive, 3D-shaded liquid droplets (GPGPU) using the fluid velocity field.',
    outcome: [
      'Understand the position and velocity texture ping-pong loop.',
      'Know why particles receive the fluid texture rather than the whole simulation object.',
      'Tune spring, damping, drag, and flow response for stable motion.',
    ],
    mentalModel:
      'The magic happens in two parts: first, a massive GPGPU swarm uses the fluid vector field for physical acceleration (springs, drag, and momentum). Second, the particles are rendered as thick, volumetric liquid droplets with procedural Phong shading, specular highlights, and color dispersion.',
    implementation: [
      {
        title: 'Initialize particle state textures',
        body: 'Each particle has a home position, current position, and current velocity. The update pass reads old state and writes new state.',
      },
      {
        title: 'Feed the fluid velocity texture',
        body: 'The particle component should accept a Texture or node input so it stays reusable with other vector fields.',
      },
      {
        title: 'Render billboards from the latest state',
        body: 'The render pass reads the current position texture and draws points or instanced quads.',
      },
    ],
    parameters: [
      {
        name: 'spring',
        role: 'Pull back toward the particle home position.',
        tune: 'Raise it for a tighter sheet. Lower it for looser ink-like drift.',
      },
      {
        name: 'zeta',
        role: 'Damping ratio for the spring response.',
        tune: 'Near 1 is controlled. Lower values overshoot, higher values feel heavy.',
      },
      {
        name: 'flowStrength',
        role: 'How much fluid velocity becomes particle acceleration.',
        tune: 'Raise for strong cursor influence. Lower when particles should mostly keep their form.',
      },
      {
        name: 'dragLin + dragQuad',
        role: 'Velocity damping in the particle simulation.',
        tune: 'Use linear drag for general settling and quadratic drag to catch fast spikes.',
      },
    ],
    sourceFocus: [
      'Particle state texture creation.',
      'The step call that receives fluid velocity.',
      'Spring and damping controls.',
      'Point or billboard render material.',
    ],
    productionNotes: [
      'Art Direction: To make the liquid droplets look expensive, pair them with NormalBlending, a deep contrasting background, and increase the vibrance parameter to make the specular highlights pop.',
      'Keep the particle component decoupled from FluidSimulation.',
      'Use aMax and maxFlowSpeed clamps before increasing flowStrength.',
      'A flat sheet is the best starting point for typography, grids, and image particles.',
    ],
  },
  'particles-3d': {
    focus: 'Project 3D particles into the screen-space fluid field, then convert sampled flow back into world motion.',
    outcome: [
      'Understand why camera matrices are required.',
      'Map 2D fluid motion into cameraRight and cameraUp world directions.',
      'Tune depth lift and side variation without losing the particle volume.',
    ],
    mentalModel:
      'The fluid is a 2D screen-space field. A 3D particle first projects itself onto the screen to sample the field, then converts screen flow into world-space acceleration.',
    implementation: [
      {
        title: 'Project world position to fluid UV',
        body: 'The update uses viewMatrix and projectionMatrix to find which fluid pixel sits behind each particle.',
      },
      {
        title: 'Convert screen flow to world axes',
        body: 'flow.x maps to cameraRight and flow.y maps to cameraUp. That is why camera vectors are passed every frame.',
      },
      {
        title: 'Add depth behavior separately',
        body: 'Depth lift and attenuation are art-direction controls. They should not be mixed with the basic screen-flow conversion.',
      },
    ],
    parameters: [
      {
        name: 'viewMatrix + projectionMatrix',
        role: 'Project particle positions into screen space for fluid sampling.',
        tune: 'Update them after camera resize and before the particle step.',
      },
      {
        name: 'cameraRight + cameraUp',
        role: 'World directions that correspond to screen X and screen Y.',
        tune: 'Read them from camera.matrixWorld each frame.',
      },
      {
        name: 'depthLift',
        role: 'Extra motion along the camera depth or object depth direction.',
        tune: 'Use lightly. It adds dimensionality but can flatten the volume if too strong.',
      },
      {
        name: 'sideVariation',
        role: 'Per-particle variation for lateral response.',
        tune: 'Raise for a more organic cloud. Lower for clean spherical motion.',
      },
    ],
    sourceFocus: [
      'Camera matrix and camera axis extraction.',
      'Projection from 3D position to fluid UV.',
      'World-space acceleration from screen-space flow.',
      'Depth lift, rotation, and attenuation controls.',
    ],
    productionNotes: [
      'Always update camera projection after resize before stepping the particles.',
      'If particles react in the wrong direction, check cameraRight and cameraUp first.',
      'Keep flowThreshold above background noise to prevent constant low-level buzzing.',
    ],
  },
  combined: {
    focus: 'Combine the main TSL effect families in one WebGPU scene for composition testing.',
    outcome: [
      'See how overlay, distortion, and particles share the same solver.',
      'Understand why one fluid step can feed multiple visual outputs.',
      'Use the demo as a regression surface for TSL composition changes.',
    ],
    mentalModel:
      'Combined is not a beginner integration. It is a composition harness: one fluid simulation, several consumers, and a RenderPipeline that decides how the final frame is assembled.',
    implementation: [
      {
        title: 'Step the shared solver once',
        body: 'Every effect reads from the same latest fluid output. Do not create separate fluid simulations for each layer.',
      },
      {
        title: 'Compose nodes in one pipeline',
        body: 'The TSL output graph can combine scene color, overlay tint, distortion, and particle rendering without leaving the WebGPU path.',
      },
      {
        title: 'Use controls as diagnostics',
        body: 'The full controls expose interactions between styles. They are useful for checking whether a change breaks one family while another still works.',
      },
    ],
    parameters: [
      {
        name: 'effect mix controls',
        role: 'Balance overlay, distortion, and particle visibility.',
        tune: 'Adjust one layer at a time. If everything is bright, lower overlay before weakening the solver.',
      },
      {
        name: 'profile',
        role: 'Baseline simulation resolution and cost.',
        tune: 'Use balanced for normal development and quality only when capturing or stress testing.',
      },
      {
        name: 'time',
        role: 'Shared clock for animated palettes, caustics, and procedural movement.',
        tune: 'Use one frame clock so layers remain in sync.',
      },
      {
        name: 'background controls',
        role: 'Visual contrast surface for checking blend modes and readability.',
        tune: 'Test against both dark and bright backgrounds before shipping a preset.',
      },
    ],
    sourceFocus: [
      'RenderPipeline output construction.',
      'Shared solver step and shared fluid nodes.',
      'Layer ordering and intensity controls.',
      'Background and diagnostic controls.',
    ],
    productionNotes: [
      'Use this page to test composition, not to teach the smallest integration.',
      'Keep each effect layer independently tunable.',
      'When debugging, disable layers until only the broken path remains.',
    ],
  },
  mega: {
    focus: 'Turn the landing-page hero effect into a centered, tunable WebGPU morphing particle demo.',
    outcome: [
      'See how one morphing GPGPU particle system can reuse the 3D particle fluid response.',
      'Understand why the particle model matrix must be passed when the sculpture is scaled.',
      'Tune hero defaults such as Art Ink overlay, simple distortion, morph timing, and spring physics.',
    ],
    mentalModel:
      'Mega is the hero scene without page typography: a centered particle sculpture morphs through geometric and text targets while the same fluid field drives both particle motion and post-processing.',
    implementation: [
      {
        title: 'Generate morph destinations',
        body: 'The particle helper builds sphere, tetrahedron, trefoil, TSL, and GL/SL target buffers, then uploads an interpolated destination texture every frame.',
      },
      {
        title: 'Keep particles centered in world space',
        body: 'Resize maps the visible camera height to a stable particle scale, so the sculpture stays centered instead of following a DOM text column.',
      },
      {
        title: 'Compose like the hero',
        body: 'The scene pass is distorted first and then receives the Art Ink overlay, matching the hero defaults while still exposing the Combined-style controls.',
      },
    ],
    parameters: [
      {
        name: 'holdSeconds + morphSeconds',
        role: 'Controls how long each target shape rests and how long the transition takes.',
        tune: 'Use longer holds for documentation capture. Shorten morph duration only after the spring response feels stable.',
      },
      {
        name: 'modelMatrix',
        role: 'Projects scaled particle positions into the correct screen-space fluid UVs.',
        tune: 'Pass it every frame after position, scale, and rotation are updated.',
      },
      {
        name: 'spring + zeta',
        role: 'Keeps particles readable while the morph target and fluid forces compete.',
        tune: 'Start from the 3D particle defaults. Lower spring only when you intentionally want loose drift.',
      },
      {
        name: 'overlay + distortion',
        role: 'Adds the hero post-processing layer around the particle scene.',
        tune: 'Art Ink opacity and vibrance are the first controls to adjust before changing solver strength.',
      },
    ],
    sourceFocus: [
      'MorphFlowParticles target generation and setDestinationData().',
      'The resize path that derives particle scale from camera viewport height.',
      'The per-frame order: sync params, update mesh transform, step fluid, step particles, render pipeline.',
      'The pipeline output: simpleDistortion followed by fluidOverlay.',
    ],
    productionNotes: [
      'Use this page for hero tuning without DOM text masking layout bugs.',
      'Keep reflect walls disabled when matching the landing-page feel.',
      'If fluid influence appears offset, inspect modelMatrix before changing force parameters.',
    ],
  },
}

export function getDemoTutorialPath(entry: ExampleEntry): string {
  return `/tutorials/${entry.slug}/`
}

export function getDemoTutorial(entry: ExampleEntry): DemoTutorial {
  const engine = engineCopy[entry.engine]
  const level = levelCopy[entry.level]
  const base = caseTutorials[entry.caseId]

  return {
    title: `${entry.shortTitle}: ${engine.label} ${level.label} walkthrough`,
    description: `${entry.cardDescription} This walkthrough explains what the demo is doing, which library outputs it uses, and which parameters matter.`,
    section: `${formatEngine(entry.engine)} ${formatLevel(entry.level)}`,
    badge:
      entry.caseId === 'combined'
        ? 'Composition demo'
        : entry.caseId === 'mega'
          ? 'Hero demo'
          : 'Demo walkthrough',
    intro: `${level.intent} It uses the ${engine.label} path from \`${engine.importPath}\`, where the effect is built with ${engine.renderPath}`,
    focus: base.focus,
    outcome: base.outcome,
    mentalModel: `${base.mentalModel} In this variant, the relevant fluid output is ${engine.output}`,
    implementation: [
      ...base.implementation,
      {
        title: `${level.label} scope`,
        body: level.implementation,
      },
    ],
    parameters: base.parameters,
    sourceFocus: base.sourceFocus,
    productionNotes: base.productionNotes,
    snippet: getSnippet(entry),
    relatedGuideHref: entry.guideHref,
    relatedGuideLabel: entry.guideLabel,
  }
}

function getSnippet(entry: ExampleEntry): string {
  const engine = engineCopy[entry.engine]

  if (entry.caseId === 'helloworld') {
    return `import { attachPointerSplats, FluidSimulation } from '${engine.importPath}'

const fluid = new FluidSimulation(renderer, {
  profile: 'balanced',
  splatRadius: 0.001,
  splatForce: 6,
})

attachPointerSplats(renderer.domElement, fluid)

renderer.setAnimationLoop(() => {
  fluid.step(clock.getDelta())
  renderFluidDensity(fluid)
})`
  }

  if (entry.caseId === 'overlay') {
    return entry.engine === 'glsl'
      ? `import { FluidSimulation, OilOverlayPass } from 'three-fluid-fx'

const fluid = new FluidSimulation(renderer)
fluid.enableDye = true

const overlay = new OilOverlayPass(fluid)
overlay.intensity = 1.2
overlay.vibrance = 0.35

composer.addPass(renderScene)
composer.addPass(overlay)`
      : `import { FluidSimulation, oilOverlay } from 'three-fluid-fx/tsl'

const fluid = new FluidSimulation(renderer)
fluid.enableDye = true

pipeline.outputNode = oilOverlay(
  sceneNode,
  fluid.densityNode,
  fluid.dyeNode,
  fluid.velocityNode,
  { intensity: 1.2, vibrance: 0.35 },
)`
  }

  if (entry.caseId === 'distortion') {
    return entry.engine === 'glsl'
      ? `import { FluidSimulation, SimpleDistortionPass } from 'three-fluid-fx'

const fluid = new FluidSimulation(renderer)
const distortion = new SimpleDistortionPass(fluid)
distortion.intensity = 0.08

composer.addPass(renderScene)
composer.addPass(distortion)`
      : `import { FluidSimulation, simpleDistortion } from 'three-fluid-fx/tsl'

const fluid = new FluidSimulation(renderer)

pipeline.outputNode = simpleDistortion(
  sceneNode,
  fluid.densityNode,
  0.08,
)`
  }

  if (entry.caseId === 'particles-trefoil') {
    return entry.engine === 'glsl'
      ? `const particles = createTrefoilParticles({
  velocityField: fluid.velocityTexture,
  count: 4000,
  displacement: 0.34,
})

renderer.setAnimationLoop(() => {
  fluid.step(dt)
  particles.update({ elapsed, dragStrength, maxFlowSpeed })
  renderer.render(scene, camera)
})`
      : `const particles = createTrefoilParticles(fluid.velocityNode, {
  count: 4000,
  displacement: 0.34,
})

renderer.setAnimationLoop(() => {
  fluid.step(dt)
  particles.update({ elapsed, dragStrength, maxFlowSpeed })
  renderer.render(scene, camera)
})`
  }

  if (entry.caseId === 'particles-2d' || entry.caseId === 'particles-3d') {
    return `fluid.step(dt)

particles.step({
  dt,
  velocityField: ${entry.engine === 'glsl' ? 'fluid.velocityTexture' : 'fluid.velocityNode'},
  viewMatrix: camera.matrixWorldInverse,
  projectionMatrix: camera.projectionMatrix,
  cameraRight,
  cameraUp,
  spring,
  zeta,
  flowStrength,
  maxFlowSpeed,
})`
  }

  if (entry.caseId === 'mega') {
    return `const particles = new MorphFlowParticles(renderer, {
  size: 64,
  holdSeconds: 6.5,
  morphSeconds: 4.8,
})

pipeline.outputNode = fluidOverlay(
  'artInk',
  simpleDistortion(scenePass, fluid.densityNode, 0.45),
  fluid.densityNode,
  fluid.dyeNode,
  fluid.velocityNode,
  { opacity: 0.5, vibrance: 0.5 },
)

renderer.setAnimationLoop(() => {
  fluid.step(dt)
  particles.step({ ...particleForces, modelMatrix: particles.mesh.matrixWorld }, morphTime)
  pipeline.render()
})`
  }

  return `const fluid = new FluidSimulation(renderer, { profile: 'balanced' })
fluid.enableDye = true

pipeline.outputNode = composeCombinedScene({
  sceneNode,
  fluid,
  overlayControls,
  distortionControls,
  particleControls,
})

renderer.setAnimationLoop(() => {
  fluid.step(dt)
  pipeline.render()
})`
}
