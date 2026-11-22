const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")
const { compile, preprocess } = require("svelte/compiler")
const sveltePreprocess = require("svelte-preprocess")
const { root, componentFunctions, fakeTimers } = require("./helpers.cjs")
const contentFile = "src/frontend/components/output/layers/SlideContent.svelte"
const textboxFile = "src/frontend/components/slide/Textbox.svelte"
const transitionFile = "src/frontend/components/output/transitions/SlideItemTransition.svelte"
const verseItem = (text = "Verse one") => ({ type: "text", auto: true, textFit: "shrinkToFit", lines: [{ text: [{ value: text }] }] })

function contentHarness() {
    let id = 0
    const timers = fakeTimers()
    const old = verseItem("Old verse")
    const state = {
        ...timers,
        clone: structuredClone,
        uid: () => String(++id),
        preparation: null,
        precomputePending: new Set(),
        precomputeTargets: [],
        destroyed: false,
        updateGeneration: 0,
        timeout: null,
        mirror: false,
        preview: false,
        ratio: 1,
        transitionEnabled: false,
        outSlide: { id: "temp", customDynamicValues: { scripture_reference: "Genesis 1:1" } },
        currentSlide: { items: [verseItem()] },
        currentSlideItems: [verseItem()],
        currentStyle: {},
        lines: [],
        slideData: {},
        transition: { type: "none", duration: 0 },
        currentItems: [old],
        current: { currentSlide: { items: [old] } },
        show: true,
        persistentItems: [],
        persistentItemIndexes: [],
        isClearingToEmpty: false,
        transitioningBetween: false,
        waitUntilValueIsDefined: async () => {}
    }
    const functions = componentFunctions(contentFile, ["cancelPreparation", "canPrepareScripture", "prepareScripture", "acceptPreparedSize", "updateItems", "hasRealTransition", "itemsAreEqual", "scheduleAutoSizePrecompute", "shouldPrecomputeAutoSize", "createAutoSizeKey"], state)
    const ready = (key = state.precomputeTargets[0].key, fontSize = 42, preparedSignature = "measured") => functions.acceptPreparedSize({ detail: { key, fontSize, preparedSignature } })
    return { state, timers, functions, ready }
}

test("changed Svelte components compile for the production renderer", async () => {
    for (const relative of [contentFile, textboxFile, transitionFile, "src/frontend/components/drawer/pages/Shows.svelte", "src/frontend/components/main/popups/SelectShow.svelte"]) {
        const filename = path.join(root, relative)
        const result = await preprocess(
            fs.readFileSync(filename, "utf8"),
            sveltePreprocess({
                typescript: {
                    tsconfigFile: path.join(root, "config/typescript/tsconfig.svelte.json")
                }
            }),
            { filename }
        )
        assert(compile(result.code, { filename, generate: "dom", dev: false }).js.code.length > 0)
    }
})

test("old verse stays visible until all new text measurements are ready", async () => {
    const { state, timers, functions, ready } = contentHarness()
    state.currentSlide.items.push(verseItem("Reference"))
    const work = functions.updateItems()
    assert.equal(state.currentItems[0].lines[0].text[0].value, "Old verse")
    assert.equal(state.show, true)
    const keys = state.precomputeTargets.map((target) => target.key)
    ready(keys[0])
    assert.equal(state.preparation.pending.size, 1)
    ready(keys[1], 30)
    await work
    timers.run(0)
    assert.equal(state.show, true)
    assert.equal(state.currentItems[0].autoFontSize, 42)
    assert.equal(state.currentItems[1].autoFontSize, 30)
    assert(state.currentItems.every((item) => item.scriptureAutoSizeReady))
    assert.equal(state.currentSlide.items[0].scriptureAutoSizeReady, undefined)
})

test("rapid verse changes cancel stale preparation and reject old measurement events", async () => {
    const { state, timers, functions, ready } = contentHarness()
    const first = functions.updateItems()
    const oldKey = state.precomputeTargets[0].key
    state.currentSlide = { items: [verseItem("Newest verse")] }
    state.currentSlideItems = state.currentSlide.items
    const second = functions.updateItems()
    assert.equal(ready(oldKey), false)
    ready()
    await Promise.all([first, second])
    timers.run(0)
    assert.equal(state.currentItems[0].lines[0].text[0].value, "Newest verse")
})

