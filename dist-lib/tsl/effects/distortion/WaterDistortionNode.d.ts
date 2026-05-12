import { TempNode, type TextureNode } from 'three/webgpu';
import type { Node, NodeBuilder, NodeFrame } from 'three/webgpu';
export declare class WaterDistortionNode extends TempNode {
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
 * Refract `sceneNode` through density-as-height with a per-channel Snell
 * split. Matches `WaterDistortionPass` from the GLSL pipeline.
 *
 * @param sceneNode The scene/colour input being refracted.
 * @param fluidNode Fluid texture (`.b` = density used as height field).
 * @param intensity Scalar gain on the refraction; defaults to 1.
 */
export declare const waterDistortion: (sceneNode: Node, fluidNode: Node, intensity?: number | Node) => Node;
