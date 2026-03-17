"use strict";
function slugify(input) {
    return input
        .trim()
        .toLowerCase()
        .replace(/[/\s_]+/g, "-")
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
}
function channelTo255(value) {
    return Math.round(Math.max(0, Math.min(1, value)) * 255);
}
function alphaToString(a) {
    const rounded = Math.round(a * 1000) / 1000;
    if (rounded >= 1)
        return "1";
    return String(rounded);
}
function colorToCss(color, format = "hex") {
    const r = channelTo255(color.r);
    const g = channelTo255(color.g);
    const b = channelTo255(color.b);
    const a = "a" in color ? color.a : 1;
    if (format === "rgb") {
        if (a < 1)
            return `rgba(${r}, ${g}, ${b}, ${alphaToString(a)})`;
        return `rgb(${r}, ${g}, ${b})`;
    }
    const hex = [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
    if (a < 1) {
        const alphaHex = Math.round(a * 255)
            .toString(16)
            .padStart(2, "0");
        return `#${hex}${alphaHex}`;
    }
    return `#${hex}`;
}
function isAlias(value) {
    return (typeof value === "object" &&
        value !== null &&
        "type" in value &&
        value.type === "VARIABLE_ALIAS");
}
function isColor(value) {
    return (typeof value === "object" &&
        value !== null &&
        "r" in value &&
        "g" in value &&
        "b" in value);
}
// Ordered: more-specific prefixes before less-specific (e.g. surface-layout-layout- before surface-layout-)
const MAPPED_NAME_SIMPLIFICATIONS = [
    [/^mapped-/, ""],
    [/^text-text-/, "text-"],
    [/^border-border-/, "border-"],
    [/^icon-icon-/, "icon-"],
    [/^surface-layout-layout-/, "surface-"],
    [/^surface-layout-/, "surface-"],
    [/^surface-interactive-surface-/, "surface-"],
    [/^surface-feedback-surface-/, "surface-"],
    [/^surface-state-surface-/, "surface-"],
];
function simplifyMappedName(name) {
    let n = slugify(name);
    for (const [pattern, replacement] of MAPPED_NAME_SIMPLIFICATIONS) {
        n = n.replace(pattern, replacement);
    }
    return n;
}
function variableNameToCss(variable, collectionMap) {
    const collection = collectionMap.get(variable.variableCollectionId);
    const collectionName = slugify((collection === null || collection === void 0 ? void 0 : collection.name) || "tokens");
    const variableName = slugify(variable.name);
    if (collectionName === "mapped") {
        return `--${simplifyMappedName(variableName)}`;
    }
    return `--${collectionName}-${variableName}`;
}
function addUnitIfNeeded(cssValue, variable, collectionMap) {
    var _a;
    const collection = collectionMap.get(variable.variableCollectionId);
    const collectionName = collection ? slugify(collection.name) : "";
    const variableName = slugify(variable.name);
    // Brand scale => px
    if (collectionName === "brand" && variableName.includes("scale")) {
        if (/^-?\d+(\.\d+)?$/.test(cssValue)) {
            if (cssValue === "0")
                return "0";
            return `${cssValue}px`;
        }
    }
    // Brand font weight => numeric
    if (collectionName === "brand" && variableName.includes("fontweight")) {
        const numericWeight = {
            Regular: "400",
            Medium: "500",
            "Semi Bold": "600",
            Bold: "700",
        };
        return (_a = numericWeight[cssValue]) !== null && _a !== void 0 ? _a : cssValue;
    }
    return cssValue;
}
function modeSelector(modeName, totalModes) {
    const n = modeName.trim().toLowerCase();
    if (totalModes === 1)
        return ":root";
    if (n === "light" || n === "default" || n === "base")
        return ":root";
    if (n === "dark")
        return `[data-theme="dark"]`;
    return `[data-theme="${slugify(modeName)}"]`;
}
function variableValueToLiteral(value) {
    if (typeof value === "boolean")
        return value ? "true" : "false";
    if (typeof value === "number")
        return String(value);
    if (typeof value === "string")
        return value;
    if (isColor(value))
        return colorToCss(value, "hex");
    return null;
}
function findFallbackModeId(variable, requestedModeId, collectionMap) {
    const collection = collectionMap.get(variable.variableCollectionId);
    if (!collection)
        return null;
    if (variable.valuesByMode[requestedModeId] !== undefined) {
        return requestedModeId;
    }
    // Fallback: collection's default mode
    if (variable.valuesByMode[collection.defaultModeId] !== undefined) {
        return collection.defaultModeId;
    }
    // Last resort: first mode with a value
    for (const mode of collection.modes) {
        if (variable.valuesByMode[mode.modeId] !== undefined) {
            return mode.modeId;
        }
    }
    return null;
}
async function resolveToFinalLiteral(variable, modeId, variableMap, collectionMap, visited = new Set()) {
    var _a;
    const effectiveModeId = await findFallbackModeId(variable, modeId, collectionMap);
    if (!effectiveModeId)
        return null;
    const visitKey = `${variable.id}:${effectiveModeId}`;
    if (visited.has(visitKey))
        return null;
    visited.add(visitKey);
    const raw = variable.valuesByMode[effectiveModeId];
    if (raw == null)
        return null;
    if (!isAlias(raw)) {
        return variableValueToLiteral(raw);
    }
    const target = (_a = variableMap.get(raw.id)) !== null && _a !== void 0 ? _a : (await figma.variables.getVariableByIdAsync(raw.id));
    if (!target)
        return null;
    if (!variableMap.has(target.id)) {
        variableMap.set(target.id, target);
    }
    return resolveToFinalLiteral(target, effectiveModeId, variableMap, collectionMap, visited);
}
async function valueToCss(variable, modeId, outputMode, variableMap, collectionMap) {
    var _a;
    const effectiveModeId = await findFallbackModeId(variable, modeId, collectionMap);
    if (!effectiveModeId)
        return null;
    const raw = variable.valuesByMode[effectiveModeId];
    if (raw == null)
        return null;
    if (outputMode === "resolved") {
        return resolveToFinalLiteral(variable, effectiveModeId, variableMap, collectionMap);
    }
    // Preserve mode: keep alias as var() reference
    if (isAlias(raw)) {
        const target = (_a = variableMap.get(raw.id)) !== null && _a !== void 0 ? _a : (await figma.variables.getVariableByIdAsync(raw.id));
        if (!target)
            return null;
        if (!variableMap.has(target.id)) {
            variableMap.set(target.id, target);
        }
        return `var(${variableNameToCss(target, collectionMap)})`;
    }
    return variableValueToLiteral(raw);
}
// Ordered: more-specific prefixes before less-specific (e.g. --alias-spacing- before --alias-)
const GROUP_LABEL_RULES = [
    ["--brand-fontfamily-", "Brand / Typography"],
    ["--brand-fontweight-", "Brand / Typography"],
    ["--brand-grey-", "Brand / Colors / Neutral"],
    ["--brand-foundation-", "Brand / Colors / Neutral"],
    ["--brand-lavender-", "Brand / Colors / Primary"],
    ["--brand-green-", "Brand / Colors / Success"],
    ["--brand-orange-", "Brand / Colors / Warning"],
    ["--brand-red-", "Brand / Colors / Error"],
    ["--brand-scale-", "Brand / Scale"],
    ["--alias-spacing-", "Alias / Spacing & Size"],
    ["--alias-size-", "Alias / Spacing & Size"],
    ["--alias-cornerradius-", "Alias / Radius & Border"],
    ["--alias-borderwidth-", "Alias / Radius & Border"],
    ["--alias-", "Alias / Semantic Colors"],
    ["--text-", "Semantic / Text"],
    ["--surface-", "Semantic / Surface"],
    ["--border-", "Semantic / Border"],
    ["--icon-", "Semantic / Icon"],
];
function getGroupLabel(cssName) {
    for (const [prefix, label] of GROUP_LABEL_RULES) {
        if (cssName.startsWith(prefix))
            return label;
    }
    return "Other";
}
function getGroupOrder(label) {
    const order = {
        "Brand / Typography": 10,
        "Brand / Colors / Neutral": 20,
        "Brand / Colors / Primary": 30,
        "Brand / Colors / Success": 40,
        "Brand / Colors / Warning": 50,
        "Brand / Colors / Error": 60,
        "Brand / Scale": 70,
        "Alias / Spacing & Size": 80,
        "Alias / Radius & Border": 90,
        "Alias / Semantic Colors": 100,
        "Semantic / Text": 110,
        "Semantic / Surface": 120,
        "Semantic / Border": 130,
        "Semantic / Icon": 140,
        Other: 999,
    };
    return order[label] || 999;
}
function formatSectionComment(label) {
    return [
        "  /* ========================================",
        `     ${label}`,
        "     ======================================== */",
    ];
}
function getNumericSuffix(value) {
    const match = value.match(/-(\d+)$/);
    if (!match)
        return null;
    return parseInt(match[1], 10);
}
function getTShirtOrder(value) {
    var _a;
    const map = {
        none: 0,
        xs: 10,
        s: 20,
        m: 30,
        l: 40,
        xl: 50,
        xxl: 60,
        full: 999,
    };
    return (_a = map[value]) !== null && _a !== void 0 ? _a : 500;
}
function getStateOrder(value) {
    var _a;
    const map = {
        primary: 10,
        secondary: 20,
        background: 30,
        elevated: 40,
        muted: 50,
        tertiary: 60,
        overlay: 70,
        disabled: 80,
        action: 100,
        "action-hover": 110,
        "on-action": 120,
        "primary-hover": 130,
        "primary-pressed": 140,
        "secondary-hover": 150,
        "secondary-pressed": 160,
        subtle: 170,
        focus: 180,
        error: 190,
        success: 200,
        warning: 210,
    };
    return (_a = map[value]) !== null && _a !== void 0 ? _a : 500;
}
function sortEntriesInGroup(label, entries) {
    const copy = entries.slice();
    copy.sort((a, b) => {
        var _a, _b, _c, _d;
        const aName = a.name.replace(/^--/, "");
        const bName = b.name.replace(/^--/, "");
        if (label === "Brand / Typography") {
            const fontFamilyA = aName.includes("fontfamily-") ? 0 : 1;
            const fontFamilyB = bName.includes("fontfamily-") ? 0 : 1;
            if (fontFamilyA !== fontFamilyB)
                return fontFamilyA - fontFamilyB;
            const weightOrder = {
                regular: 10,
                medium: 20,
                "semi-bold": 30,
                bold: 40,
            };
            const aKey = aName.replace(/^brand-fontweight-/, "");
            const bKey = bName.replace(/^brand-fontweight-/, "");
            const wa = (_a = weightOrder[aKey]) !== null && _a !== void 0 ? _a : 999;
            const wb = (_b = weightOrder[bKey]) !== null && _b !== void 0 ? _b : 999;
            if (wa !== wb)
                return wa - wb;
            return aName.localeCompare(bName);
        }
        if (label === "Brand / Colors / Neutral" ||
            label === "Brand / Colors / Primary" ||
            label === "Brand / Colors / Success" ||
            label === "Brand / Colors / Warning" ||
            label === "Brand / Colors / Error") {
            const aFoundation = aName.includes("foundation-") ? 0 : 1;
            const bFoundation = bName.includes("foundation-") ? 0 : 1;
            if (aFoundation !== bFoundation)
                return aFoundation - bFoundation;
            const aNum = getNumericSuffix(aName);
            const bNum = getNumericSuffix(bName);
            if (aNum != null && bNum != null && aNum !== bNum) {
                return aNum - bNum;
            }
            if (aNum != null && bNum == null)
                return 1;
            if (aNum == null && bNum != null)
                return -1;
            return aName.localeCompare(bName);
        }
        if (label === "Brand / Scale") {
            if (aName.includes("-full") && !bName.includes("-full"))
                return 1;
            if (!aName.includes("-full") && bName.includes("-full"))
                return -1;
            const aNum = getNumericSuffix(aName);
            const bNum = getNumericSuffix(bName);
            if (aNum != null && bNum != null && aNum !== bNum) {
                return aNum - bNum;
            }
            return aName.localeCompare(bName);
        }
        if (label === "Alias / Spacing & Size" ||
            label === "Alias / Radius & Border") {
            const aPrefix = aName.split("-").slice(0, 2).join("-");
            const bPrefix = bName.split("-").slice(0, 2).join("-");
            if (aPrefix !== bPrefix) {
                return aPrefix.localeCompare(bPrefix);
            }
            const aTail = aName.split("-").slice(2).join("-");
            const bTail = bName.split("-").slice(2).join("-");
            const ao = getTShirtOrder(aTail);
            const bo = getTShirtOrder(bTail);
            if (ao !== bo)
                return ao - bo;
            return aTail.localeCompare(bTail);
        }
        if (label === "Alias / Semantic Colors") {
            const aParts = aName.split("-");
            const bParts = bName.split("-");
            const aFamily = aParts.slice(0, 2).join("-");
            const bFamily = bParts.slice(0, 2).join("-");
            const familyOrder = {
                "alias-neutral": 10,
                "alias-primary": 20,
                "alias-success": 30,
                "alias-warning": 40,
                "alias-error": 50,
            };
            const afo = (_c = familyOrder[aFamily]) !== null && _c !== void 0 ? _c : 999;
            const bfo = (_d = familyOrder[bFamily]) !== null && _d !== void 0 ? _d : 999;
            if (afo !== bfo)
                return afo - bfo;
            const aTail = aParts.slice(2).join("-");
            const bTail = bParts.slice(2).join("-");
            if (aTail === "default" && bTail !== "default")
                return 1;
            if (aTail !== "default" && bTail === "default")
                return -1;
            const aNum = getNumericSuffix(aName);
            const bNum = getNumericSuffix(bName);
            if (aNum != null && bNum != null && aNum !== bNum) {
                return aNum - bNum;
            }
            return aTail.localeCompare(bTail);
        }
        if (label === "Semantic / Text" ||
            label === "Semantic / Surface" ||
            label === "Semantic / Border" ||
            label === "Semantic / Icon") {
            const aTail = aName.split("-").slice(1).join("-");
            const bTail = bName.split("-").slice(1).join("-");
            const ao = getStateOrder(aTail);
            const bo = getStateOrder(bTail);
            if (ao !== bo)
                return ao - bo;
            return aTail.localeCompare(bTail);
        }
        return aName.localeCompare(bName);
    });
    return copy;
}
function pushGroupedEntries(lines, entries) {
    const groups = new Map();
    for (const entry of entries) {
        const label = getGroupLabel(entry.name);
        let arr = groups.get(label);
        if (!arr) {
            arr = [];
            groups.set(label, arr);
        }
        arr.push(entry);
    }
    const orderedLabels = Array.from(groups.keys()).sort((a, b) => {
        const diff = getGroupOrder(a) - getGroupOrder(b);
        if (diff !== 0)
            return diff;
        return a.localeCompare(b);
    });
    for (let i = 0; i < orderedLabels.length; i++) {
        const label = orderedLabels[i];
        const entriesInGroup = sortEntriesInGroup(label, groups.get(label) || []);
        if (lines.length > 0 && lines[lines.length - 1] !== "") {
            lines.push("");
        }
        const commentLines = formatSectionComment(label);
        for (const commentLine of commentLines) {
            lines.push(commentLine);
        }
        for (const entry of entriesInGroup) {
            lines.push(`  ${entry.name}: ${entry.value};`);
        }
    }
}
async function exportVariablesToCss(outputMode = "preserve") {
    var _a;
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const variables = await figma.variables.getLocalVariablesAsync();
    const collectionMap = new Map(collections.map((c) => [c.id, c]));
    const variableMap = new Map(variables.map((v) => [v.id, v]));
    const varsByCollection = new Map();
    for (const variable of variables) {
        const list = (_a = varsByCollection.get(variable.variableCollectionId)) !== null && _a !== void 0 ? _a : [];
        list.push(variable);
        varsByCollection.set(variable.variableCollectionId, list);
    }
    const blocks = [];
    const blockMap = new Map();
    for (const collection of collections) {
        let collectionVars = varsByCollection.get(collection.id);
        if (!collectionVars) {
            collectionVars = [];
        }
        collectionVars.sort((a, b) => a.name.localeCompare(b.name));
        for (const mode of collection.modes) {
            const selector = modeSelector(mode.name, collection.modes.length);
            let block = blockMap.get(selector);
            if (!block) {
                block = { selector, entries: [] };
                blockMap.set(selector, block);
                blocks.push(block);
            }
            for (const variable of collectionVars) {
                const cssValue = await valueToCss(variable, mode.modeId, outputMode, variableMap, collectionMap);
                if (cssValue == null) {
                    continue;
                }
                const name = variableNameToCss(variable, collectionMap);
                const finalValue = addUnitIfNeeded(cssValue, variable, collectionMap);
                block.entries.push({
                    name,
                    value: finalValue,
                });
            }
        }
    }
    return blocks
        .map((block) => {
        const lines = [];
        pushGroupedEntries(lines, block.entries);
        while (lines.length && lines[lines.length - 1] === "") {
            lines.pop();
        }
        return `${block.selector} {\n${lines.join("\n")}\n}`;
    })
        .join("\n\n");
}
figma.showUI(__html__, { width: 760, height: 600 });
figma.ui.onmessage = async (msg) => {
    try {
        if (msg.type === "export-css") {
            const mode = msg.outputMode === "resolved" ? "resolved" : "preserve";
            const css = await exportVariablesToCss(mode);
            figma.ui.postMessage({ type: "css-result", css });
        }
        else if (msg.type === "close") {
            figma.closePlugin();
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        figma.ui.postMessage({ type: "error", message });
    }
};
