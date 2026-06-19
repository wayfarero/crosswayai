const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { resolveXrefFilePath, resolveProparseFilePath } = require('./diagramCommon');
const { getWorkspaceRoot } = require('./workspaceProjects');
const { getCrossWayAILog } = require('./crosswayaiLogger');
const { FILE_TYPES } = require('./extensionConstants');

function escapeRegExp(text) {
    return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSignatureText(sig) {
    return String(sig || '').replace(/\s+/g, '').toLowerCase();
}

function extractParamTypeSequence(sig) {
    return String(sig || '')
        .split(',')
        .map((rawPart) => {
            const part = String(rawPart || '').trim().toLowerCase();
            if (!part) {
                return '';
            }

            const afterAs = part.match(/\bas\b\s+([\w.-]+)/i);
            if (afterAs && afterAs[1]) {
                return afterAs[1].toLowerCase();
            }

            const tokens = part.split(/\s+/).filter(Boolean);
            if (tokens.length === 0) {
                return '';
            }

            return tokens[tokens.length - 1].replace(/[^\w.-]/g, '');
        })
        .filter(Boolean)
        .join(',');
}

function signatureMatches(defSig, targetSig) {
    const normalizedDef = normalizeSignatureText(defSig);
    const normalizedTarget = normalizeSignatureText(targetSig);
    if (normalizedDef && normalizedTarget && normalizedDef === normalizedTarget) {
        return true;
    }

    const defTypes = extractParamTypeSequence(defSig);
    const targetTypes = extractParamTypeSequence(targetSig);
    return Boolean(defTypes && targetTypes && defTypes === targetTypes);
}

function findMethodRange(doc, methodName, signature) {
    let startLine = 0;
    let found = false;
    const signatureCandidates = String(signature || '')
        .split('|||')
        .map((entry) => String(entry || '').trim())
        .filter(Boolean);

    if (signatureCandidates.length > 0) {
        for (let i = 0; i < doc.lineCount; i++) {
            const lineText = doc.lineAt(i).text;
            const methodDefMatch = lineText.match(/^\s*method\b[\w\s]*\b([\w_]+)\b\s*\(([^)]*)\)/i);
            if (methodDefMatch) {
                const defName = methodDefMatch[1];
                const defSig = methodDefMatch[2] || '';
                const matchedCandidate = signatureCandidates.some((candidate) => signatureMatches(defSig, candidate));
                if (defName === methodName && matchedCandidate) {
                    startLine = i;
                    found = true;
                    break;
                }
            }
        }
    }

    if (!found) {
        const escapedMethodName = escapeRegExp(methodName);
        const regex = new RegExp(`^\\s*method\\b[\\w\\s]*\\b${escapedMethodName}\\b`, 'i');
        for (let i = 0; i < doc.lineCount; i++) {
            const lineText = doc.lineAt(i).text;
            if (regex.test(lineText)) {
                startLine = i;
                break;
            }
        }
    }

    let endLine = startLine;
    const endMethodRegex = /^end\s+method\.$/i;
    for (let i = startLine + 1; i < doc.lineCount; i++) {
        const lineText = doc.lineAt(i).text.trim();
        if (endMethodRegex.test(lineText)) {
            endLine = i;
            break;
        }
    }

    return [startLine, endLine];
}

function findPropertyRange(doc, propertyName) {
    const regex = new RegExp(`^\\s*define\\s+(?:[a-zA-Z]+\\s+)*property\\s+${propertyName}\\b`, 'i');
    let startLine = 0;
    for (let i = 0; i < doc.lineCount; i++) {
        const lineText = doc.lineAt(i).text;
        if (regex.test(lineText)) {
            startLine = i;
            break;
        }
    }

    const endGetRegex = /^end\s+get\.$/i;
    const setRegex = /^\s*\w+\s+set\.$/i;
    const getRegex = /^\s*\w+\s+get\.$/i;
    const propertyDefRegex = /^\s*define\s+(?:[a-zA-Z]+\s+)*property\s+\w+/i;
    let lastMatch = startLine;
    for (let i = startLine + 1; i < doc.lineCount; i++) {
        const lineText = doc.lineAt(i).text.trim();
        if (propertyDefRegex.test(lineText)) {
            break;
        }
        if (endGetRegex.test(lineText) || setRegex.test(lineText) || getRegex.test(lineText)) {
            lastMatch = i;
        }
    }

    return [startLine, lastMatch];
}

