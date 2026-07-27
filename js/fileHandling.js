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

function stripTypeNamespace(typeToken) {
    // Source method definitions frequently use the short class name (e.g.
    // "TeamMember") thanks to USING statements, while the diagram-provided
    // signature carries the fully qualified name (e.g.
    // "Enterprise.HR.Role.TeamMember"). Reduce both to the final dotted
    // segment so the two forms resolve to the same overload.
    const token = String(typeToken || '').trim();
    if (!token) {
        return '';
    }
    const segments = token.split('.');
    return segments[segments.length - 1];
}

function extractParamTypeSequence(sig) {
    // Compare overloads by parameter types when source text and diagram text differ.
    return String(sig || '')
        .split(',')
        .map((rawPart) => {
            const part = String(rawPart || '').trim().toLowerCase();
            if (!part) {
                return '';
            }

            const afterAs = part.match(/\bas\b\s+([\w.-]+)/i);
            if (afterAs && afterAs[1]) {
                return stripTypeNamespace(afterAs[1].toLowerCase());
            }

            const tokens = part.split(/\s+/).filter(Boolean);
            if (tokens.length === 0) {
                return '';
            }

            return stripTypeNamespace(tokens[tokens.length - 1].replace(/[^\w.-]/g, ''));
        })
        .filter(Boolean)
        .join(',');
}

function signatureMatches(defSig, targetSig) {
    const normalizedDef = normalizeSignatureText(defSig);
    const normalizedTarget = normalizeSignatureText(targetSig);
    // Exact textual match. This intentionally also matches the no-parameter
    // overload, where both the definition and the target normalize to "".
    if (normalizedDef === normalizedTarget) {
        return true;
    }

    const defTypes = extractParamTypeSequence(defSig);
    const targetTypes = extractParamTypeSequence(targetSig);
    return defTypes === targetTypes && defTypes !== '';
}

function getCallableDefinition(lineText, targetName) {
    const text = String(lineText || '');
    const name = String(targetName || '').trim();
    if (!name) {
        return null;
    }

    // Parse a callable declaration generically: method, constructor, function, etc.
    const declarationMatch = text.match(/^\s*([a-z][\w-]*)\b([\s\S]*?)\(([^)]*)\)\s*([:.])?/i);
    if (!declarationMatch) {
        return null;
    }

    const prefix = declarationMatch[2] || '';
    const nameMatch = prefix.match(new RegExp(`\\b${escapeRegExp(name)}\\b\\s*$`, 'i'));
    if (!nameMatch) {
        return null;
    }

    const beforeName = prefix.slice(0, nameMatch.index).trim();
    const opensBlock = declarationMatch[4] === ':';

    return {
        kind: declarationMatch[1].toLowerCase(),
        name,
        signature: declarationMatch[3] || '',
        opensBlock,
        hasDeclarationPrefix: Boolean(beforeName)
    };
}

function findCallableEndLine(doc, startLine, blockKind) {
    if (!blockKind) {
        return -1;
    }

    const endBlockRegex = new RegExp(`^end\\s+${escapeRegExp(blockKind)}\\.$`, 'i');
    for (let i = startLine + 1; i < doc.lineCount; i++) {
        const lineText = doc.lineAt(i).text.trim();
        if (endBlockRegex.test(lineText)) {
            return i;
        }
    }

    return -1;
}

function findMethodRange(doc, methodName, signature) {
    const targetName = String(methodName || '').trim();
    if (!targetName) {
        return [0, 0];
    }
    const targetNameLower = targetName.toLowerCase();

    const hasSignature = signature !== null;
    // undefined/null means name-only lookup; "" is a real no-parameter overload.
    const signatureCandidates = hasSignature
        ? String(signature).split('|||').map((entry) => String(entry || '').trim())
        : [];

    function getRangeCandidate(lineIndex, requireSignatureMatch) {
        const lineText = doc.lineAt(lineIndex).text;
        const callableDef = getCallableDefinition(lineText, targetName);
        if (!callableDef || callableDef.name.toLowerCase() !== targetNameLower) {
            return null;
        }

        if (requireSignatureMatch) {
            const matchedCandidate = signatureCandidates.some((candidate) => signatureMatches(callableDef.signature, candidate));
            if (!matchedCandidate) {
                return null;
            }
        }

        const closedBlockEndLine = findCallableEndLine(doc, lineIndex, callableDef.kind);
        // Avoid treating call expressions like "run Foo()" as declarations.
        if (closedBlockEndLine === -1 && !callableDef.opensBlock && !callableDef.hasDeclarationPrefix) {
            return null;
        }

        return {
            startLine: lineIndex,
            endLine: closedBlockEndLine === -1 ? lineIndex : closedBlockEndLine,
            hasClosedBlock: closedBlockEndLine !== -1
        };
    }

    function findRangeCandidate(requireSignatureMatch) {
        let fallbackCandidate = null;
        for (let i = 0; i < doc.lineCount; i++) {
            const candidate = getRangeCandidate(i, requireSignatureMatch);
            if (!candidate) {
                continue;
            }
            if (candidate.hasClosedBlock) {
                return candidate;
            }
            // Keep single-line declarations as a fallback, but prefer real blocks.
            if (!fallbackCandidate) {
                fallbackCandidate = candidate;
            }
        }

        return fallbackCandidate;
    }

    let rangeCandidate = null;
    if (signatureCandidates.length > 0) {
        rangeCandidate = findRangeCandidate(true);
    }

    if (!rangeCandidate) {
        rangeCandidate = findRangeCandidate(false);
    }

    if (!rangeCandidate) {
        return [0, 0];
    }

    return [rangeCandidate.startLine, rangeCandidate.endLine];
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
