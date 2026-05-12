/**
 * Structural shape of any object `attachPointerSplats` will write splats
 * into. Both the GLSL and TSL `FluidSimulation` implementations satisfy
 * this interface, which lets a single pointer-splat helper drive either
 * pipeline without depending on a concrete class.
 */
export interface SplatTarget {
    splatForce: number;
    addSplat(x01: number, y01: number, dx: number, dy: number, options?: {
        dyeColor?: [number, number, number];
    }): void;
}
export interface AttachPointerSplatsOptions {
    /**
     * When true, splats carry a `dyeColor` (HSV-randomised) into `addSplat`.
     * The fluid sim must have `enableDye` on for the colour to accumulate.
     * The colour rotates *during* a drag (PavelDoGreat behaviour), so a single
     * stroke leaves a multi-hue trail. Defaults to false.
     */
    coloredStrokes?: boolean;
    /**
     * Hue rotations per second during a drag, when `coloredStrokes` is on.
     * PavelDoGreat ships 10 (a fresh colour every ~0.1 s). Defaults to 10.
     */
    colorUpdateSpeed?: number;
    /**
     * Per-event override for the dye colour. Receives motion delta in CSS px
     * and the event time in ms. Return RGB to write that colour into the dye
     * FBO; return `undefined` to fall back to `coloredStrokes` HSV cycling
     * (or to skip dye if `coloredStrokes` is also off).
     *
     * Use for motion-direction palettes (dreamers-style: red ∝ |dx|, blue ∝
     * |dy|) or any deterministic function of the gesture instead of the
     * default rainbow timer. The colour is written verbatim — scale to the
     * ~0.3 amplitude that other dye-driven overlays in this lib are tuned
     * against if you want to share their gain calibration.
     */
    colorize?: (dx: number, dy: number, timeMs: number) => [number, number, number] | undefined;
}
/**
 * Attaches pointer listeners to `element` and pushes splats into `fluid`.
 *
 * Splat radius and force are read from `fluid.splatRadius` / `fluid.splatForce`
 * on every event — set them in the FluidSimulation constructor or write them
 * any time at runtime; no separate options object is needed here.
 */
export declare function attachPointerSplats(element: HTMLElement, fluid: SplatTarget, options?: AttachPointerSplatsOptions): () => void;
