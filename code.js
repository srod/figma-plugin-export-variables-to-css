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
function simplifyMappedName(name) {
    let n = slugify(name);
    n = n.replace(/^mapped-/, "");
    n = n.replace(/^text-text-/, "text-");
    n = n.replace(/^border-border-/, "border-");
    n = n.replace(/^icon-icon-/, "icon-");
    n = n.replace(/^surface-layout-layout-/, "surface-");
    n = n.replace(/^surface-layout-/, "surface-");
    n = n.replace(/^surface-interactive-surface-/, "surface-");
    n = n.replace(/^surface-feedback-surface-/, "surface-");
    n = n.replace(/^surface-state-surface-/, "surface-");
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
function addUnitIfNeeded(cssName, cssValue, variable, collectionMap) {
    const collection = collectionMap.get(variable.variableCollectionId);
    const collectionName = collection ? slugify(collection.name) : "";
    const variableName = slugify(variable.name);
    // Brand scale => px
    if (collectionName === "brand" && variableName.indexOf("scale") !== -1) {
        if (/^-?\d+(\.\d+)?$/.test(cssValue)) {
            if (cssValue === "0")
                return "0";
            return cssValue + "px";
        }
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
async function findFallbackModeId(variable, requestedModeId, collectionMap) {
    const collection = collectionMap.get(variable.variableCollectionId);
    if (!collection)
        return null;
    if (variable.valuesByMode[requestedModeId] !== undefined) {
        return requestedModeId;
    }
    // fallback simple: default mode de la collection cible
    if (variable.valuesByMode[collection.defaultModeId] !== undefined) {
        return collection.defaultModeId;
    }
    // dernier fallback: premier mode qui a une valeur
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
    // preserve mode: on garde la référence si c'est un alias
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
async function exportVariablesToCss(outputMode = "preserve") {
    var _a, _b;
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
        const collectionVars = ((_b = varsByCollection.get(collection.id)) !== null && _b !== void 0 ? _b : []).sort((a, b) => a.name.localeCompare(b.name));
        for (const mode of collection.modes) {
            const selector = modeSelector(mode.name, collection.modes.length);
            let block = blockMap.get(selector);
            if (!block) {
                block = { selector, lines: [] };
                blockMap.set(selector, block);
                blocks.push(block);
            }
            block.lines.push(`  /* ${collection.name} — ${mode.name} */`);
            for (const variable of collectionVars) {
                const cssValue = await valueToCss(variable, mode.modeId, outputMode, variableMap, collectionMap);
                if (cssValue == null)
                    continue;
                // block.lines.push(
                // 	`  ${variableNameToCss(variable, collectionMap)}: ${cssValue};`,
                // );
                const name = variableNameToCss(variable, collectionMap);
                const finalValue = addUnitIfNeeded(name, cssValue, variable, collectionMap);
                block.lines.push("  " + name + ": " + finalValue + ";");
            }
            block.lines.push("");
        }
    }
    return blocks
        .map((block) => {
        const lines = [...block.lines];
        while (lines.length && lines[lines.length - 1] === "")
            lines.pop();
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
        if (msg.type === "close") {
            figma.closePlugin();
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        figma.ui.postMessage({ type: "error", message });
    }
};
