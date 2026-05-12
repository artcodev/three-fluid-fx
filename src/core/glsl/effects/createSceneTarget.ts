import {
  ClampToEdgeWrapping,
  LinearFilter,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  WebGLRenderTarget,
} from 'three'

export function createSceneTarget(width: number, height: number): WebGLRenderTarget {
  const target = new WebGLRenderTarget(width, height, {
    depthBuffer: true,
    stencilBuffer: false,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    wrapS: ClampToEdgeWrapping,
    wrapT: ClampToEdgeWrapping,
    type: UnsignedByteType,
    format: RGBAFormat,
    generateMipmaps: false,
    samples: 4,
  })
  target.texture.colorSpace = SRGBColorSpace
  return target
}
