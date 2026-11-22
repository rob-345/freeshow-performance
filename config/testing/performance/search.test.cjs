const assert = require("node:assert/strict")
const path = require("node:path")
const { test } = require("node:test")
const { root, loadTs, store } = require("./helpers.cjs")
const { createScriptureFixTitleDistance, createScriptureFixSearch } = loadTs(path.join(root, "src/frontend/utils/showSearch.ts"))
const { formatSearch } = loadTs(path.join(root, "src/frontend/utils/search.ts"), {
    "svelte/store": { get: (s) => s.value },
    "../converters/txt": { similarity },
    "../stores": { categories: store({}), drawerTabsData: store({}), textCache: store({}) },
    "./showSearch": { createScriptureFixSearch }
})
function distance(left, right) {
    let previous = Array.from({ length: right.length + 1 }, (_, i) => i)
    for (let i = 0; i < left.length; i++) {
        const next = [i + 1]
        for (let j = 0; j < right.length; j++) next.push(Math.min(next[j] + 1, previous[j + 1] + 1, previous[j] + (left[i] === right[j] ? 0 : 1)))
        previous = next
    }
    return previous[right.length]
}
function similarity(left, right) {
    return 1 - distance(left, right) / Math.max(left.length, right.length, 1)
}
const find = createScriptureFixSearch(formatSearch, similarity)
const show = (id, name, rest = {}) => ({ id, name, category: null, ...rest })
const ids = (results) => results.map((s) => s.id)

test("exact titles rank ahead of prefixes in the ordinary store-backed entry point", () => {
    const { showSearch } = loadTs(path.join(root, "src/frontend/utils/search.ts"), {
        "svelte/store": { get: (s) => s.value },
        "../converters/txt": { similarity },
        "../stores": { categories: store({}), drawerTabsData: store({}), textCache: store({}) },
        "./showSearch": { createScriptureFixSearch }
    })
    assert.deepEqual(ids(showSearch("Amazing Grace", [show("prefix", "Amazing Grace My Chains Are Gone"), show("exact", "Amazing Grace")])), ["exact", "prefix"])
})
test("shuffled lyric words match, with proximity and phrase bonuses", () => {
    const shows = ["partial", "far", "near", "phrase"].map((id, i) => show(id, "Hymn " + i))
    const text = { partial: "snares dangers", far: "snares away from the other dangers far from all our toils", near: "through many dangers toils and snares", phrase: "snares dangers toils" }
    assert.deepEqual(ids(find("snares dangers toils", shows, text, {})), ["phrase", "near", "far", "partial"])
})
test("Akan keyboard substitutions work in titles and lyrics while retaining original spellings", () => {
    const shows = [show("akan", "Yɛbɛsom Nyankopɔn"), show("lyrics", "Evening Hymn")]
    const text = { lyrics: "Yɛbɛsom Nyankopɔn daa" }
    const results = find("Yebesom Nyankopon", shows, text, {})
    assert.deepEqual(ids(results), ["akan", "lyrics"])
    assert.equal(results[0].name, shows[0].name)
    assert.equal(find("daa Nyankopon Yebesom", shows, text, {})[0].id, "lyrics")
})
test("exact Akan spelling wins over the fallback spelling", () => {
    const shows = [show("akan", "Yɛbɛsom"), show("latin", "Yebesom")]
    assert.deepEqual(ids(find("Yebesom", shows, {}, {})), ["latin", "akan"])
    assert.deepEqual(ids(find("Yɛbɛsom", shows, {}, {})), ["akan", "latin"])
})
test("numbers, accent folding, short lyric words, and archive filters work", () => {
    const shows = [show("numbered", "Café Song", { quickAccess: { number: "MP133", metadata: { CCLI: 12345 } } }), show("archived", "Café Song", { category: "archive" })]
    for (const query of ["MP 133", "12345", "Cafe Song", "we"]) {
        assert.equal(find(query, shows, { numbered: "We sing" }, { archive: { isArchive: true } })[0].id, "numbered")
    }
})
test("edits to cached lyrics, title, and number are visible on the next query", () => {
    const shows = [show("edited", "Hymn", { quickAccess: { number: "12" } })],
        text = { edited: "morning light" }
    assert.equal(find("morning light", shows, text, {})[0].id, "edited")
    text.edited = "evening stars"
    assert.deepEqual(find("morning light", shows, text, {}), [])
    assert.equal(find("stars evening", shows, text, {})[0].id, "edited")
    shows[0].name = "Evening"
    shows[0].quickAccess.number = "13"
    assert.equal(find("Evening", shows, text, {})[0].originalMatch, 100)
    assert.equal(find("13", shows, text, {})[0].originalMatch, 99)
})
test("fast edit distance agrees with the reference algorithm at word and 32-bit boundaries", () => {
    const fast = createScriptureFixTitleDistance()
    let state = 20261122
    const random = (max) => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        return (state >>> 9) % max
    }
    const alphabet = Array.from("abcdefɛɔé勝💙")
    const word = (length) => Array.from({ length }, () => alphabet[random(alphabet.length)]).join("")
    for (let i = 0; i < 1500; i++) {
        const left = word(1 + random(60)),
            right = word(1 + random(32)).slice(0, 32)
        assert.equal(fast(left, right), distance(left, right))
    }
    for (const size of [1, 30, 31, 32]) assert.equal(fast("a".repeat(size) + "ɛ", "a".repeat(size)), 1)
})
