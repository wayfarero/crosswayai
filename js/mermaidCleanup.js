const fs = require('fs');
const path = require('path');
const { 
    SUPPORTED_SOURCE_EXTENSIONS, 
    DIAGRAM_PREFIXES } = require('./extensionConstants');
const {
    getDsMapArray,
    getDsMapJsonObject,
    resolveMermaidRelativeDir,
    toMermaidNodeId } = require('./diagramCommon');
const { getCrossWayAILog } = require('./crosswayaiLogger');

function logCleanupMessage(message) {
    const CrossWayAILog = getCrossWayAILog();
    if (CrossWayAILog && typeof CrossWayAILog.appendLine === 'function') {
        CrossWayAILog.appendLine(message);
    }
}

function isSupportedSourceFilePath(filePath) {
    if (typeof filePath !== 'string' || !filePath) {
        return false;
    }

    return SUPPORTED_SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function walkDirectory(rootPath, visitFile) {
    if (!rootPath || !fs.existsSync(rootPath)) {
        return;
    }

    let entries;
    try {
        entries = fs.readdirSync(rootPath, { withFileTypes: true });
    } catch (error) {
        logCleanupMessage(`Failed to scan Mermaid directory ${rootPath}: ${error.message}`);
        return;
    }

    entries.forEach(entry => {
        const entryPath = path.join(rootPath, entry.name);
        if (entry.isDirectory()) {
            walkDirectory(entryPath, visitFile);
            return;
        }

        if (entry.isFile()) {
            visitFile(entryPath);
        }
    });
}

function visitFlatMarkdownFiles(rootPath, visitFile) {
    if (!rootPath || !fs.existsSync(rootPath)) {
        return;
    }

    let entries;
    try {
        entries = fs.readdirSync(rootPath, { withFileTypes: true });
    } catch (error) {
        logCleanupMessage(`Failed to scan legacy Mermaid directory ${rootPath}: ${error.message}`);
        return;
    }

    entries.forEach(entry => {
        if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.md') {
            return;
        }

        visitFile(path.join(rootPath, entry.name));
    });
}

function extractSourceNodeIdFromMd(mdPath) {
    try {
        const content = fs.readFileSync(mdPath, 'utf8');
        const match = content.match(/^%%CROSSWAY_SOURCE_NODE:([A-Za-z0-9_\-]+)\s*$/m);
        if (match && match[1]) {
            return match[1];
        }
    } catch (error) {
        logCleanupMessage(`Failed to read Mermaid source metadata from ${mdPath}: ${error.message}`);
    }

    return null;
}

function isDiagramMatch(filePath, matchContext) {
    if (typeof filePath !== 'string' || !filePath.toLowerCase().endsWith('.md')) {
        return false;
    }

    const stem = path.basename(filePath, '.md');
    const matchingPrefix = DIAGRAM_PREFIXES.find(prefix => stem.toLowerCase().startsWith(prefix + '_'));
    const targetName = matchingPrefix
        ? stem.slice(matchingPrefix.length + 1)
        : stem;

    const normalizedTargetName = String(targetName).toLowerCase();
    const normalizedSourceFileName = String(matchContext.sourceFileName).toLowerCase();
    const normalizedSourceBaseName = String(matchContext.sourceBaseName).toLowerCase();

    if (!(normalizedTargetName === normalizedSourceFileName || normalizedTargetName === normalizedSourceBaseName)) {
        return false;
    }

    const mdSourceId = extractSourceNodeIdFromMd(filePath);
    if (!mdSourceId) {
        return true;
    }

    const candidates = [
        toMermaidNodeId(matchContext.sourceFilePath),
        toMermaidNodeId(matchContext.sourceFileName),
        toMermaidNodeId(matchContext.sourceBaseName)
    ].map(candidate => String(candidate).toLowerCase());

    if (matchContext.nodeId) {
        candidates.push(toMermaidNodeId(String(matchContext.nodeId)).toLowerCase());
    }

    return candidates.includes(String(mdSourceId).toLowerCase());
}

