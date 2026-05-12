import { type WebGLRenderTarget } from 'three';
import { FluidEffectPass } from '../FluidEffectPass.js';
import type { FluidSimulation } from '../../simulation/FluidSimulation.js';
/** White cigarette-smoke wash driven by per-stroke dye intensity. */
export declare class SmokeOverlayPass extends FluidEffectPass {
    private readonly fluid;
    intensity: number;
    constructor(fluid: FluidSimulation);
    protected updateUniforms(readBuffer: WebGLRenderTarget): void;
}
