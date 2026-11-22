const assert = require("node:assert/strict")
const path = require("node:path")
const { test } = require("node:test")
const { root, loadTs, store } = require("./helpers.cjs")
const bibleModule = path.join(path.dirname(require.resolve("json-bible/package.json")), "index.ts")
const JsonBible = loadTs(bibleModule).default
const libraryRoot = path.dirname(bibleModule)
const { stripMarkdown } = loadTs(path.join(libraryRoot, "lib/markdown.ts"))
const { sanitizeVerseText } = loadTs(path.join(root, "src/common/scripture/sanitizeVerseText.ts"))
const bible = {
    name: "Test Bible",
    metadata: { title: "Test Bible" },
    books: [1, 2].map((number) => ({
        number,
        id: number === 1 ? "GEN" : "EXO",
        name: number === 1 ? "Genesis" : "Exodus",
        chapters: [1, 2, 3].map((number) => ({
            number,
            verses: Array.from({ length: 25 }, (_, i) => ({
                number: i + 1,
                text: "Test verse " + (i + 1) + " contains enough words for a complete rendering test."
            }))
        }))
    }))
}
function deepFreeze(value) {
    if (value && typeof value === "object") {
        Object.values(value).forEach(deepFreeze)
        Object.freeze(value)
    }
    return value
}
deepFreeze(bible)
function harness(options = {}) {
    const state = { copies: 0, apiLoads: 0, requests: 0, output: [] }
    const template = { items: [{ type: "text", textFit: "shrinkToFit", style: "width:100%;height:100%;", lines: [{ text: [{ value: "{scripture_reference} {scripture_text}", style: "font-size:80px;" }] }] }], settings: {} }
    const reference = store({ reference: { book: 1, chapters: options.chapters || [1], verses: options.verses || [[4]] } })
    const scriptureCache = store(options.cold ? {} : { local: bible, second: bible })
    const definitions = { local: { name: "Test Bible", api: options.api, metadata: { author: "Test" } }, second: { name: "Second Translation" } }
    if (options.collection) definitions.group = { collection: { versions: ["local", "second"] } }
    const stores = {
        scriptures: store(definitions),
        scripturesCache: scriptureCache,
        activeScripture: reference,
        drawerTabsData: store({ scripture: { activeSubTab: options.collection ? "group" : "local" } }),
        scriptureSettings: store({ template: "scripture", versesPerSlide: 3, verseNumbers: true, ...options.settings }),
        scriptureHistory: store([]),
        outLocked: store(!!options.locked),
        styles: store({}),
        media: store({}),
        notFound: store({ bible: [] }),
        templates: store({ scripture: template })
    }
    const plain = (item) => (item.lines || []).map((line) => line.text.map((part) => part.value).join("")).join("\n")
    const mocks = {
        ...stores,
        get: (s) => s.value,
        JsonBible,
        stripMarkdown,
        sanitizeVerseText,
        clone: (value) => {
            if (value?.books) state.copies++
            return structuredClone(value)
        },
        removeDuplicates: (array) => [...new Set(array)],
        getItemText: plain,
        TemplateHelper: class {
            getPlainText() {
                return template.items.map(plain).join("\n")
            }
            createSlides(count) {
                return Array.from({ length: count }, () => structuredClone(template.items))
            }
            getSetting(key) {
                return template.settings[key]
            }
            runActions() {}
        },
        getAllNormalOutputs: () => [{ id: "default" }],
        getFirstActiveOutput: () => ({ out: { slide: { id: "temp" } } }),
        setOutput: (type, data) => state.output.push({ type, data: structuredClone(data) }),
        customActionActivation() {},
        trackScriptureUsage() {},
        getKey() {
            return ""
        },
        Main: { BIBLE: "BIBLE" },
        requestMain: async (_channel, { id }) => {
            state.requests++
            return { content: [id, structuredClone(bible)] }
        },
        splitTextContentInHalf: (text) => {
            const at = text.lastIndexOf(" ", Math.floor(text.length / 2))
            return [text.slice(0, at), text.slice(at + 1)]
        },
        ShowObj: class {},
        uid: () => "test-id"
    }
    const api = async () => {
        state.apiLoads++
        return JsonBible(structuredClone(bible))
    }
    const scripture = loadTs(path.join(root, "src/frontend/components/drawer/bible/scripture.ts"), {
        "*": mocks,
        "json-bible": { __esModule: true, default: JsonBible },
        "json-bible/lib/api": { ApiBible: api }
    })
    return { state, stores, scripture }
}

for (const [name, options] of [
    ["single verse", {}],
    ["long passage", { verses: [[1, 2, 3, 4, 5, 6, 7, 8]] }],
    [
        "multiple chapters",
        {
            chapters: [1, 2],
            verses: [
                [24, 25],
                [1, 2]
            ]
        }
    ],
    ["split verse", { settings: { splitLongVerses: true, longVersesChars: 35, splitLongVersesSuffix: true } }],
    ["two translations", { collection: true }]
]) {
    test("cached projection and scripture preview produce complete content for " + name, async () => {
        const { state, scripture } = harness(options)
        const preview = await scripture.getActiveScripturesContent()
        await scripture.playScripture()
        assert.equal(state.copies, 0)
        assert.equal(preview.length, options.collection ? 2 : 1)
        const slide = state.output[0].data
        assert.equal(slide.id, "temp")
        assert.match(slide.customDynamicValues.scripture_reference, /Genesis/)
        assert.equal(slide.previousSlides.length, 3)
        assert.equal(slide.nextSlides.length, 3)
        assert.match(JSON.stringify(slide.tempItems), /Test verse/)
    })
}
test("ordinary reader owns verse data and cached content readers own their metadata", async () => {
    const { state, scripture } = harness()
    const ordinary = await scripture.loadJsonBible("local")
    assert.equal(state.copies, 1)
    assert.notEqual(ordinary.data.books[0].chapters, bible.books[0].chapters)
    const content = await scripture.getActiveScripturesContent()
    assert.equal(content[0].metadata.author, "Test")
    assert.equal(bible.metadata.author, undefined)
})
test("locked projection, cold Bible load, and API Bible remain functional", async () => {
    const locked = harness({ locked: true })
    await locked.scripture.playScripture()
    assert.deepEqual(locked.state.output, [])
    const cold = harness({ cold: true })
    await cold.scripture.playScripture()
    assert.equal(cold.state.requests, 1)
    assert.match(JSON.stringify(cold.state.output), /Test verse/)
    const api = harness({ api: true })
    await api.scripture.playScripture()
    assert(api.state.apiLoads > 0)
    assert.equal(api.state.requests, 0)
})
test("cache replacement is reflected in a later activation", async () => {
    const { state, stores, scripture } = harness()
    await scripture.playScripture()
    const replacement = structuredClone(bible)
    replacement.books[0].chapters[0].verses[3].text = "Replacement content"
    stores.scripturesCache.value.local = replacement
    await scripture.playScripture()
    assert.match(JSON.stringify(state.output.at(-1)), /Replacement content/)
})
