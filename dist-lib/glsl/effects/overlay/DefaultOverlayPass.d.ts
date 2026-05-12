import { Color, type WebGLRenderTarget } from 'three';
import { FluidEffectPass } from '../FluidEffectPass.js';
import type { FluidSimulation } from '../../simulation/FluidSimulation.js';
/** Cursor-tinted dye haze with a smooth core/rim gradient through the stroke body. */
export declare class DefaultOverlayPass extends FluidEffectPass {
    private readonly fluid;
    intensity: number;
    vibrance: number;
    cursorColor: Color;
    constructor(fluid: FluidSimulation);
    protected updateUniforms(readBuffer: WebGLRenderTarget): void;
}
