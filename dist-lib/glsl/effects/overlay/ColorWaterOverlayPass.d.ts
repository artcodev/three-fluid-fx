import { type WebGLRenderTarget } from 'three';
import { FluidEffectPass } from '../FluidEffectPass.js';
import type { FluidSimulation } from '../../simulation/FluidSimulation.js';
/** Watercolour wash — translucent alpha-mix tint plus a soft scene-tinted glow. */
export declare class ColorWaterOverlayPass extends FluidEffectPass {
    private readonly fluid;
    intensity: number;
    vibrance: number;
    constructor(fluid: FluidSimulation);
    protected updateUniforms(readBuffer: WebGLRenderTarget): void;
}
