import { Color, type WebGLRenderTarget } from 'three';
import { FluidEffectPass } from '../FluidEffectPass.js';
import type { FluidSimulation } from '../../simulation/FluidSimulation.js';
/** Subtle additive tint by fluid density — simplest 'fluid cursor' hint. */
export declare class DensityTintOverlayPass extends FluidEffectPass {
    private readonly fluid;
    /** Density-to-tint multiplier. Defaults match the original particle-
     *  displacement composite: `scene += vec3(0.10, 0.42, 0.36) * density * 0.14`,
     *  i.e. a teal tint at 0.14 intensity. */
    intensity: number;
    /** Tint colour added to the scene proportionally to fluid density. */
    color: Color;
    constructor(fluid: FluidSimulation);
    protected updateUniforms(readBuffer: WebGLRenderTarget): void;
}
