import { Color, type WebGLRenderTarget } from 'three';
import { FluidEffectPass } from '../FluidEffectPass.js';
import type { FluidSimulation } from '../../simulation/FluidSimulation.js';
/** Directional wake — sharp leading edge, long fading tail in user-picked cursor colour. */
export declare class TrailOverlayPass extends FluidEffectPass {
    private readonly fluid;
    intensity: number;
    vibrance: number;
    cursorColor: Color;
    constructor(fluid: FluidSimulation);
    protected updateUniforms(readBuffer: WebGLRenderTarget): void;
}
