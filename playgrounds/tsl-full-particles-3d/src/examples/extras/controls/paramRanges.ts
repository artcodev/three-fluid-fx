export const SCALE = {
  splatRadius: 1e-4,
  flowThreshold: 1e-3,
} as const

export const RANGES = {
  splatRadius: { min: 0.5, max: 100, step: 0.1 },
  splatForce: { min: 1, max: 18, step: 0.1 },

  pressureIterations: { min: 1, max: 30, step: 1 },
  curlStrength: { min: 0, max: 2, step: 0.01 },
  velocityDissipation: { min: 0.85, max: 1, step: 0.001 },
  densityDissipation: { min: 0.85, max: 1, step: 0.001 },
  pressureDissipation: { min: 0, max: 1, step: 0.01 },

  spring: { min: 0.4, max: 6, step: 0.01 },
  zeta: { min: 0, max: 3, step: 0.01 },
  dragLin: { min: 0, max: 2, step: 0.01 },
  dragQuad: { min: 0, max: 1, step: 0.01 },
  aMax: { min: 1, max: 80, step: 0.5 },
  vMaxScale: { min: 0.1, max: 4, step: 0.01 },

  flowStrength: { min: 0, max: 5, step: 0.01 },
  depthLift: { min: 0, max: 4, step: 0.01 },
  flowThreshold: { min: 0, max: 200, step: 1 },
  maxFlowSpeed: { min: 1, max: 40, step: 0.5 },
  responseGamma: { min: 1, max: 6, step: 0.01 },
  perpendicularAngle: { min: 0, max: 4, step: 0.01 },
  sideVariation: { min: 0, max: 1, step: 0.01 },

  depthAttenuationScale: { min: 0.1, max: 10, step: 0.05 },

  pointSize: { min: 1, max: 16, step: 0.1 },
  intensity: { min: 0, max: 5, step: 0.01 },
  opacity: { min: 0, max: 1, step: 0.01 },
  rotationSpeed: { min: -2, max: 2, step: 0.01 },
} as const
