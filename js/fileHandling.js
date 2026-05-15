const vscode = require('vscode');
const fs = require('fs');
const { getWorkspaceRoot, resolveXrefFilePath } = require('./diagramCommon');
const path = require('path');
const { getCrossWayAILog } = require('./crosswayaiLogger');

/**
 * Opens the corresponding XREF file for a given source file in the editor.
 * @param {object} deps - Dependency injection for VS Code, fs, logger, etc.
 * @param {object} context - VS Code extension context.
 * @param {object} uri - The file URI from the Explorer or Editor.
 */
async function openXrefFile(context, uri) {
    const CrossWayAILog = getCrossWayAILog();
    const targetUri = (uri && uri.fsPath)
        ? uri
        : (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document
            ? vscode.window.activeTextEditor.document.uri
            : null);

    if (!targetUri || !targetUri.fsPath) {
        vscode.window.showInformationMessage('CrossWayAI: No file selected to resolve XREF.');
        return;
    }

    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        return;
    }

    const sourcePath = targetUri.fsPath;
    const xrefFilePath = resolveXrefFilePath(sourcePath, workspaceRoot);
    if (!xrefFilePath) {
        CrossWayAILog.appendLine(`XREF file not found for source file: ${sourcePath}`);
        vscode.window.showErrorMessage(`CrossWayAI: Could not find XREF file for ${path.basename(sourcePath)}`);
        return;
    }

    try {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(xrefFilePath));
        await vscode.window.showTextDocument(doc, {
            viewColumn: vscode.ViewColumn.One,
            preview: false,
            preserveFocus: false
        });
    } catch (error) {
        CrossWayAILog.appendLine(`Failed to open XREF file: ${xrefFilePath} - ${error.message}`);
        vscode.window.showErrorMessage(`CrossWayAI: Could not open XREF file: ${path.basename(xrefFilePath)}`);
    }
}

module.exports = {
    openXrefFile
};
