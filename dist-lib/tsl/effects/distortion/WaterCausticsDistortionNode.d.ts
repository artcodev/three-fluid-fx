import { TempNode, type TextureNode } from 'three/webgpu';
import type { Node, NodeBuilder, NodeFrame } from 'three/webgpu';
export declare class WaterCausticsDistortionNode extends TempNode {
    static get type(): string;
    readonly sceneTexture: TextureNode;
    readonly fluidTexture: TextureNode;
    readonly intensityNode: Node;
    readonly timeNode: Node;
    private readonly _invSize;
    constructor(sceneTexture: TextureNode, fluidTexture: TextureNode, intensityNode: Node, timeNode: Node);
    updateBefore(_frame: NodeFrame): undefined;
    setup(_builder: NodeBuilder): Node;
}
/**
 * Refraction + procedural caustic web on top of `sceneNode`. Matches
 * `WaterCausticsDistortionPass` from the GLSL pipeline. Pass `time` (seconds)
 * as a TSL number/node so the caustic web evolves continuously.
 *
 * @param sceneNode The scene/colour input being refracted.
 * @param fluidNode Fluid texture (`.rg` = velocity, `.b` = density).
 * @param intensity Scalar gain; defaults to 1.
 * @param time      Animation time in seconds. Use a uniform updated each frame.
 */
export declare const waterCausticsDistortion: (sceneNode: Node, fluidNode: Node, intensity?: number | Node, time?: number | Node) => Node;
