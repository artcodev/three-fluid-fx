import { runMinimalParticles } from '../shared/particlesShared'
await runMinimalParticles({
  mode: 'cloud3d',
  particleSize: 64,
  cameraZ: 6.4,
  pointSize: 10,
  rotationSpeed: 0.07,
  curlStrength: 0.05,
  flowStrength: 1.05,
  depthLift: 0.95,
  flowThreshold: 50,
  maxFlowSpeed: 12,
  perpendicularAngle: 1.25,
  sideVariation: 1,
  depthAttenuationScale: 2,
})