function findProcedureRange(doc, procedureName) {
    const escapedProcedureName = escapeRegExp(procedureName);
    const startRegex = new RegExp(`^\\s*procedure\\s+${escapedProcedureName}\\s*:`, 'i');
    const endProcedureRegex = /^\s*end\s+procedure\b.*\.\s*$/i;
    const nextProcedureRegex = /^\s*procedure\s+[\w_]+\s*:/i;

    let startLine = 0;
    let found = false;
    for (let i = 0; i < doc.lineCount; i++) {
        const lineText = doc.lineAt(i).text;
        if (startRegex.test(lineText)) {
            startLine = i;
            found = true;
            break;
        }
    }

    if (!found) {
        return [0, 0];
    }

    let endLine = startLine;
    for (let i = startLine + 1; i < doc.lineCount; i++) {
        const lineText = doc.lineAt(i).text;
        if (endProcedureRegex.test(lineText)) {
            endLine = i;
            break;
        }
        if (nextProcedureRegex.test(lineText)) {
            endLine = i - 1 >= startLine ? i - 1 : startLine;
            break;
        }
    }

    return [startLine, endLine];
}

/**
 * Opens the corresponding XREF file for a given source file in the editor.
 * @param {object} uri - The file URI from the Explorer or Editor.
 */

async function openXrefFile( uri ) {
    await openFile( uri, FILE_TYPES.XREF );
}

/**
 * Opens the corresponding PROPARSE file for a given source file in the editor.
 * @param {object} uri - The file URI from the Explorer or Editor.
 */
async function openProparseFile( uri ) {
    await openFile( uri, FILE_TYPES.PROPARSE );
}

async function openFile( uri, type ) {

    const CrossWayAILog = getCrossWayAILog();
    const targetUri     = (uri && uri.fsPath)
                            ? uri
                            : (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document
                                ? vscode.window.activeTextEditor.document.uri
                                : null);

    if (!targetUri || !targetUri.fsPath) {
        vscode.window.showInformationMessage(`CrossWayAI: No file selected to resolve ${type}.`);
        return;
    }

    await openTargetFileFromSourcePath(targetUri.fsPath, getWorkspaceRoot(), type);
}

async function openTargetFileFromSourcePath(sourcePath, workspaceRoot, type) {
    const CrossWayAILog = getCrossWayAILog();
    if (!sourcePath || !workspaceRoot) {
        return;
    }

    const filePath = type === FILE_TYPES.XREF 
                      ? resolveXrefFilePath(sourcePath, workspaceRoot) 
                      : resolveProparseFilePath(sourcePath, workspaceRoot);

    if (!filePath) {
        CrossWayAILog.appendLine(`${type} file not found for source file: ${sourcePath}`);
        vscode.window.showErrorMessage(`CrossWayAI: Could not find ${type} file for ${path.basename(sourcePath)}`);
        return;
    }

    try {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
        await vscode.window.showTextDocument(doc, {
            viewColumn: vscode.ViewColumn.One,
            preview: false,
            preserveFocus: false
        });
        return true;
    } catch (error) {
        CrossWayAILog.appendLine(`Failed to open ${type} file: ${filePath} - ${error.message}`);
        vscode.window.showErrorMessage(`CrossWayAI: Could not open ${type} file: ${path.basename(filePath)}`);
        return false;
    }

}

module.exports = {
    openXrefFile,
    openProparseFile,
    openTargetFileFromSourcePath,
    findMethodRange,
    findPropertyRange,
    findProcedureRange
};
