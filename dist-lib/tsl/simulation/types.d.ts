import type { TextureNode } from 'three/webgpu';
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
    dyeDissipation?: number;
    enableVorticity?: boolean;
    bfecc?: boolean;
    reflectWalls?: boolean;
}
export interface FluidSplatOptions {
    radius?: number;
    color?: [number, number, number];
    dyeColor?: [number, number, number];
}
export interface IFluidSimulation {
    splatRadius: number;
    splatForce: number;
    readonly densityNode: TextureNode;
    readonly dyeNode: TextureNode;
    readonly velocityNode: TextureNode;
    readonly pressureNode: TextureNode;
    readonly divergenceNode: TextureNode;
    readonly curlNode: TextureNode;
    resize(width: number, height: number): void;
    addSplat(x01: number, y01: number, dx: number, dy: number, options?: FluidSplatOptions): void;
    step(deltaSeconds: number): void;
    dispose(): void;
}
