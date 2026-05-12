import { type WebGLRenderTarget } from 'three';
import { FluidEffectPass } from '../FluidEffectPass.js';
import type { FluidSimulation } from '../../simulation/FluidSimulation.js';
/** Classic FluidCursor-style rainbow: density glow + back-traced position-driven hue. */
export declare class ColorfulOverlayPass extends FluidEffectPass {
    private readonly fluid;
    intensity: number;
    time: number;
    vibrance: number;
    constructor(fluid: FluidSimulation);
    protected updateUniforms(readBuffer: WebGLRenderTarget): void;
}
