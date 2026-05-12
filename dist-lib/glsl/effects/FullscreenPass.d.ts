import { ShaderMaterial, WebGLRenderer, WebGLRenderTarget } from 'three';
export declare const FULLSCREEN_VERTEX = "\nvarying vec2 vUv;\n\nvoid main() {\n  vUv = position.xy * 0.5 + 0.5;\n  gl_Position = vec4(position.xy, 0.0, 1.0);\n}\n";
export declare class FullscreenPass {
    readonly material: ShaderMaterial;
    private readonly scene;
    private readonly camera;
    private readonly geometry;
    private readonly mesh;
    constructor(material: ShaderMaterial);
    render(renderer: WebGLRenderer, target?: WebGLRenderTarget | null): void;
    dispose(): void;
}
