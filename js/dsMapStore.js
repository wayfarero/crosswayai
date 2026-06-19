const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

function normalizeFsPath(fsPath) {
    return path.normalize(String(fsPath || '')).toLowerCase();
}

function getDsMapPath(workspaceRoot) {
    return path.join(workspaceRoot, '.crosswayai', 'dsMap.json');
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
    getDsMapPath,
    getDsMapJsonObject
};