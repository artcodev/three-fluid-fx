import { type WebGLRenderTarget } from 'three';
import { FluidEffectPass } from '../FluidEffectPass.js';
import type { FluidSimulation } from '../../simulation/FluidSimulation.js';
/** Iridescent oil-slick distortion — each RGB channel shifted by its own velocity components. */
export declare class ChromaticDistortionPass extends FluidEffectPass {
    private readonly fluid;
    intensity: number;
    constructor(fluid: FluidSimulation);
    protected updateUniforms(readBuffer: WebGLRenderTarget): void;
}
