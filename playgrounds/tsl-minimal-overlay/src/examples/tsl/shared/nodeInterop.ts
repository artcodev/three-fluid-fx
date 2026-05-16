import type { Node } from 'three/webgpu'

type TslDynamic = any // eslint-disable-line @typescript-eslint/no-explicit-any

interface PipelineOutputTarget {
  outputNode: unknown
  needsUpdate: boolean
}

interface MaterialOutputTarget {
  outputNode: unknown
}

interface MaterialPositionTarget {
  positionNode: unknown
}

export interface UniformValue<T> {
  value: T
}

export const asNode = (value: unknown): Node => value as Node

export const asTsl = <T = TslDynamic>(value: unknown): T => value as T

export function setPipelineOutput(pipeline: PipelineOutputTarget, outputNode: Node): void {
  pipeline.outputNode = outputNode
  pipeline.needsUpdate = true
}

export function setMaterialOutput(material: MaterialOutputTarget, outputNode: Node): void {
  material.outputNode = outputNode
}

export function setMaterialPosition(material: MaterialPositionTarget, positionNode: Node): void {
  material.positionNode = positionNode
}