function findSourceFileNode(workspaceRoot, sourceFilePath) {
    try {
        const dsMapJson = getDsMapJsonObject(workspaceRoot);
        if (!dsMapJson) {
            return null;
        }

        const fileNodes = getDsMapArray(dsMapJson, 'ttFileNode');
        const normalizedPath = path.normalize(sourceFilePath).toLowerCase();
        return fileNodes.find(node => {
            const nodePath = path.normalize(node.FilePath || '').toLowerCase();
            return nodePath === normalizedPath;
        }) || null;
    } catch (error) {
        logCleanupMessage(`Failed to look up source file in dsMap for Mermaid cleanup: ${error.message}`);
        return null;
    }
}

function resolveCleanupRelativeDir(workspaceRoot, sourceFilePath, sourceFileNode, mermaidRelativeDir) {
    if (mermaidRelativeDir) {
        return mermaidRelativeDir;
    }

    try {
        return resolveMermaidRelativeDir(sourceFilePath, workspaceRoot, sourceFileNode) || '';
    } catch (error) {
        logCleanupMessage(`Failed to resolve Mermaid cleanup directory for ${sourceFilePath}: ${error.message}`);
        return '';
    }
}

function getCleanupScanTarget(mermaidRoot, mermaidRelativeDir) {
    if (!mermaidRelativeDir) {
        return {
            rootPath: mermaidRoot,
            recursive: false
        };
    }

    const normalizedRelativeDir = String(mermaidRelativeDir).split(path.sep).join('/');
    const targetPath = path.resolve(mermaidRoot, normalizedRelativeDir);
    const relativePath = path.relative(mermaidRoot, targetPath);

    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        logCleanupMessage(`Refusing to scan Mermaid cleanup directory outside root: ${targetPath}`);
        return {
            rootPath: mermaidRoot,
            recursive: false
        };
    }

    return {
        rootPath: targetPath,
        recursive: true
    };
}

function collectMatchingDiagramPaths(scanTarget, matchContext) {
    const matchedPaths = [];
    const seenPaths = new Set();

    function addMatch(entryPath) {
        if (!isDiagramMatch(entryPath, matchContext)) {
            return;
        }

        if (seenPaths.has(entryPath)) {
            return;
        }

        seenPaths.add(entryPath);
        matchedPaths.push(entryPath);
    }

    if (scanTarget.recursive) {
        walkDirectory(scanTarget.rootPath, addMatch);
    } else {
        visitFlatMarkdownFiles(scanTarget.rootPath, addMatch);
    }

    return matchedPaths;
}

function deleteDiagramFiles(matchedPaths) {
    const removedPaths = [];
    matchedPaths.forEach(filePath => {
        try {
            fs.unlinkSync(filePath);
            removedPaths.push(filePath);
        } catch (error) {
            logCleanupMessage(`Failed to remove Mermaid diagram ${filePath}: ${error.message}`);
        }
    });

    return removedPaths;
}

function removeMermaidDiagramsForSourceFile(workspaceRoot, sourceFilePath, mermaidRelativeDir = '') {
    if (!workspaceRoot || !sourceFilePath || !isSupportedSourceFilePath(sourceFilePath)) {
        return [];
    }

    const mermaidRoot = path.join(workspaceRoot, '.crosswayai', 'mermaid');
    const sourceFileNode = findSourceFileNode(workspaceRoot, sourceFilePath);
    const resolvedRelativeDir = resolveCleanupRelativeDir(workspaceRoot, sourceFilePath, sourceFileNode, mermaidRelativeDir);
    const scanTarget = getCleanupScanTarget(mermaidRoot, resolvedRelativeDir);
    const matchContext = {
        sourceFilePath,
        sourceFileName: path.basename(sourceFilePath),
        sourceBaseName: path.basename(sourceFilePath, path.extname(sourceFilePath)),
        nodeId: sourceFileNode && sourceFileNode.NodeId ? sourceFileNode.NodeId : null
    };

    const matchedPaths = collectMatchingDiagramPaths(scanTarget, matchContext);
    return deleteDiagramFiles(matchedPaths);
}

module.exports = {
    isSupportedSourceFilePath,
    removeMermaidDiagramsForSourceFile
};
