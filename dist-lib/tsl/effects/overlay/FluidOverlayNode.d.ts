import { TempNode, type TextureNode } from 'three/webgpu';
import type { Node, NodeBuilder } from 'three/webgpu';
export type FluidOverlayStyle = 'default' | 'volumeCursor' | 'trail' | 'oil' | 'velocity' | 'colorful' | 'rainbowFish' | 'glaze' | 'burn' | 'smoke' | 'artInk' | 'rainbowInk' | 'colorWater' | 'liquidLens';
export interface FluidOverlayOptions {
    intensity?: number | Node;
    time?: number | Node;
    texel?: Node;
    cursorColor?: Node;
    vibrance?: number | Node;
    velocityScale?: number | Node;
    opacity?: number | Node;
}
interface FluidOverlayNodeOptions {
    intensity: Node;
    time: Node;
    texel: Node;
    cursorColor: Node;
    vibrance: Node;
    velocityScale: Node;
    opacity: Node;
}
export declare class FluidOverlayNode extends TempNode {
    static get type(): string;
    readonly style: FluidOverlayStyle;
    readonly sceneTexture: TextureNode;
    readonly densityTexture: TextureNode;
    readonly dyeTexture: TextureNode;
    readonly velocityTexture: TextureNode;
    readonly intensityNode: Node;
    readonly timeNode: Node;
    readonly texelNode: Node;
    readonly cursorColorNode: Node;
    readonly vibranceNode: Node;
    readonly velocityScaleNode: Node;
    readonly opacityNode: Node;
    constructor(style: FluidOverlayStyle, sceneTexture: TextureNode, densityTexture: TextureNode, dyeTexture: TextureNode, velocityTexture: TextureNode, options: FluidOverlayNodeOptions);
    setup(_builder: NodeBuilder): Node;
}
export declare const fluidOverlay: (style: FluidOverlayStyle, sceneNode: Node, densityNode: Node, dyeNode: Node, velocityNode: Node, options?: FluidOverlayOptions) => Node;
export declare const defaultOverlay: (sceneNode: Node, densityNode: Node, dyeNode: Node, velocityNode: Node, options?: FluidOverlayOptions) => Node;
export declare const volumeCursorOverlay: (sceneNode: Node, densityNode: Node, dyeNode: Node, velocityNode: Node, options?: FluidOverlayOptions) => Node;
export declare const trailOverlay: (sceneNode: Node, densityNode: Node, dyeNode: Node, velocityNode: Node, options?: FluidOverlayOptions) => Node;
export declare const oilOverlay: (sceneNode: Node, densityNode: Node, dyeNode: Node, velocityNode: Node, options?: FluidOverlayOptions) => Node;
export declare const velocityOverlay: (sceneNode: Node, densityNode: Node, dyeNode: Node, velocityNode: Node, options?: FluidOverlayOptions) => Node;
export declare const colorfulOverlay: (sceneNode: Node, densityNode: Node, dyeNode: Node, velocityNode: Node, options?: FluidOverlayOptions) => Node;
export declare const rainbowFishOverlay: (sceneNode: Node, densityNode: Node, dyeNode: Node, velocityNode: Node, options?: FluidOverlayOptions) => Node;
export declare const glazeOverlay: (sceneNode: Node, densityNode: Node, dyeNode: Node, velocityNode: Node, options?: FluidOverlayOptions) => Node;
export declare const burnOverlay: (sceneNode: Node, densityNode: Node, dyeNode: Node, velocityNode: Node, options?: FluidOverlayOptions) => Node;
export declare const smokeOverlay: (sceneNode: Node, densityNode: Node, dyeNode: Node, velocityNode: Node, options?: FluidOverlayOptions) => Node;
export declare const artInkOverlay: (sceneNode: Node, densityNode: Node, dyeNode: Node, velocityNode: Node, options?: FluidOverlayOptions) => Node;
export declare const rainbowInkOverlay: (sceneNode: Node, densityNode: Node, dyeNode: Node, velocityNode: Node, options?: FluidOverlayOptions) => Node;
export declare const colorWaterOverlay: (sceneNode: Node, densityNode: Node, dyeNode: Node, velocityNode: Node, options?: FluidOverlayOptions) => Node;
export declare const liquidLensOverlay: (sceneNode: Node, densityNode: Node, dyeNode: Node, velocityNode: Node, options?: FluidOverlayOptions) => Node;
export {};
