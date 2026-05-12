import { type WebGLRenderTarget } from 'three';
import { FluidEffectPass } from '../FluidEffectPass.js';
import type { FluidSimulation } from '../../simulation/FluidSimulation.js';
/** Multi-tap density glow shaded by an animated ember/mint/cream palette — reads like an oil slick. */
export declare class OilOverlayPass extends FluidEffectPass {
    private readonly fluid;
    intensity: number;
    time: number;
    vibrance: number;
    constructor(fluid: FluidSimulation);
    protected updateUniforms(readBuffer: WebGLRenderTarget): void;
}
