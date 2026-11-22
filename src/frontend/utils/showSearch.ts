import type { ShowList } from "../../types/Show"
interface SearchDocument {
    words: string[]
    phrase: string
    padded: string
    compact: string
    terms: Set<string>
}
interface SearchForms {
    native: SearchDocument
    folded: SearchDocument
}
interface SearchEntry {
    name: string
    text: string
    number: unknown
    ccli: unknown
    normalizedNumber: string
    normalizedCcli: string
    title: SearchForms
    lyrics: SearchForms
}
type Normalizer = (value: string, removeSpaces?: boolean) => string
type Scorer = (document: SearchDocument, query: SearchDocument) => number
export function createScriptureFixTitleDistance() {
    const cachedMasks = new Map<string, Map<number, number>>()

    // Myers' bit-vector Levenshtein algorithm for nonempty patterns of up to 32 UTF-16 code units.
    return function titleDistance(text: string, pattern: string) {
        let masks = cachedMasks.get(pattern)
        if (!masks) {
            masks = new Map()
            for (let index = 0; index < pattern.length; index++) {
                const character = pattern.charCodeAt(index)
                masks.set(character, (masks.get(character) || 0) | (1 << index))
            }
            if (cachedMasks.size >= 4096) cachedMasks.delete(cachedMasks.keys().next().value)
            cachedMasks.set(pattern, masks)
        }

        const finalBit = 1 << (pattern.length - 1)
        let distance = pattern.length
        let positive = -1
        let negative = 0

        for (let index = 0; index < text.length; index++) {
            const equal = masks.get(text.charCodeAt(index)) || 0
            const vertical = equal | negative
            const horizontal = (((equal & positive) + positive) ^ positive) | equal
            let increase = negative | ~(horizontal | positive)
            let decrease = positive & horizontal
            if (increase & finalBit) distance++
            if (decrease & finalBit) distance--
            increase = (increase << 1) | 1
            decrease <<= 1
            positive = decrease | ~(vertical | increase)
            negative = increase & vertical
        }
        return distance
    }
}

