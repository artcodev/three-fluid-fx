import { TempNode, type TextureNode } from 'three/webgpu';
import type { Node, NodeBuilder } from 'three/webgpu';
export declare class SimpleDistortionNode extends TempNode {
    static get type(): string;
    readonly sceneTexture: TextureNode;
    readonly fluidTexture: TextureNode;
    readonly intensityNode: Node;
    constructor(sceneTexture: TextureNode, fluidTexture: TextureNode, intensityNode: Node);
    setup(_builder: NodeBuilder): Node;
}
/**
 * Apply a plain velocity-driven UV warp to `sceneNode`. Cheapest distortion
 * variant; matches `SimpleDistortionPass` from the GLSL pipeline.
 *
 * @param sceneNode The scene/colour input being distorted.
 * @param fluidNode Fluid texture (`.rg` = velocity).
 * @param intensity Scalar gain on the warp; defaults to 1.
 */
export declare const simpleDistortion: (sceneNode: Node, fluidNode: Node, intensity?: number | Node) => Node;
