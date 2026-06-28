import {createContext, useContext, type ReactNode} from 'react'

export type TourPlacement = 'top' | 'right' | 'bottom' | 'left' | 'auto'
export type TourNavigationDirection = 'start' | 'next' | 'previous'
export type TourStepLeaveReason = 'next' | 'previous' | 'skip' | 'complete' | 'stop'
export type TourStepTarget = string | Element | (() => Element | null)
export type TourTargetStatus = 'none' | 'waiting' | 'ready' | 'missing'

export const HOME_ONBOARDING_TOUR_ID = 'desktop-home-first-world'

export interface TourStepLifecycleContext {
    tourId: string
    stepId: string
    stepIndex: number
    direction: TourNavigationDirection
}

export interface TourStepLeaveContext {
    tourId: string
    stepId: string
    stepIndex: number
    reason: TourStepLeaveReason
}

export interface TourLabels {
    previous?: string
    next?: string
    skip?: string
    finish?: string
}

export interface TourStep {
    id: string
    target?: TourStepTarget
    title: ReactNode
    content: ReactNode
    placement?: TourPlacement
    labels?: TourLabels
    waitTimeoutMs?: number
    allowTargetInteraction?: boolean
    advanceOnTargetClick?: boolean
    beforeEnter?: (context: TourStepLifecycleContext) => void | Promise<void>
    afterLeave?: (context: TourStepLeaveContext) => void | Promise<void>
}

export interface TourDefinition {
    id: string
    version?: number
    storageKey?: string
    labels?: TourLabels
    steps: readonly TourStep[]
}

export interface StartTourOptions {
    force?: boolean
    fromStepId?: string
    markCompletedOnSkip?: boolean
}

export interface TourContextValue {
    isActive: boolean
    activeTourId: string | null
    currentStep: TourStep | null
    currentIndex: number
    totalSteps: number
    targetStatus: TourTargetStatus
    registerTour: (definition: TourDefinition) => () => void
    startTour: (definition: TourDefinition, options?: StartTourOptions) => boolean
    startRegisteredTour: (tourId: string, options?: StartTourOptions) => boolean
    stopTour: () => void
    skipTour: () => void
    completeTour: () => void
    nextStep: () => void
    previousStep: () => void
    goToStep: (stepIndex: number) => void
    isTourCompleted: (definition: TourDefinition) => boolean
    resetTourCompletion: (definitionOrStorageKey: TourDefinition | string) => void
}

export const TourContext = createContext<TourContextValue | null>(null)

export function useTour(): TourContextValue {
    const context = useContext(TourContext)
    if (!context) {
        throw new Error('useTour 必须在 TourProvider 内使用')
    }
    return context
}