export function createScriptureFixSearch(formatSearch: Normalizer, similarity: (left: string, right: string) => number) {
    const searchData = new WeakMap<Record<string, string>, Map<string, SearchEntry>>()
    const titleDistance = createScriptureFixTitleDistance()

    function describe(words: string[]): SearchDocument {
        const phrase = words.join(" ")
        return {
            words,
            phrase,
            padded: " " + phrase + " ",
            compact: words.join(""),
            terms: new Set(words)
        }
    }

    function forms(value: string): SearchForms {
        const normalized = formatSearch(value)
        const native = describe(normalized.match(/[\p{L}\p{N}]+/gu) || [])
        const folded = /[ɛɔ]/.test(normalized) ? describe(native.words.map((word) => word.replace(/ɛ/g, "e").replace(/ɔ/g, "o"))) : native
        return { native, folded }
    }

    function prepareShow(show: ShowList, text: string, cache: Map<string, SearchEntry>): SearchEntry {
        const number = show.quickAccess?.number
        const ccli = show.quickAccess?.metadata?.CCLI
        let entry = cache.get(show.id)
        if (entry?.name === show.name && entry.text === text && entry.number === number && entry.ccli === ccli) return entry

        entry = {
            name: show.name,
            text,
            number,
            ccli,
            normalizedNumber: number == null ? "" : formatSearch(String(number), true),
            normalizedCcli: ccli == null ? "" : formatSearch(String(ccli), true),
            title: forms(show.name),
            lyrics: forms(text)
        }
        cache.set(show.id, entry)
        return entry
    }

    function hasPhrase(document: SearchDocument, query: SearchDocument) {
        return document.padded.includes(query.padded)
    }

    function countTerms(document: SearchDocument, query: SearchDocument) {
        let matches = 0
        for (const word of query.terms) {
            if (document.terms.has(word)) matches++
        }
        return matches
    }

    function shortestSpan(words: string[], required: Set<string>) {
        const counts = new Map<string, number>()
        let first = 0
        let covered = 0
        let shortest = words.length

        for (let last = 0; last < words.length; last++) {
            const word = words[last]
            if (!required.has(word)) continue
            const count = counts.get(word) || 0
            if (!count) covered++
            counts.set(word, count + 1)

            while (covered === required.size) {
                shortest = Math.min(shortest, last - first + 1)
                if (shortest === required.size) return shortest
                const left = words[first++]
                if (!counts.has(left)) continue
                const remaining = counts.get(left)! - 1
                counts.set(left, remaining)
                if (!remaining) covered--
            }
        }
        return shortest
    }

    function scoreLyrics(document: SearchDocument, query: SearchDocument) {
        if (!document.words.length) return 0
        if (hasPhrase(document, query)) return 88

        const required = query.terms.size
        const matches = countTerms(document, query)
        if (required > 1 && matches === required) {
            return 73 + (10 * required) / shortestSpan(document.words, query.terms)
        }
        if (matches >= 2 && matches / required >= 2 / 3) return 43 + (24 * matches) / required

        // Keep offering suggestions while the final word is being typed.
        if (query.words[query.words.length - 1].length >= 3 && document.padded.includes(" " + query.phrase)) return 57
        return 0
    }

    function scoreTitle(document: SearchDocument, query: SearchDocument) {
        if (hasPhrase(document, query)) return 90
        if (query.terms.size > 1 && countTerms(document, query) === query.terms.size) return 86
        if (document.compact.includes(query.compact)) return 65
        return 0
    }

    function scoreTitleSpelling(document: SearchDocument, query: SearchDocument) {
        const title = document.compact
        const input = query.compact
        const [longer, shorter] = title.length >= input.length ? [title, input] : [input, title]
        if (shorter.length < 3 || shorter.length / longer.length < 0.6) return 0
        const ratio = shorter.length <= 32 ? (longer.length - titleDistance(longer, shorter)) / longer.length : similarity(title, input)
        return ratio >= 0.6 ? 42 * ratio : 0
    }

    function rankWithFallback(score: Scorer, document: SearchForms, query: SearchForms) {
        const native = score(document.native, query.native)
        if (document.native === document.folded && query.native === query.folded) return native ? native + 1 : 0
        const folded = score(document.folded, query.folded)
        return Math.max(native ? native + 1 : 0, folded)
    }

    function scoreShow(query: SearchForms, entry: SearchEntry) {
        const title = entry.title
        if (title.native.phrase === query.native.phrase) return 100

        const number = entry.normalizedNumber
        const ccli = entry.normalizedCcli
        const input = query.native.compact
        if (input === number || input === ccli || (number && input === number + title.native.compact)) return 99

        if (title.native.compact === input) return 98
        if (title.folded.compact === query.folded.compact) return 97
        if (title.native.compact.startsWith(input)) return 95
        if (title.folded.compact.startsWith(query.folded.compact)) return 94

        const titleScore = rankWithFallback(scoreTitle, title, query)
        const lyricsScore = rankWithFallback(scoreLyrics, entry.lyrics, query)
        return Math.max(titleScore, lyricsScore) || rankWithFallback(scoreTitleSpelling, title, query)
    }

    return function searchShows(value: string, shows: ShowList[], textCache: Record<string, string>, categories: Record<string, { isArchive?: boolean }>, archiveTab?: string | null): ShowList[] {
        const query = forms(value)
        if (!query.native.words.length) return []

        let cache = searchData.get(textCache)
        if (!cache) {
            cache = new Map()
            searchData.set(textCache, cache)
        }
        const matches: { show: ShowList; score: number }[] = []
        for (const show of shows) {
            if (typeof show.name !== "string" || !show.name) continue
            if (categories[show.category || ""]?.isArchive && archiveTab !== show.category) continue

            const text = typeof textCache[show.id] === "string" ? textCache[show.id] : ""
            const entry = prepareShow(show, text, cache)
            const score = scoreShow(query, entry)
            if (score) matches.push({ show, score })
        }
        matches.sort((left, right) => right.score - left.score)
        const best = matches[0]?.score || 1
        return matches.map(({ show, score }) => ({ ...show, originalMatch: score, match: (score / best) * 100 }))
    }
}
