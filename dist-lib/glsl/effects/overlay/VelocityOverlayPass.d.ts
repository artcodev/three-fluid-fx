import { type WebGLRenderTarget } from 'three';
import { FluidEffectPass } from '../FluidEffectPass.js';
import type { FluidSimulation } from '../../simulation/FluidSimulation.js';
/** Velocity field rendered as RG-coloured glaze additive over the scene. */
export declare class VelocityOverlayPass extends FluidEffectPass {
    private readonly fluid;
    intensity: number;
    constructor(fluid: FluidSimulation);
    protected updateUniforms(readBuffer: WebGLRenderTarget): void;
}
