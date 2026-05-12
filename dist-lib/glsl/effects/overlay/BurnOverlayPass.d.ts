import { type WebGLRenderTarget } from 'three';
import { FluidEffectPass } from '../FluidEffectPass.js';
import type { FluidSimulation } from '../../simulation/FluidSimulation.js';
/** Ghostly fiery fingers advected along the velocity field, ember-to-flame palette with flicker. */
export declare class BurnOverlayPass extends FluidEffectPass {
    private readonly fluid;
    intensity: number;
    time: number;
    vibrance: number;
    constructor(fluid: FluidSimulation);
    protected updateUniforms(readBuffer: WebGLRenderTarget): void;
}
