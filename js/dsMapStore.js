const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

function normalizeFsPath(fsPath) {
    return path.normalize(String(fsPath || '')).toLowerCase();
}

function getDsMapPath(workspaceRoot) {
    return path.join(workspaceRoot, '.crosswayai', 'dsMap.json');
}

function getDsMapArray(dsMapJson, tableName) {
    return (((dsMapJson || {}).dsMap || {})[tableName]) || [];
}

/**
 * Finds the ttFileNode row of a source file. A missing node does not mean the file
 * is unknown: ABL prunes .p/.i/.w nodes without any ttFileLink before dsMap.json is
 * written, so a file can keep its ttFile row while losing its node.
 */
function findFileNodeByPath(dsMapJson, filePath) {
    if (!filePath) {
        return null;
    }

    const normalizedPath = normalizeFsPath(filePath);
    return getDsMapArray(dsMapJson, 'ttFileNode')
        .find(fileNode => normalizeFsPath(fileNode.FilePath) === normalizedPath) || null;
}

/**
 * Finds the ttFile inventory row of a source file. Unlike `findDsMapFileEntry` in
 * diagramCommon this does not fall back to ttFileNode, because telling the two
 * tables apart is what identifies a floating file.
 */
function findFileByPath(dsMapJson, filePath) {
    if (!filePath) {
        return null;
    }

    const normalizedPath = normalizeFsPath(filePath);
    return getDsMapArray(dsMapJson, 'ttFile')
        .find(file => normalizeFsPath(file.filePath) === normalizedPath) || null;
}

/**
 * Keeps the first ttFile per normalized path. Overlapping source folders can
 * collect the same file multiple times, and duplicates break READ-JSON in ABL.
 * Comparison is case-insensitive because the ABL index is case-insensitive.
 */
function dedupeFilesByPath(files) {
    const seenPaths = new Set();
    const uniqueFiles = [];

    for (const file of files || []) {
        const key = normalizeFsPath(file.filePath || file.FilePath);
        if (seenPaths.has(key)) {
            continue;
        }

        seenPaths.add(key);
        uniqueFiles.push(file);
    }

    return uniqueFiles;
}

function getDsMapJsonObject(workspaceRoot, suppressMissingFileMessage = false) {
    if (!workspaceRoot) {
        return null;
    }

    const dsMapPath = getDsMapPath(workspaceRoot);

    if (!fs.existsSync(dsMapPath)) {
        if (!suppressMissingFileMessage && vscode && vscode.window && typeof vscode.window.showErrorMessage === 'function') {
            vscode.window.showErrorMessage('CrossWayAI: dsMap.json not found. Please generate the map first.');
        }
        return null;
    }

    const dsMapContent = fs.readFileSync(dsMapPath, 'utf8');
    return JSON.parse(dsMapContent);
}

module.exports = {
    normalizeFsPath,
    dedupeFilesByPath,
    getDsMapPath,
    getDsMapJsonObject,
    getDsMapArray,
    findFileNodeByPath,
    findFileByPath
};
