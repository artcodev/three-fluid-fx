import { TempNode, type TextureNode } from 'three/webgpu';
import type { Node, NodeBuilder } from 'three/webgpu';
export declare class RGBShiftDistortionNode extends TempNode {
    static get type(): string;
    readonly sceneTexture: TextureNode;
    readonly fluidTexture: TextureNode;
    readonly intensityNode: Node;
    constructor(sceneTexture: TextureNode, fluidTexture: TextureNode, intensityNode: Node);
    setup(_builder: NodeBuilder): Node;
}
/**
 * Apply a density-driven chromatic R/B split to `sceneNode` along the
 * normalised flow direction. Matches `RGBShiftDistortionPass` from the GLSL
 * pipeline.
 *
 * @param sceneNode The scene/colour input being distorted.
 * @param fluidNode Fluid texture (`.rg` = velocity, `.b` = density).
 * @param intensity Scalar gain on the chroma split; defaults to 1.
 */
export declare const rgbShiftDistortion: (sceneNode: Node, fluidNode: Node, intensity?: number | Node) => Node;
