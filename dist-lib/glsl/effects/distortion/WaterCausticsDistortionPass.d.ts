import { type WebGLRenderTarget } from 'three';
import { FluidEffectPass } from '../FluidEffectPass.js';
import type { FluidSimulation } from '../../simulation/FluidSimulation.js';
/** Water surface refraction + procedural caustic web, masked by local fluid activity. */
export declare class WaterCausticsDistortionPass extends FluidEffectPass {
    private readonly fluid;
    intensity: number;
    /** Animation time, in seconds. The caustic web evolves continuously with this. */
    time: number;
    constructor(fluid: FluidSimulation);
    protected updateUniforms(readBuffer: WebGLRenderTarget): void;
}
