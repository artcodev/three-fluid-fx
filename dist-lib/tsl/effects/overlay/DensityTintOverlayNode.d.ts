import { TempNode, type TextureNode } from 'three/webgpu';
import type { Node, NodeBuilder } from 'three/webgpu';
export interface DensityTintOverlayOptions {
    /** Density-to-tint multiplier. Defaults to the GLSL pass value. */
    intensity?: number | Node;
    /** RGB tint added proportionally to fluid density. Defaults to teal. */
    tint?: Node;
}
/**
 * Subtle additive tint by fluid density. TSL counterpart of the GLSL
 * `DensityTintOverlayPass`: `scene += tint * density.b * intensity`.
 */
export declare class DensityTintOverlayNode extends TempNode {
    static get type(): string;
    readonly sceneTexture: TextureNode;
    readonly fluidTexture: TextureNode;
    readonly intensityNode: Node;
    readonly tintNode: Node;
    constructor(sceneTexture: TextureNode, fluidTexture: TextureNode, intensityNode: Node, tintNode: Node);
    setup(_builder: NodeBuilder): Node;
}
export declare const densityTintOverlay: (sceneNode: Node, fluidNode: Node, options?: DensityTintOverlayOptions) => Node;
