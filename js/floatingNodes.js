const path = require('path');
const {
    getDsMapArray,
    normalizeFsPath,
    findFileByPath,
    findFileNodeByPath } = require('./dsMapStore');
const {
    LINK_INDEPENDENT_DIAGRAM_PREFIXES,
    SOURCE_FILE_MAP_STATE } = require('./extensionConstants');

/**
 * How a source file is represented in dsMap.json.
 *
 * MAPPED   - the file has a ttFileNode participating in at least one ttFileLink.
 * FLOATING - the file is known to the analysis but has no incoming or outgoing
 *            ttFileLink. Its node is pruned for .p/.i/.w and retained for .cls so
 *            package diagrams can still be generated.
 * UNKNOWN  - the file is not part of dsMap.json at all.
 */
function getSourceFileMapState(dsMapJson, filePath) {
    const file = findFileByPath(dsMapJson, filePath);
    const fileNode = findFileNodeByPath(dsMapJson, filePath);
    const linkedNodeIds = collectLinkedNodeIds(dsMapJson);

    return classifySourceFileMapState(file, fileNode, linkedNodeIds);
}

function classifySourceFileMapState(file, fileNode, linkedNodeIds) {
    if (!file) {
        return { status: SOURCE_FILE_MAP_STATE.UNKNOWN, fileNode: null };
    }

    if (fileNode && linkedNodeIds.has(fileNode.NodeId)) {
        return { status: SOURCE_FILE_MAP_STATE.MAPPED, fileNode };
    }

    return { status: SOURCE_FILE_MAP_STATE.FLOATING, fileNode };
}

function isClassSourceFile(filePath) {
    return path.extname(String(filePath || '')).toLowerCase() === '.cls';
}

function collectLinkedNodeIds(dsMapJson) {
    const linkedNodeIds = new Set();

    getDsMapArray(dsMapJson, 'ttFileLink').forEach(link => {
        if (!link) {
            return;
        }

        if (link.NodeId !== undefined && link.NodeId !== null) {
            linkedNodeIds.add(link.NodeId);
        }
        if (link.ParentNodeId !== undefined && link.ParentNodeId !== null) {
            linkedNodeIds.add(link.ParentNodeId);
        }
    });

    return linkedNodeIds;
}

function isLinkIndependentDiagramType(diagramType) {
    return LINK_INDEPENDENT_DIAGRAM_PREFIXES.includes(diagramType);
}

function canGenerateDiagramForSource(sourceState, filePath, diagramType) {
    if (!sourceState) {
        return false;
    }

    if (sourceState.status === SOURCE_FILE_MAP_STATE.MAPPED) {
        return true;
    }

    if (sourceState.status !== SOURCE_FILE_MAP_STATE.FLOATING || !sourceState.fileNode) {
        return false;
    }

    return isClassSourceFile(filePath) && isLinkIndependentDiagramType(diagramType);
}

function buildFileNodesByPath(dsMapJson) {
    const fileNodesByPath = new Map();

    getDsMapArray(dsMapJson, 'ttFileNode').forEach(fileNode => {
        if (fileNode && fileNode.FilePath && fileNode.Virtual !== true) {
            fileNodesByPath.set(normalizeFsPath(fileNode.FilePath), fileNode);
        }
    });

    return fileNodesByPath;
}

function buildNodeIdsByPath(dsMapJson) {
    const nodeIdsByPath = new Map();

    getDsMapArray(dsMapJson, 'ttFileNode').forEach(fileNode => {
        if (!fileNode || !fileNode.FilePath) {
            return;
        }
        if (fileNode.NodeId === undefined || fileNode.NodeId === null) {
            return;
        }

        nodeIdsByPath.set(normalizeFsPath(fileNode.FilePath), fileNode.NodeId);
    });

    return nodeIdsByPath;
}

/**
 * Collects every source file that has no dependency left in either direction,
 * keyed by normalized path. Two different shapes end up here:
 *
 *  - .p/.i/.w files whose ttFileNode was pruned. No node is left, so their NodeId is
 *    unknown from this dsMap.json alone.
 *  - .cls files that keep their node but have no ttFileLink row pointing at it.
 *
 * Both make every link-driven diagram impossible to regenerate, which is why they
 * are cleaned up the same way.
 */
function collectFloatingSourceFiles(dsMapJson) {
    const linkedNodeIds = collectLinkedNodeIds(dsMapJson);
    const fileNodesByPath = buildFileNodesByPath(dsMapJson);
    const floatingByPath = new Map();

    getDsMapArray(dsMapJson, 'ttFile').forEach(file => {
        if (!file || !file.filePath) {
            return;
        }

        const normalizedPath = normalizeFsPath(file.filePath);
        if (floatingByPath.has(normalizedPath)) {
            return;
        }

        const fileNode = fileNodesByPath.get(normalizedPath) || null;
        const sourceState = classifySourceFileMapState(file, fileNode, linkedNodeIds);
        if (sourceState.status !== SOURCE_FILE_MAP_STATE.FLOATING) {
            return;
        }

        floatingByPath.set(normalizedPath, {
            filePath: file.filePath,
            nodeId: sourceState.fileNode ? sourceState.fileNode.NodeId : null,
            isClass: isClassSourceFile(file.filePath)
        });
    });

    return floatingByPath;
}

/**
 * Returns the files that became floating during the analysis run that sits between
 * the two dsMap.json states.
 *
 * The previous state is required for two reasons: files that were already floating
 * must not be cleaned up again on every run, and a pruned node's NodeId only exists
 * in the snapshot taken before the run. That NodeId is what a persisted diagram
 * carries in its %%CROSSWAY_SOURCE_NODE metadata.
 *
 * @returns {Array<{filePath: string, nodeId: (number|null), isClass: boolean}>}
 */
function collectNewlyFloatingSourceFiles(previousDsMapJson, currentDsMapJson) {
    const previousFloating = collectFloatingSourceFiles(previousDsMapJson);
    const currentFloating = collectFloatingSourceFiles(currentDsMapJson);
    const previousNodeIds = buildNodeIdsByPath(previousDsMapJson);
    const newlyFloating = [];

    currentFloating.forEach((floatingFile, normalizedPath) => {
        if (previousFloating.has(normalizedPath)) {
            return;
        }

        const knownNodeId = floatingFile.nodeId !== null
            ? floatingFile.nodeId
            : previousNodeIds.get(normalizedPath);

        newlyFloating.push({
            ...floatingFile,
            nodeId: knownNodeId === undefined ? null : knownNodeId
        });
    });

    return newlyFloating;
}

module.exports = {
    getSourceFileMapState,
    isLinkIndependentDiagramType,
    canGenerateDiagramForSource,
    collectFloatingSourceFiles,
    collectNewlyFloatingSourceFiles
};
