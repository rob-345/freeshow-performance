import { get } from "svelte/store"
import type { ShowList } from "../../types/Show"
import { similarity } from "../converters/txt"
import { categories, drawerTabsData, textCache } from "../stores"
import { createScriptureFixSearch } from "./showSearch"

const specialChars = /[.,\/#!?$%\^&\*;:{}=\-_'"´`~()]/g
export function formatSearch(value: string, removeSpaces = false) {
    if (typeof value !== "string") return ""
    let newValue = value
        .toLowerCase()
        .replace(specialChars, "")
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
    if (removeSpaces) newValue = newValue.replace(/\s+/g, "")

    return newValue
}

const searchShows = createScriptureFixSearch(formatSearch, similarity)

export function tokenize(str: string): string[] {
    return str.toLowerCase().split(/\s+/).filter(Boolean)
}

export function showSearch(value: string, shows: ShowList[]): ShowList[] {
    return searchShows(value, shows, get(textCache), get(categories), get(drawerTabsData).shows?.activeSubTab)
}
