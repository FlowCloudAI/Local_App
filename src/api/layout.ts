import {command} from './base'

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

export interface LayoutParamsPayload {
    collisionPadding?: number
    nodeGap?: number
    collisionPassesPerIteration?: number
    finalCollisionPasses?: number
    edgeClearanceMargin?: number
    edgeClearanceRadiusFactor?: number
    edgeClearanceStrength?: number
    edgeClearancePasses?: number
    edgeLengthAlphaRho?: number
    edgeLengthAlphaCv?: number
    edgeLengthMin?: number
    edgeLengthMax?: number
    twoWayEdgeLengthFactor?: number
    twoWayAttractionWeight?: number
    degreeEdgeLengthScale?: number
    degreeEdgeLengthMaxFactor?: number
    initialTemperatureGamma?: number
    minTemperatureGamma?: number
    minTemperatureRatio?: number
    iterationBase?: number
    iterationSqrtScale?: number
    iterationRhoScale?: number
    iterationMin?: number
    iterationMax?: number
    initRadiusBetaRmax?: number
    estimatedAreaBetaRho?: number
    estimatedAreaBetaCv?: number
    pathishEdgeLengthReduction?: number
    pathishInitRadiusReduction?: number
    pathishAxisCompactionMax?: number
    pathishRadialPullMax?: number
    pathishLeafPullMax?: number
    pathishBranchSmoothingMax?: number
    postLayoutCompactionPasses?: number
    aspectCompactionTrigger?: number
    aspectCompactionMax?: number
    earlyStopThreshold?: number
    earlyStopStreak?: number
    componentGap?: number
    shelfRowMaxWidth?: number
    isolatedNodeHorizontalGap?: number
    clusterBoxGap?: number
    clusterLinkDistanceBase?: number
    clusterRepulsionSoft?: number
    clusterCenterPull?: number
    clusterTemperatureInitial?: number
    clusterTemperatureDecay?: number
    clusterIterations?: number
    clusterTwoWayBonus?: number
    clusterHorizontalStretch?: number
    orientationLinearityThreshold?: number
    fixedRandomSeed?: number
    minDistance?: number
    attractiveDirectionSalt?: number
    finalCollisionSalt?: number
    collisionDirectionSalt?: number
}

export interface LayoutRequest {
  nodeOrigin?: [number, number] | null
  nodes: LayoutNodeInput[]
  edges: LayoutEdgeInput[]
    params?: LayoutParamsPayload
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
