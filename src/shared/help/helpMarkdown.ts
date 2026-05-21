import helpAiFigure from './assets/help-ai.svg'
import helpBasicsFigure from './assets/help-basics.svg'
import helpMapFigure from './assets/help-map.svg'
import aiGuideMarkdown from './docs/ai-guide.md?raw'
import entriesMarkdown from './docs/entries.md?raw'
import gettingStartedMarkdown from './docs/getting-started.md?raw'
import mapsMarkdown from './docs/maps.md?raw'
import pluginsMarkdown from './docs/plugins.md?raw'
import relationsTimelineMarkdown from './docs/relations-timeline.md?raw'
import snapshotsMarkdown from './docs/snapshots.md?raw'
import troubleshootingMarkdown from './docs/troubleshooting.md?raw'
import workspaceMarkdown from './docs/workspace.md?raw'
import type {HelpTopicKey} from './helpCatalog'

type HelpSectionMarkdownMap = Record<string, string>

const SECTION_MARKER_PATTERN = /^<!--\s*section:([a-z0-9-]+)\s*-->\s*$/gm

const HELP_TOPIC_MARKDOWN_SOURCE: Record<HelpTopicKey, string> = {
    'getting-started': gettingStartedMarkdown,
    workspace: workspaceMarkdown,
    entries: entriesMarkdown,
    'relations-timeline': relationsTimelineMarkdown,
    maps: mapsMarkdown,
    'ai-guide': aiGuideMarkdown,
    plugins: pluginsMarkdown,
    snapshots: snapshotsMarkdown,
    troubleshooting: troubleshootingMarkdown,
}

const HELP_MARKDOWN_ASSET_URLS: Record<string, string> = {
    '../assets/help-ai.svg': helpAiFigure,
    '../assets/help-basics.svg': helpBasicsFigure,
    '../assets/help-map.svg': helpMapFigure,
}

function resolveHelpMarkdownAssetUrls(source: string) {
    return Object.entries(HELP_MARKDOWN_ASSET_URLS).reduce(
        (resolved, [assetPath, assetUrl]) => resolved.replaceAll(assetPath, assetUrl),
        source,
    )
}

function parseHelpSectionMarkdown(source: string): HelpSectionMarkdownMap {
    const matches = [...source.matchAll(SECTION_MARKER_PATTERN)]
    const sections: HelpSectionMarkdownMap = {}

    for (const [index, match] of matches.entries()) {
        const sectionId = match[1]?.trim()
        if (!sectionId) continue

        const markerIndex = match.index ?? 0
        const nextMarkerIndex = matches[index + 1]?.index ?? source.length
        const contentStart = markerIndex + match[0].length
        const sectionMarkdown = source.slice(contentStart, nextMarkerIndex).trim()
        sections[sectionId] = resolveHelpMarkdownAssetUrls(sectionMarkdown)
    }

    return sections
}

export const HELP_SECTION_MARKDOWN = Object.fromEntries(
    Object.entries(HELP_TOPIC_MARKDOWN_SOURCE).map(([topicKey, source]) => [
        topicKey,
        parseHelpSectionMarkdown(source),
    ]),
) as Record<HelpTopicKey, HelpSectionMarkdownMap>

export function getHelpSectionMarkdown(topicKey: HelpTopicKey, sectionId: string) {
    return HELP_SECTION_MARKDOWN[topicKey]?.[sectionId] ?? ''
}