test("invalid measurements fall back after 600ms without claiming measured readiness", async () => {
    const { state, timers, functions, ready } = contentHarness()
    const work = functions.updateItems()
    for (const fontSize of [0, -1, NaN, Infinity]) ready(undefined, fontSize)
    ready(undefined, 42, "")
    assert.equal(state.preparation.pending.size, 1)
    timers.run(600)
    await work
    timers.run(0)
    assert.equal(state.currentItems[0].scriptureAutoSizeReady, undefined)
    assert.equal(state.precomputeTargets.length, 0)
})

test("measured sizing excludes dynamic, reveal, timeline, mirror, and media content", () => {
    const { state, functions } = contentHarness()
    assert(functions.canPrepareScripture([verseItem()]))
    for (const item of [{ ...verseItem(), lineReveal: true }, { ...verseItem(), clickReveal: true }, { ...verseItem(), chords: { enabled: true } }, { ...verseItem(), type: "media" }, verseItem("{timer}")]) {
        assert.equal(functions.canPrepareScripture([item]), false)
    }
    state.mirror = true
    assert.equal(functions.canPrepareScripture([verseItem()]), false)
    state.mirror = false
    state.currentSlide.timeline = { actions: [{}] }
    assert.equal(functions.canPrepareScripture([verseItem()]), false)
    state.currentSlide.timeline = null
    state.currentStyle.lines = 2
    assert.equal(functions.canPrepareScripture([verseItem()]), false)
})

test("prepared font reuse validates content, template, actual dimensions, and font size", () => {
    const state = {
        item: verseItem(),
        itemElem: { clientWidth: 1000, clientHeight: 500, parentElement: { clientWidth: 1920, clientHeight: 1080 } },
        getStyles: () => ({}),
        preview: false,
        fontPreview: false,
        isStage: false,
        chords: false,
        stageAutoSize: false,
        stageItem: {},
        customFontSize: null,
        ratio: 1,
        outputStyle: {},
        styleIdOverride: "",
        mirror: false,
        smallFontSize: false,
        maxLines: 0,
        maxLinesInvert: false,
        centerPreview: false,
        resolvedTemplateId: "scripture",
        fontSize: 0,
        autoSizeReady: false,
        autoSizeKey: "",
        hideUntilAutosized: true,
        requestAnimationFrame: (fn) => fn(),
        dispatch: () => {}
    }
    const functions = componentFunctions(textboxFile, ["buildAutoSizeSignature", "preparedScriptureSignature", "usePreparedScriptureSize", "markAutoSizeReady"], state)
    state.item.scripturePreparedSize = { fontSize: 48, signature: functions.preparedScriptureSignature() }
    // A hidden probe has a different parent, but the same actual text box dimensions.
    state.itemElem.parentElement.clientWidth = 0
    assert.equal(functions.usePreparedScriptureSize(), true)
    assert.equal(state.fontSize, 48)
    assert.equal(state.hideUntilAutosized, false)
    state.itemElem.clientWidth = 900
    assert.equal(functions.usePreparedScriptureSize(), false)
    state.itemElem.clientWidth = 1000
    state.item.lines = verseItem("Different verse").lines
    assert.equal(functions.usePreparedScriptureSize(), false)
    state.item.lines = verseItem().lines
    state.resolvedTemplateId = "other"
    assert.equal(functions.usePreparedScriptureSize(), false)
    state.resolvedTemplateId = "scripture"
    state.item.scripturePreparedSize.fontSize = 0
    assert.equal(functions.usePreparedScriptureSize(), false)
})

test("prepared text removes only autosize waiting and preserves explicit timers and fades", () => {
    let id = 0
    const state = {
        clone: structuredClone,
        uid: () => String(++id),
        item: verseItem(),
        globalTransition: { type: "fade", duration: 250 },
        transitioningBetween: false,
        preview: false,
        $currentWindow: "output",
        $templates: {},
        $scriptureSettings: {},
        outSlide: { id: "temp" },
        currentStyle: {},
        currentSlide: {},
        lines: [],
        currentlyTransitioning: {},
        getStyleTemplate: () => ({ items: [verseItem()] }),
        slideHasAutoSizeItem: () => true
    }
    const { startTransition } = componentFunctions(transitionFile, ["startTransition"], state)
    const run = () => {
        startTransition()
        return Object.values(state.currentlyTransitioning).at(-1)
    }
    assert.equal(run().outTransition.delay, 500)
    state.item.scriptureAutoSizeReady = true
    assert.equal(run().outTransition.delay, 0)
    assert.equal(run().inTransition.duration, 250)
    state.item.actions = { showTimer: 2, hideTimer: 3 }
    const timed = run()
    assert.equal(timed.inTransition.delay, 2000)
    assert.equal(timed.outTransition.delay, 3000)
    assert.equal(timed.transitionBetween.delay, 3000)
})
