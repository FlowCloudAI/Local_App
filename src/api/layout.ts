import { command } from './base'

export interface LayoutNodeInput {
  id: string
  width: number
  height: number
}

export interface LayoutEdgeInput {
  id?: string | null
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  kind?: string | null
}

export interface LayoutRequest {
  nodeOrigin?: [number, number] | null
  nodes: LayoutNodeInput[]
  edges: LayoutEdgeInput[]
}

export interface Position {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface LayoutResponse {
  positions: Record<string, Position>
  bounds: Rect | null
  layoutHash: string | null
}

export const compute_layout = (request: LayoutRequest) =>
  command<LayoutResponse>('compute_layout', { request })
