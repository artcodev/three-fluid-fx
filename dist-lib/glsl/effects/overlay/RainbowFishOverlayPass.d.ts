import { type WebGLRenderTarget } from 'three';
import { FluidEffectPass } from '../FluidEffectPass.js';
import type { FluidSimulation } from '../../simulation/FluidSimulation.js';
/** Hue from velocity angle, brightness from speed — closed rainbow ring around each vortex. */
export declare class RainbowFishOverlayPass extends FluidEffectPass {
    private readonly fluid;
    intensity: number;
    time: number;
    vibrance: number;
    constructor(fluid: FluidSimulation);
    protected updateUniforms(readBuffer: WebGLRenderTarget): void;
}
