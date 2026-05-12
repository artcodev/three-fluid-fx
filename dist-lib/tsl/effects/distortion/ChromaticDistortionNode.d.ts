import { TempNode, type TextureNode } from 'three/webgpu';
import type { Node, NodeBuilder, NodeFrame } from 'three/webgpu';
/**
 * Iridescent chromatic-distortion effect — each RGB channel is offset by a
 * different combination of fluid-velocity components, producing the oil-slick
 * spectral spread seen in the GLSL `ChromaticDistortionPass`.
 *
 * **Sampling pattern (matches the GLSL pass):**
 * 1. 5-tap box blur of the fluid texture (RG=velocity, B=density). Raw
 *    velocity is choppy across vortex-cell boundaries; the blur hides them.
 * 2. Density^1.2 falloff so the effect blends into untouched regions instead
 *    of clipping at a hard mask edge.
 * 3. Per-channel UV offsets: red gets `(+chroma.x, +chroma.y)`,
 *    green `(-chroma.x, +chroma.y)`, blue `(-chroma.x, -chroma.y)`.
 *
 * Internal `*Node` class; the public API is the {@link chromaticDistortion}
 * factory function that mirrors the three.js TSL convention
 * (`bloom()`, `dotScreen()`, `chromaticAberration()`).
 */
export declare class ChromaticDistortionNode extends TempNode {
    static get type(): string;
    readonly sceneTexture: TextureNode;
    readonly fluidTexture: TextureNode;
    readonly intensityNode: Node;
    private readonly _invSize;
    constructor(sceneTexture: TextureNode, fluidTexture: TextureNode, intensityNode: Node);
    updateBefore(_frame: NodeFrame): undefined;
    setup(_builder: NodeBuilder): Node;
}
/**
 * Apply the iridescent chromatic distortion to `sceneNode`, driven by the
 * `fluidNode` velocity/density texture.
 *
 * @param sceneNode The scene/colour input — the texture being distorted.
 * @param fluidNode Fluid output texture (`.rg` = velocity, `.b` = density).
 * @param intensity Scalar gain on the chroma offset; defaults to 1.
 *
 * @example
 * ```ts
 * import { chromaticDistortion } from 'three-fluid-fx/tsl'
 * const out = chromaticDistortion(scenePassTexture, fluid.densityNode, 0.7)
 * pipeline.outputNode = out
 * ```
 */
export declare const chromaticDistortion: (sceneNode: Node, fluidNode: Node, intensity?: number | Node) => Node;
