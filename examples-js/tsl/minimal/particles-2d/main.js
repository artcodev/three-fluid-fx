import { runMinimalParticles } from '../shared/particlesShared'
await runMinimalParticles({
  mode: 'plane2d',
  particleSize: 80,
  cameraZ: 5.2,
  pointSize: 6,
  rotationSpeed: 0.07,
  curlStrength: 0.2,
  flowStrength: 1,
  depthLift: 0,
  flowThreshold: 40,
  maxFlowSpeed: 20,
  perpendicularAngle: 0,
  sideVariation: 0,
  depthAttenuationScale: 1,
})
