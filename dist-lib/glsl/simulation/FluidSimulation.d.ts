import { WebGLRenderer } from 'three';
import type { Texture } from 'three';
/**
 * Resolution & quality presets. Pick `performance` for weak GPUs / mobile,
 * `balanced` for typical desktop, `quality` for high-end / presentation.
 *
 *   performance: 128² sim / 256² dye / 6  Jacobi iters  → cheapest, slightly grainy
 *   balanced:    256² sim / 512² dye / 12 Jacobi iters  → default
 *   quality:     384² sim / 1024² dye / 20 Jacobi iters  → cleanest, ~6× cost vs perf
 *
 * Individual options on `FluidSimulationOptions` always override profile values.
 */
export declare const FLUID_PROFILES: {
    readonly performance: {
        readonly simResolution: 128;
        readonly dyeResolution: 256;
        readonly pressureIterations: 6;
    };
    readonly balanced: {
        readonly simResolution: 256;
        readonly dyeResolution: 512;
        readonly pressureIterations: 12;
    };
    readonly quality: {
        readonly simResolution: 384;
        readonly dyeResolution: 1024;
        readonly pressureIterations: 20;
    };
};
export type FluidProfile = keyof typeof FLUID_PROFILES;
export interface FluidSimulationOptions {
    /** Resolution & iterations preset. Default `balanced`. */
    profile?: FluidProfile;
    simResolution?: number;
    dyeResolution?: number;
    pressureIterations?: number;
    densityDissipation?: number;
    velocityDissipation?: number;
    pressureDissipation?: number;
    curlStrength?: number;
    splatRadius?: number;
    splatForce?: number;
    baseDelta?: number;
    /**
     * Per-step decay for the optional dye FBO. Falls back to `densityDissipation`
     * when not set — they share the same semantics, but giving dye its own
     * slider lets a watercolour-style overlay keep long colour trails while the
     * physics-driving density field dissipates faster.
     */
    dyeDissipation?: number;
    /** Vorticity confinement (Fedkiw 2001). Default false — softer FluidCursor-style waves. */
    enableVorticity?: boolean;
    /** BFECC advection (Back and Forth Error Compensation). Sharper, ~5× cost in advect. Default true. */
    bfecc?: boolean;
    /**
     * No-flow-through-walls (reflection) boundary in the divergence pass.
     * Default true — flow bounces off screen edges (PavelDoGreat behaviour).
     * Set false for "open" boundaries where flow leaves the screen and doesn't
     * come back (FluidCursor / mofu behaviour).
     */
    reflectWalls?: boolean;
}
export interface FluidSplatOptions {
    radius?: number;
    color?: [number, number, number];
    /**
     * Per-stroke dye colour (RGB, additive). When provided AND `enableDye`
     * is true, the splat also writes this colour into the separate dye FBO,
     * which is advected by velocity and exposed via `dyeTexture`. Use for
     * PavelDoGreat-style coloured strokes; leave undefined for ordinary use.
     */
    dyeColor?: [number, number, number];
}
export declare class FluidSimulation {
    readonly simResolution: number;
    readonly dyeResolution: number;
    pressureIterations: number;
    densityDissipation: number;
    velocityDissipation: number;
    pressureDissipation: number;
    curlStrength: number;
    splatRadius: number;
    splatForce: number;
    baseDelta: number;
    enableVorticity: boolean;
    bfecc: boolean;
    reflectWalls: boolean;
    private readonly renderer;
    private readonly scene;
    private readonly camera;
    private readonly geometry;
    private readonly mesh;
    private readonly splatScene;
    private readonly splatGeometry;
    private readonly splatMesh;
    private readonly velocity;
    private readonly density;
    private readonly dye;
    private readonly pressure;
    private readonly divergence;
    private readonly curl;
    /**
     * Toggle the optional dye channel — a separate RGB FBO advected by velocity.
     * Off by default to keep ordinary examples free of the extra advect pass.
     * Turn on when using `addSplat({ dyeColor })` and `dyeTexture`.
     */
    enableDye: boolean;
    /** Per-step decay of the dye FBO. Mirrors `densityDissipation` semantics. */
    dyeDissipation: number;
    private readonly clearMaterial;
    private readonly splatMaterial;
    private readonly curlMaterial;
    private readonly vorticityMaterial;
    private readonly divergenceMaterial;
    private readonly pressureMaterial;
    private readonly gradientSubtractMaterial;
    private readonly advectVelocityMaterial;
    private readonly advectDensityMaterial;
    private readonly advectDyeMaterial;
    private readonly splats;
    private viewportWidth;
    private viewportHeight;
    private simWidth;
    private simHeight;
    private dyeWidth;
    private dyeHeight;
    constructor(renderer: WebGLRenderer, options?: FluidSimulationOptions);
    /**
     * Velocity field after the full step (post-advection). This is the value
     * that drives subsequent simulation; use it for particle systems and any
     * downstream physics.
     */
    get velocityTexture(): Texture;
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
    get velocityProjectedTexture(): Texture;
    get densityTexture(): Texture;
    /**
     * Advected per-stroke dye field. RGB stores the colour written by splats
     * with `dyeColor`. Only updated when `enableDye` is on.
     */
    get dyeTexture(): Texture;
    resize(width: number, height: number): void;
    addSplat(x: number, y: number, dx: number, dy: number, options?: FluidSplatOptions): void;
    step(deltaSeconds: number): void;
    dispose(): void;
    private createMaterial;
    private blit;
    private applySplat;
}
