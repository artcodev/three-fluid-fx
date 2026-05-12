import { type WebGLRenderTarget } from 'three';
import { FluidEffectPass } from '../FluidEffectPass.js';
import type { FluidSimulation } from '../../simulation/FluidSimulation.js';
/** Per-stroke hue-cycling dye, soft 5-tap bloom, additive composite. */
export declare class ArtInkOverlayPass extends FluidEffectPass {
    private readonly fluid;
    intensity: number;
    vibrance: number;
    constructor(fluid: FluidSimulation);
    protected updateUniforms(readBuffer: WebGLRenderTarget): void;
}
