export const asNode = (value) => value
export const asTsl = (value) => value
export function setPipelineOutput(pipeline, outputNode) {
  pipeline.outputNode = outputNode
  pipeline.needsUpdate = true
}
export function setMaterialOutput(material, outputNode) {
  material.outputNode = outputNode
}
export function setMaterialPosition(material, positionNode) {
  material.positionNode = positionNode
}
