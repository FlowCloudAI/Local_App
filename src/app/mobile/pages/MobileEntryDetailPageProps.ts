import type {AiFocus} from '../../../features/ai-chat/hooks/useAiController'
import type {MobileTab} from '../MobileNav'
import type {MobileEntryDetailPageParams, MobilePage} from '../usePageStack'

export interface MobileEntryDetailProps {
    push: (page: MobilePage) => void
    pop: () => void
    replace: (page: MobilePage) => void
    navigateToTab: (tab: MobileTab, page?: MobilePage) => void
    setBeforeBack: (handler: (() => boolean | Promise<boolean>) | null) => void
    setAiFocus: (focus: AiFocus) => void
    params: MobileEntryDetailPageParams
}
