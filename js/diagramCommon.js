const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { buildNodeLabel } = require('./nodeLabel');
const { getCrossWayAILog } = require('./crosswayaiLogger');
const diagramColors = require('../resources/diagram-colors.json');
const { getExclusionsSettings, createExclusionMatcher } = require('./crosswayaiSettings');
const { normalizeFsPath, getDsMapPath, getDsMapJsonObject } = require('./dsMapStore');
const { getRuntimeDLC, getWorkspaceRoot } = require('./workspaceProjects');
const { KNOWN_OE_VERSIONS } = require('./extensionConstants');


async function cleanupDirectory(dirPath) {
    const CrossWayAILog = getCrossWayAILog();
    try {
        if (fs.existsSync(dirPath)) {
            await fs.promises.rm(dirPath, { recursive: true, force: true });
            if (CrossWayAILog) CrossWayAILog.appendLine('>Cleaned up directory: ' + dirPath);
        }
    } catch (e) {
        if (CrossWayAILog) CrossWayAILog.appendLine('>Warning: Failed to clean up directory: ' + e.message);
    }
}


/**
 * Runs an ABL script using the provided parameters.
 * @param {Object} options - Options for running the ABL script.
 * @param {Object} options.context - VS Code extension context.
 * @param {string} options.workspaceRoot - The workspace root directory.
 * @param {string} [options.oeversion] - Explicit OpenEdge version override.
 * @param {string} [options.scriptName] - The relative path to the ABL script to run (default: 'core/runAnalysis.p').
 * @param {string[]} [options.args] - Additional arguments for the ABL process.
 * @returns {Promise<void>} Resolves when the process finishes successfully, rejects on error.
 */
async function runABLScript({ context, workspaceRoot, oeversion, scriptName, args: extraArgs = []}) {
    const CrossWayAILog = getCrossWayAILog();
    const crosswayaiDir = path.join(workspaceRoot, '.crosswayai');
    const crosswayaiTempDir = path.join(crosswayaiDir, 'temp');

    if (!fs.existsSync(crosswayaiTempDir)) {
        fs.mkdirSync(crosswayaiTempDir);
    }

    const logFile = path.join(crosswayaiDir, 'crosswayai.log');
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });

    // Determine oeversion from the provided option, otherwise fallback to the workspace default runtime.
    if (!oeversion) {
        try {
            const defaultRuntime = vscode.workspace.getConfiguration('abl.configuration').get('defaultRuntime');
            if (defaultRuntime) {
                oeversion = defaultRuntime;
                CrossWayAILog.appendLine(`>oeversion '${defaultRuntime}' picked up from workspace defaultRuntime`);
            }
        } catch (e) {
            CrossWayAILog.appendLine(`>runABLScript: failed to read defaultRuntime: ${e.message}`);
        }

        if (!oeversion) {
            vscode.window.showErrorMessage('Could not determine OpenEdge version (oeversion). Set abl.configuration.defaultRuntime or provide oeversion in openedge-project.json.');
            return;
        }
    }
    const oeversionSafe = String(oeversion).replace(/\./g, '');
    const plDir = path.join(context.extensionPath, 'resources', 'abl', 'pl');
    let extensionAblPath = path.join(plDir, `crosswayai_oe${oeversionSafe}.pl`);
    if (!fs.existsSync(extensionAblPath)) {
        const majorVersion = String(oeversion).split('.')[0];
        const fallbackVersion = KNOWN_OE_VERSIONS.find(version => String(version).split('.')[0] === majorVersion);
        if (fallbackVersion) {
            const fallbackVersionSafe = String(fallbackVersion).replace(/\./g, '');
            const fallbackPLName = `crosswayai_oe${fallbackVersionSafe}.pl`;
            extensionAblPath = path.join(plDir, fallbackPLName);
            CrossWayAILog.appendLine(`>oeversion ${oeversion} PL not found, falling back to ${fallbackPLName}`);
        } else {
            vscode.window.showErrorMessage(`CrossWayAI: No compatible PL file found for OpenEdge version ${oeversion}.`);
            return;
        }
    }
    const runtimeDLC = getRuntimeDLC(oeversion);
    if (!runtimeDLC) {
        vscode.window.showErrorMessage(`CrossWayAI: No runtime path configured for OpenEdge version ${oeversion}. Please configure abl.configuration.runtimes in your settings.`);
        return;
    }
    const prodictPath = path.join(runtimeDLC, 'tty','prodict.pl');
    const adecommPath = path.join(runtimeDLC, 'tty','adecomm.pl');
    const runScriptPath = scriptName;
    const effectivePropath = `${extensionAblPath},${context.extensionPath},${prodictPath},${adecommPath}`;
    const executable = path.join(runtimeDLC, 'bin', '_progres');
    const args = [
        '-b',
        '-p',
        runScriptPath,
        '-baseADE',
        effectivePropath,
        '-T',
        crosswayaiTempDir
    ];
    if (extraArgs && Array.isArray(extraArgs)) {
        args.push(...extraArgs);
    }

    CrossWayAILog.appendLine(`>Spawning ABL process: ${executable} ${args.join(' ')}`);
    CrossWayAILog.appendLine(`>Logging to: ${logFile}`);
    CrossWayAILog.show(true);
    return new Promise((resolve, reject) => {
        const ablProcess = require('child_process').spawn(executable, args);
        ablProcess.stdout.pipe(logStream);
        ablProcess.stderr.pipe(logStream);
        ablProcess.on('error', (error) => {
            CrossWayAILog.appendLine(`spawn error: ${error}`);
            CrossWayAILog.show(true);
            vscode.window.showErrorMessage(`ABL script execution failed. Make sure '${executable}' is in your system's PATH. Error: ${error.message}`);
            reject(error);
        });
        ablProcess.on('close', (code) => {
            if (code !== 0) {
                CrossWayAILog.appendLine(`ABL process exited with code ${code}`);
                CrossWayAILog.show(true);
                vscode.window.showErrorMessage(`ABL script execution failed with code ${code}. See ${logFile} for details.`);
                reject(new Error(`ABL process exited with code ${code}`));
            } else {
                CrossWayAILog.appendLine(`>ABL process finished successfully.`);
                CrossWayAILog.show(true);
                vscode.window.showInformationMessage('CrossWayAI: ABL process finished successfully!');
                resolve();
            }
        });
    });
}

function toMermaidNodeId(value) {
    return String(value || 'unknown').replace(/[^a-zA-Z0-9_]/g, '_');
}

function getDsMapArray(dsMap, tableName) {
    return (((dsMap || {}).dsMap || {})[tableName]) || [];
}

function findDsMapFileEntry(dsMap, sourceFilePath) {
    const tables = ((dsMap || {}).dsMap || {});
    const files = []
        .concat(tables.ttFile || [])
        .concat(tables.ttFileNode || []);
    const normalizedSource = normalizeFsPath(sourceFilePath);
    return files.find(file => normalizeFsPath(file.filePath || file.FilePath) === normalizedSource) || null;
}

function resolveSourceFileLookupContext(sourceFilePath, workspaceRoot) {

    if (!sourceFilePath || !workspaceRoot) {
        return null;
    }

    const dsMapJson = getDsMapJsonObject(workspaceRoot);
    const fileEntry = findDsMapFileEntry(dsMapJson, sourceFilePath);
    if (!fileEntry) {
        return null;
    }

    const projectName = String(fileEntry.project || fileEntry.Project || '').trim();
    const sourceName = String(fileEntry.source || fileEntry.Source || '').trim();
    const projectRoot = projectName ? path.join(workspaceRoot, projectName) : workspaceRoot;
    const sourceRoot = sourceName ? path.join(projectRoot, sourceName) : projectRoot;
    const relativeSourcePath = path.relative(sourceRoot, sourceFilePath);

    if (!relativeSourcePath || relativeSourcePath.startsWith('..') || path.isAbsolute(relativeSourcePath)) {
        return null;
    }

    return {
        projectName,
        sourceName,
        projectRoot,
        sourceRoot,
        relativeSourcePath
    };
}

function resolveXrefFilePath(sourceFilePath, workspaceRoot) {
    const CrossWayAILog = getCrossWayAILog();
    const lookupContext = resolveSourceFileLookupContext(sourceFilePath, workspaceRoot);
    if (!lookupContext) {
        return null;
    }

    const { projectRoot, relativeSourcePath } = lookupContext;
    const builderDir = path.join(projectRoot, '.builder');
    if (!fs.existsSync(builderDir)) {
        return null;
    }

    let pctDirs = [];
    try {
        pctDirs = fs.readdirSync(builderDir, { withFileTypes: true })
            .filter(entry => entry.isDirectory() && /^\.pct\d+$/i.test(entry.name))
            .map(entry => entry.name)
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    } catch (error) {
        if (CrossWayAILog) {
            CrossWayAILog.appendLine(`Failed to inspect .builder directory for XREF lookup: ${error.message}`);
        }
        return null;
    }

    for (const pctDir of pctDirs) {
        const candidate = path.join(builderDir, pctDir, `${relativeSourcePath}.xref`);
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return null;
}

function resolveProparseFilePath(sourceFilePath, workspaceRoot) {
    const lookupContext = resolveSourceFileLookupContext(sourceFilePath, workspaceRoot);
    if (!lookupContext) {
        return null;
    }

    const { projectName, sourceName, projectRoot, relativeSourcePath } = lookupContext;
    const parsed = path.parse(relativeSourcePath);
    const relativeAstPath = path.join(parsed.dir, `${parsed.name}.ast.json`);
    const candidate = path.join(
        workspaceRoot,
        '.crosswayai',
        '.proparse',
        projectName || path.basename(projectRoot),
        sourceName,
        relativeAstPath
    );

    return fs.existsSync(candidate) ? candidate : null;
}

function buildNodeDatabaseDetails(dsMap) {
    const databaseAccessRows = getDsMapArray(dsMap, 'ttDatabaseAccess');
    const fileNodes = getDsMapArray(dsMap, 'ttFileNode');

    if (databaseAccessRows.length === 0 || fileNodes.length === 0) {
        return {};
    }

    const nodeById = new Map();
    fileNodes.forEach(node => {
        if (node && node.NodeId !== undefined && node.NodeId !== null) {
            nodeById.set(node.NodeId, node);
        }
    });

    const detailsByNodeId = new Map();

    databaseAccessRows.forEach(row => {
        if (!row || row.NodeId === undefined || row.NodeId === null) {
            return;
        }

        const node = nodeById.get(row.NodeId);
        if (!node) {
            return;
        }

        const databaseName = String(row.DatabaseName || '').trim();
        const tableName = String(row.TableName || '').trim();
        if (!databaseName || !tableName) {
            return;
        }

        const mermaidNodeId = toMermaidNodeId(node.NodeId || node.FilePath || node.FileName);
        if (!detailsByNodeId.has(mermaidNodeId)) {
            detailsByNodeId.set(mermaidNodeId, new Map());
        }

        const dbMap = detailsByNodeId.get(mermaidNodeId);
        if (!dbMap.has(databaseName)) {
            dbMap.set(databaseName, new Set());
        }

        dbMap.get(databaseName).add(tableName);
    });

    const serialized = {};
    Array.from(detailsByNodeId.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .forEach(([nodeId, dbMap]) => {
            const groupedValues = {};

            Array.from(dbMap.entries())
                .sort((a, b) => a[0].localeCompare(b[0]))
                .forEach(([databaseName, tableNames]) => {
                    const values = Array.from(tableNames).sort((a, b) => a.localeCompare(b));
                    if (values.length > 0) {
                        groupedValues[databaseName] = values;
                    }
                });

            if (Object.keys(groupedValues).length > 0) {
                serialized[nodeId] = groupedValues;
            }
        });

    return serialized;
}

function getFirstLinkTypeEntry(linkType, { toLowerCase = true } = {}) {
    if (typeof linkType !== 'string') {
        return '';
    }

    const firstEntry = linkType.split(':')[0].trim();
    if (!firstEntry) {
        return '';
    }

    return toLowerCase ? firstEntry.toLowerCase() : firstEntry;
}

function parseCallSignature(rawLinkType) {
    if (typeof rawLinkType !== 'string') {
        return null;
    }

    const normalized = rawLinkType.trim();
    if (!normalized) {
        return null;
    }

    const lower = normalized.toLowerCase();
    let relationType = null;
    if (lower.startsWith('invoke:')) {
        relationType = 'invoke';
    } else if (lower.startsWith('run:')) {
        relationType = 'run';
    }
    if (!relationType) {
        return null;
    }

    const parts = normalized.split(':');
    if (parts.length < 2) {
        return null;
    }

    const callPart = parts[1].trim();
    if (!callPart) {
        return null;
    }

    const tokens = callPart.split(',');
    const methodName = (tokens[0] || '').trim();
    const params = tokens.slice(1).join(',').trim();
    if (!methodName) {
        return null;
    }

    return {
        relationType,
        methodName,
        params
    };
}

function getCallLabel(rawLinkType, { includeRelationSuffix = false } = {}) {
    const signature = parseCallSignature(rawLinkType);
    if (!signature) {
        return '';
    }

    const methodLabel = signature.methodName.replace(/\s+/g, ' ');
    if (!includeRelationSuffix) {
        return methodLabel;
    }

    return `${methodLabel} (${signature.relationType})`;
}

function collectDirectionalLinks(allFileLinks, startNodeId, predicate, {
    direction = 'down',
    visited = new Set(),
    linksToRender = new Set(),
    looseEquality = false
} = {}) {
    const equals = looseEquality ? ((a, b) => a == b) : ((a, b) => a === b); // eslint-disable-line eqeqeq

    function walk(nodeId) {
        if (!nodeId || visited.has(nodeId)) {
            return;
        }

        visited.add(nodeId);

        const matchingLinks = allFileLinks.filter(link => {
            if (!predicate(link)) {
                return false;
            }
            return direction === 'up'
                ? equals(link.NodeId, nodeId)
                : equals(link.ParentNodeId, nodeId);
        });

        matchingLinks.forEach(link => {
            linksToRender.add(link);
            walk(direction === 'up' ? link.ParentNodeId : link.NodeId);
        });
    }

    walk(startNodeId);
    return linksToRender;
}

function collectBidirectionalLinks(allFileLinks, startNodeId, predicate, options = {}) {
    const {
        linksToRender = new Set(),
        upVisited = new Set(),
        downVisited = new Set(),
        looseEqualityUp = false,
        looseEqualityDown = false
    } = options;

    collectDirectionalLinks(allFileLinks, startNodeId, predicate, {
        direction: 'up',
        visited: upVisited,
        linksToRender,
        looseEquality: looseEqualityUp
    });
    collectDirectionalLinks(allFileLinks, startNodeId, predicate, {
        direction: 'down',
        visited: downVisited,
        linksToRender,
        looseEquality: looseEqualityDown
    });

    return linksToRender;
}

function dedupeLinks(links, keyFactory) {
    const seen = new Set();
    const deduped = [];

    links.forEach(link => {
        const key = keyFactory(link);
        if (!seen.has(key)) {
            seen.add(key);
            deduped.push(link);
        }
    });

    return deduped;
}

function buildLinkEdgeMap(links, allFileNodes, ensureNodeDeclaration, {
    includeLabels = false,
    labelExtractor = null,
    includeDetailLabels = false,
    detailLabelExtractor = null,
    preserveLinkTypeCase = false
} = {}) {
    const nodeById = new Map();
    allFileNodes.forEach(node => {
        nodeById.set(node.NodeId, node);
    });

    const edges = new Map();

    links.forEach(link => {
        const sourceNode = nodeById.get(link.ParentNodeId);
        const destNode = nodeById.get(link.NodeId);

        if (!sourceNode || !destNode) {
            return;
        }

        ensureNodeDeclaration(sourceNode);
        ensureNodeDeclaration(destNode);

        const edgeKey = `${sourceNode.NodeId}->${destNode.NodeId}`;
        if (!edges.has(edgeKey)) {
            edges.set(edgeKey, {
                sourceNode,
                destNode,
                labels: new Set(),
                linkTypes: new Set(),
                detailLabels: new Set()
            });
        }

        const edge = edges.get(edgeKey);
        const linkTypeEntry = getFirstLinkTypeEntry(link.LinkType, { toLowerCase: !preserveLinkTypeCase });
        if (linkTypeEntry) {
            edge.linkTypes.add(linkTypeEntry);
        }

        if (includeLabels) {
            const labelValue = labelExtractor ? labelExtractor(link) : getFirstLinkTypeEntry(link.LinkType, { toLowerCase: false });
            if (labelValue) {
                edge.labels.add(labelValue);
            }
        }

        if (includeDetailLabels && detailLabelExtractor) {
            const detailLabel = detailLabelExtractor(link);
            if (detailLabel) {
                edge.detailLabels.add(detailLabel);
            }
        }
    });

    return edges;
}

function getCircularEdgeKeys(edges) {
    const circular = new Set();
    edges.forEach((_, key) => {
        const [sourceId, destId] = key.split('->');
        const reverseKey = `${destId}->${sourceId}`;
        if (edges.has(reverseKey)) {
            circular.add(key);
            circular.add(reverseKey);
        }
    });
    return circular;
}

function renderSortedEdges(edges, addEdge, {
    circularEdgeKeys = null,
    labelBuilder = null
} = {}) {
    const circular = circularEdgeKeys || getCircularEdgeKeys(edges);

    Array.from(edges.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .forEach(([key, edge]) => {
            const edgeTypes = Array.from(edge.linkTypes);
            if (circular.has(key)) {
                edgeTypes.push('circular');
            }

            const label = labelBuilder ? labelBuilder(edge) : Array.from(edge.labels || []).join(', ');
            addEdge(edge.sourceNode, edge.destNode, label, edgeTypes);
        });
}

function toEdgeMetadataKey(sourceNode, destNode) {
    const sourceNodeId = toMermaidNodeId(sourceNode.NodeId || sourceNode.FilePath || sourceNode.FileName);
    const destNodeId = toMermaidNodeId(destNode.NodeId || destNode.FilePath || destNode.FileName);
    return `${sourceNodeId}->${destNodeId}`;
}

function buildEdgeDetailsMap(edges) {
    const edgeDetails = {};

    Array.from(edges.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .forEach(([, edge]) => {
            const metadataKey = toEdgeMetadataKey(edge.sourceNode, edge.destNode);
            const details = Array.from(edge.detailLabels || [])
                .map(item => String(item || '').replace(/\r?\n/g, ' ').trim())
                .filter(Boolean)
                .sort((a, b) => a.localeCompare(b));

            if (details.length > 0) {
                edgeDetails[metadataKey] = details;
            }
        });

    return edgeDetails;
}

function buildEdgeIndexKeys(edges) {
    return Array.from(edges.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([, edge]) => toEdgeMetadataKey(edge.sourceNode, edge.destNode));
}

function buildEdgeMethodSignatures(links, allFileNodes) {
    const edgeMethodSigs = {};
    const nodeById = new Map();

    allFileNodes.forEach(node => {
        if (node && node.NodeId !== undefined && node.NodeId !== null) {
            nodeById.set(node.NodeId, node);
        }
    });

    Array.from(links || []).forEach((link) => {
        const signature = parseCallSignature(link && link.LinkType);
        if (!signature) {
            return;
        }

        const sourceNode = nodeById.get(link.ParentNodeId);
        const destNode = nodeById.get(link.NodeId);
        if (!sourceNode || !destNode) {
            return;
        }

        const metadataKey = toEdgeMetadataKey(sourceNode, destNode);

        if (!edgeMethodSigs[metadataKey]) {
            edgeMethodSigs[metadataKey] = [];
        }

        const exists = edgeMethodSigs[metadataKey].some(
            entry => entry && entry.name === signature.methodName && entry.params === signature.params
        );
        if (!exists) {
            edgeMethodSigs[metadataKey].push({ name: signature.methodName, params: signature.params });
        }
    });

    return edgeMethodSigs;
}

function buildGlobalMethodSignatures(links) {
    const globalMethodSigs = {};

    Array.from(links || []).forEach((link) => {
        const signature = parseCallSignature(link && link.LinkType);
        if (!signature) {
            return;
        }

        if (!globalMethodSigs[signature.methodName]) {
            globalMethodSigs[signature.methodName] = [];
        }

        if (!globalMethodSigs[signature.methodName].includes(signature.params)) {
            globalMethodSigs[signature.methodName].push(signature.params);
        }
    });

    return globalMethodSigs;
}

function prependEdgeDetailsMetadata(graph, edges, {
    includeEdgeIndexKeys = false,
    includeEdgeMethodSigs = false,
    includeGlobalMethodSigs = false,
    linkFilter = null,
    links = [],
    allFileNodes = []
} = {}) {
    const graphText = typeof graph === 'string' ? graph : String(graph || '');
    const metadataLines = [];

    const edgeDetails = buildEdgeDetailsMap(edges);
    const serializedEdgeDetails = JSON.stringify(edgeDetails);
    if (serializedEdgeDetails && serializedEdgeDetails !== '{}') {
        metadataLines.push(`%%CROSSWAY_EDGE_DETAILS:${serializedEdgeDetails}`);
    }

    if (includeEdgeIndexKeys) {
        const edgeIndexKeys = buildEdgeIndexKeys(edges);
        const serializedEdgeIndexKeys = JSON.stringify(edgeIndexKeys);
        if (serializedEdgeIndexKeys && serializedEdgeIndexKeys !== '[]') {
            metadataLines.push(`%%CROSSWAY_EDGE_INDEX_KEYS:${serializedEdgeIndexKeys}`);
        }
    }

    if (includeEdgeMethodSigs) {
        const filteredLinks = linkFilter
            ? Array.from(links || []).filter(link => linkFilter(link))
            : Array.from(links || []);

        const edgeMethodSigs = buildEdgeMethodSignatures(filteredLinks, allFileNodes);
        const serializedMethodSigs = JSON.stringify(edgeMethodSigs);
        if (serializedMethodSigs && serializedMethodSigs !== '{}') {
            metadataLines.push(`%%CROSSWAY_EDGE_METHOD_SIGS:${serializedMethodSigs}`);
        }

        if (includeGlobalMethodSigs) {
            const globalMethodSigs = buildGlobalMethodSignatures(filteredLinks);
            const serializedGlobalMethodSigs = JSON.stringify(globalMethodSigs);
            if (serializedGlobalMethodSigs && serializedGlobalMethodSigs !== '{}') {
                metadataLines.push(`%%CROSSWAY_GLOBAL_METHOD_SIGS:${serializedGlobalMethodSigs}`);
            }
        }
    }

    if (metadataLines.length > 0) {
        return `${metadataLines.join('\n')}\n${graphText}`;
    }

    return graphText;
}

function parseNamedRelationLabel(rawLinkType, supportedRelationTypes = []) {
    if (typeof rawLinkType !== 'string') {
        return '';
    }

    const normalized = rawLinkType.trim();
    if (!normalized) {
        return '';
    }

    const lower = normalized.toLowerCase();
    const relationType = supportedRelationTypes
        .map(type => String(type || '').trim().toLowerCase())
        .filter(Boolean)
        .find(type => lower === type || lower.startsWith(`${type}:`)) || '';
    if (!relationType) {
        return '';
    }

    const parts = normalized.split(':');
    if (parts.length <= 1) {
        return '';
    }

    const relationName = parts.slice(1).join(':').trim();
    if (!relationName) {
        return '';
    }

    return `${relationName.replace(/\s+/g, ' ')} (${relationType})`;
}

function normalizeRelationshipTypes(relationshipTypes = []) {
    return Array.from(new Set(
        relationshipTypes
            .map(type => String(type || '').trim().toLowerCase())
            .filter(Boolean)
    ));
}

function matchesRelationshipType(link, relationshipTypes) {
    if (!link || typeof link.LinkType !== 'string') {
        return false;
    }

    const normalizedLinkType = link.LinkType.trim().toLowerCase();
    return relationshipTypes.some(type =>
        normalizedLinkType === type || normalizedLinkType.startsWith(`${type}:`)
    );
}

function isReferencedNode(node, referencedNode) {
    if (!node || !referencedNode) {
        return false;
    }

    if (node.NodeId && referencedNode.NodeId && node.NodeId === referencedNode.NodeId) {
        return true;
    }

    if (node.FilePath && referencedNode.FilePath) {
        return path.normalize(node.FilePath).toLowerCase() === path.normalize(referencedNode.FilePath).toLowerCase();
    }

    return false;
}

function generateMermaidRelationshipChainGraph(dsMap, referencedNode, options = {}) {
    const {
        graphType = 'LR',
        diagramTypeName = '',
        relationshipTypes = [],
        includeDetailLabels = false,
        detailLabelExtractor = null
    } = options;

    const allFileLinks = getDsMapArray(dsMap, 'ttFileLink');
    const allFileNodes = getDsMapArray(dsMap, 'ttFileNode');
    const startNodeId = referencedNode.NodeId;

    if (allFileLinks.length === 0 || allFileNodes.length === 0) {
        vscode.window.showWarningMessage(`CrossWayAI: dsMap.json does not contain ${diagramTypeName} diagram data. Please regenerate the map.`);
        return null;
    }

    const normalizedRelationshipTypes = normalizeRelationshipTypes(relationshipTypes);

    const linksToRender = collectBidirectionalLinks(
        allFileLinks,
        startNodeId,
        link => matchesRelationshipType(link, normalizedRelationshipTypes)
    );

    if (linksToRender.size === 0) {
        vscode.window.showInformationMessage(`No ${diagramTypeName} references found for ${referencedNode.FileName}.`);
        return null;
    }

    const graphWriter = createMermaidGraphWriter(referencedNode, graphType);
    const { ensureNodeDeclaration, addEdge, getGraph } = graphWriter;
    const edges = buildLinkEdgeMap(Array.from(linksToRender), allFileNodes, ensureNodeDeclaration, {
        includeDetailLabels,
        detailLabelExtractor
    });

    renderSortedEdges(edges, addEdge);

    const graph = getGraph();
    return includeDetailLabels ? prependEdgeDetailsMetadata(graph, edges) : graph;
}

function prependSourceMetadata(graph, referencedNode) {
    const sourceNodeKey = referencedNode && (referencedNode.NodeId || referencedNode.FilePath || referencedNode.FileName);
    const sourceNodeId = toMermaidNodeId(sourceNodeKey || 'unknown');
    const sourceLine = `%%CROSSWAY_SOURCE_NODE:${sourceNodeId}`;
    const graphText = typeof graph === 'string' ? graph : String(graph || '');

    if (/^\s*%%CROSSWAY_SOURCE_NODE:/m.test(graphText)) {
        return graphText;
    }

    return `${sourceLine}\n${graphText}`;
}

function resolveDiagramContext(context, uri) {
    const CrossWayAILog = getCrossWayAILog();
    let filePath = '';

    if (uri && uri.fsPath) {
        filePath = uri.fsPath;
    } else {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage('No active editor or file context found.');
            return null;
        }
        filePath = editor.document.uri.fsPath;
    }

    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        return null;
    }

    const dsMapJson = getDsMapJsonObject(workspaceRoot);
    if (!dsMapJson) {
        return null;
    }

    const fileNodes = getDsMapArray(dsMapJson, 'ttFileNode');
    const fileLinks = getDsMapArray(dsMapJson, 'ttFileLink');

    if (fileNodes.length === 0 || fileLinks.length === 0) {
        vscode.window.showWarningMessage('CrossWayAI: dsMap.json is missing required relationship information. Regenerate the map first.');
        return null;
    }

    const normalizedFilePath = path.normalize(filePath);
    const referencedNode = fileNodes.find(node => node.FilePath && path.normalize(node.FilePath).toLowerCase() === normalizedFilePath.toLowerCase());
    if (!referencedNode) {
        vscode.window.showInformationMessage(`File ${path.basename(filePath)} not found in dsMap.json.`);
        return null;
    }

    return {
        workspaceRoot,
        dsMap: dsMapJson,
        referencedNode
    };
}

function getDiagramConfig(diagramType) {
    switch (diagramType) {
        case 'include':
            return {
                persistDiagramType: 'include',
                errorMessage: 'CrossWayAI: An error occurred during include diagram generation.'
            };
        case 'impact':
            return {
                persistDiagramType: 'impact',
                errorMessage: 'CrossWayAI: An error occurred during impact diagram generation.'
            };
        case 'interface':
            return {
                persistDiagramType: 'interface',
                errorMessage: 'CrossWayAI: An error occurred during interface diagram generation.'
            };
        case 'call':
            return {
                persistDiagramType: 'call',
                errorMessage: 'CrossWayAI: An error occurred during call diagram generation.'
            };
        case 'inheritance':
            return {
                persistDiagramType: 'inheritance',
                errorMessage: 'CrossWayAI: An error occurred during inheritance diagram generation.'
            };
        case 'package':
            return {
                persistDiagramType: 'package',
                errorMessage: 'CrossWayAI: An error occurred during package diagram generation.'
            };
        case 'instance_chain':
            return {
                persistDiagramType: 'instance_chain',
                errorMessage: 'CrossWayAI: An error occurred during instance chain diagram generation.'
            };
        case 'property_access':
            return {
                persistDiagramType: 'property_access',
                errorMessage: 'CrossWayAI: An error occurred during property access diagram generation.'
            };
        default:
            throw new Error(`Unsupported diagram type: ${diagramType}`);
    }
}

async function generateDiagram(context, uri, diagramType, graphBuilder) {

    const { createMermaidViewer } = require('./crosswayaiContainer');
    const { openCrosswayAIViewer, persistMermaid } = createMermaidViewer();
    const CrossWayAILog = getCrossWayAILog();
    
    let config;
    
    try {
        config = getDiagramConfig(diagramType);
    } catch (error) {
        CrossWayAILog.appendLine(`**Error: ${error.message}`);
        CrossWayAILog.show(true);
        vscode.window.showErrorMessage(error.message);
        return;
    }

    try {
        const resolvedContext = resolveDiagramContext(context, uri);
        if (!resolvedContext) {
            return;
        }

        const { dsMap, referencedNode, workspaceRoot } = resolvedContext;

        const exclusions = getExclusionsSettings(workspaceRoot);
        const isExcluded = createExclusionMatcher(exclusions, workspaceRoot);
        const nodes = (dsMap.dsMap || {}).ttFileNode || [];
        const excludedNodeIds = new Set();
        for (const node of nodes) {
            if (node.FilePath && isExcluded(node.FilePath)) {
                excludedNodeIds.add(node.NodeId);
            }
        }
        if (excludedNodeIds.size > 0) {
            dsMap.dsMap.ttFileNode = nodes.filter(n => !excludedNodeIds.has(n.NodeId));
            const links = (dsMap.dsMap || {}).ttFileLink || [];
            dsMap.dsMap.ttFileLink = links.filter(l => !excludedNodeIds.has(l.NodeId) && !excludedNodeIds.has(l.ParentNodeId));
        }

        const mermaidGraph = diagramType === 'package'
            ? graphBuilder(dsMap, referencedNode, workspaceRoot)
            : graphBuilder(dsMap, referencedNode);

        if (!mermaidGraph) {
            return;
        }

        const nodeDetails = buildNodeDatabaseDetails(dsMap);
        const graphWithNodeDetails = Object.keys(nodeDetails).length > 0
            ? `%%CROSSWAY_NODE_DETAILS:${JSON.stringify(nodeDetails)}\n${mermaidGraph}`
            : mermaidGraph;
        const graphWithMetadata = prependSourceMetadata(graphWithNodeDetails, referencedNode);
        const savedPath = persistMermaid(workspaceRoot, config.persistDiagramType, referencedNode.FileName, graphWithMetadata);
        if (savedPath) {
            await openCrosswayAIViewer(context, vscode.Uri.file(savedPath));
            vscode.window.showInformationMessage(`Mermaid diagram saved: ${savedPath}`);
        }
    } catch (error) {
        CrossWayAILog.appendLine(`**Error generating ${diagramType} diagram: ${error.message}`);
        CrossWayAILog.show(true);
        vscode.window.showErrorMessage(config.errorMessage);
    }
}

function getNodePrefix(node) {
    return node.FileDesc ? node.FileDesc.trim() : '';
}

function getRelativeFolderPath(relPath, projectName, sourceDir) {
    if (!relPath) {
        return '';
    }
    const displaySeparator = '\\';
    let stripped = String(relPath).replace(/[\\/]+/g, '/');
    if (projectName) {
        const projectPrefix = String(projectName).replace(/[\\/]+/g, '/') + '/';
        if (stripped.toLowerCase().startsWith(projectPrefix.toLowerCase())) {
            stripped = stripped.slice(projectPrefix.length);
        }
    }
    if (sourceDir) {
        const sourcePrefix = String(sourceDir).replace(/[\\/]+/g, '/') + '/';
        if (stripped.toLowerCase().startsWith(sourcePrefix.toLowerCase())) {
            stripped = stripped.slice(sourcePrefix.length);
        }
    }
    const lastSep = stripped.lastIndexOf('/');
    return lastSep !== -1 ? stripped.substring(0, lastSep).replace(/\//g, displaySeparator) : '';
}

function createMermaidGraphWriter(referencedNode, graphType = 'LR') {
    
    let edgeCounter = 0;

    const NODE_BORDER_COLORS = diagramColors.nodeBorderColors;
    const LINK_COLORS = diagramColors.linkColors;

    let mermaidGraph = `graph ${graphType};\n`;

    const declaredNodes = new Set();
    const fileMap = {};
    const virtualNodes = new Set();

    function getMermaidNodeId(node) {
        if (!node) {
            return toMermaidNodeId('unknown');
        }

        return toMermaidNodeId(node.NodeId || node.FilePath || node.FileName || 'unknown');
    }


    function resolveNodeType(node) {

        if (!node || !node.FileName) {
            return "class";
        }

        // Check if node is virtual first
        if (node.Virtual === true) {
            return "virtual";
        }

        const prefix = getNodePrefix(node);

        const ext = node.FileName.includes('.')
            ? node.FileName.split('.').pop().toLowerCase()
            : "";

        if (prefix.startsWith('CLASS') || ext === 'cls') {
            return "class";
        }

        if (prefix.startsWith('INCLUDE') || ext === 'i') {
            return "include";
        }

        if (prefix.startsWith('PROCEDURE') || ext === 'p') {
            return "procedure";
        }

        if (prefix.startsWith('SCREEN') || ext === 'w') {
            return "screen";
        }

        return "class";
    }

    function writeNode(nodeId, label, nodeType) {

        const borderColor = NODE_BORDER_COLORS[nodeType] || "#333";

        mermaidGraph += `    ${nodeId}["${label}"]\n`;

        mermaidGraph +=
            `    style ${nodeId} fill:#ffffff,stroke:${borderColor},stroke-width:2px,rx:5px,ry:5px\n`;
    }

    function ensureNodeDeclaration(node) {

        if (!node || !node.FileName) {
            return null;
        }

        const nodeId = getMermaidNodeId(node);

        if (!declaredNodes.has(nodeId)) {

            const projectName = node.project || node.Project || '';
            const sourceDir = node.source || node.Source || '';
            const augumentedNode = {
                ...node,
                isRefNode: isReferencedNode(node, referencedNode),
                LabelPrefix: getNodePrefix(node),
                ProjectName: projectName,
                SourceDirectory: sourceDir,
                RelativeFolderPath: getRelativeFolderPath(node.FileRelPath || '', projectName, sourceDir)
            };
            const label = buildNodeLabel(augumentedNode);
            const nodeType = resolveNodeType(node);

            writeNode(nodeId, label, nodeType);

            declaredNodes.add(nodeId);

            if (node.FilePath) {
                fileMap[nodeId] = node.FilePath;
            }

            if (node.Virtual === true) {
                virtualNodes.add(nodeId);
            }
        }

        return nodeId;
    }

    function normalizeLinkType(linkType) {
        if (!linkType) {
            return "";
        }

        return String(linkType)
            .split(":")[0]
            .trim()
            .toLowerCase();
    }

    function resolveEdgeColor(linkTypeInput) {
        if (!linkTypeInput) {
            return LINK_COLORS.undefined;
        }

        const values = Array.isArray(linkTypeInput)
            ? linkTypeInput
            : (linkTypeInput instanceof Set ? Array.from(linkTypeInput) : [linkTypeInput]);

        const normalizedTypes = Array.from(new Set(
            values
                .map(normalizeLinkType)
                .filter(Boolean)
        ));

        if (normalizedTypes.length === 0) {
            return LINK_COLORS.undefined;
        }

        // run and invoke are intentionally rendered with the same color.
        // property, public-property and inherited-property are also collapsed into the same color to reduce noise.
        const collapsedTypes = Array.from(new Set(
            normalizedTypes.map((type) => {
                if (type === "run" || type === "invoke") {
                    return "call";
                }

                if (type === "property" || type === "public-property" || type === "inherited-property") {
                    return "property";
                }

                return type;
            })
        ));

        if (collapsedTypes.includes("circular")) {
            return LINK_COLORS.circular;
        }

        if (collapsedTypes.length === 1) {
            const singleType = collapsedTypes[0];
            if (singleType === "extends") {
                return LINK_COLORS.inherits;
            }
            return LINK_COLORS[singleType] || LINK_COLORS.undefined;
        }

        // Mixed relationship types on the same edge -> undefined/multiple color.
        return LINK_COLORS.undefined;
    }

    function lightenColor(hex, percent) {

        const num = parseInt(hex.replace("#",""),16);

        let r = (num >> 16);
        let g = (num >> 8) & 255;
        let b = num & 255;

        r = Math.min(255, Math.floor(r + (255 - r) * percent));
        g = Math.min(255, Math.floor(g + (255 - g) * percent));
        b = Math.min(255, Math.floor(b + (255 - b) * percent));

        return "#" + (r << 16 | g << 8 | b).toString(16).padStart(6,"0");
    }

    const startNodeName = ensureNodeDeclaration(referencedNode);
    const startNodeType = resolveNodeType(referencedNode);
    const startBorder = NODE_BORDER_COLORS[startNodeType] || "#333";

    mermaidGraph +=
    `    style ${startNodeName} fill:#1f6feb,stroke:${startBorder},stroke-width:4px,color:#ffffff,rx:5px,ry:5px\n`;    

    function addEdge(sourceNode, destNode, label, edgeLinkType = null) {

        if (!sourceNode || !destNode) {
            return;
        }

        if (!sourceNode.FileName || !destNode.FileName) {
            return;
        }

        const sourceId = getMermaidNodeId(sourceNode);
        const destId = getMermaidNodeId(destNode);

        const color = resolveEdgeColor(edgeLinkType || relationType || label);

        let safeLabel = label ? String(label).replace(/"/g, "").trim() : "";

        if (safeLabel) {
            mermaidGraph += `    ${sourceId} -->|${safeLabel}| ${destId};\n`;
        } else {
            mermaidGraph += `    ${sourceId} --> ${destId};\n`;
        }
        
        mermaidGraph += `    linkStyle ${edgeCounter} stroke:${color},stroke-width:2px\n`;
        
        edgeCounter++;
    }

    function getGraph() {
        const serializedFileMap = JSON.stringify(fileMap);
        const serializedVirtualNodes = JSON.stringify(Array.from(virtualNodes));
        if (serializedFileMap && serializedFileMap !== '{}') {
            return `%%CROSSWAY_FILE_MAP:${serializedFileMap}\n%%CROSSWAY_VIRTUAL_NODES:${serializedVirtualNodes}\n${mermaidGraph}`;
        }
        return mermaidGraph;
    }

    function getFileMap() {
        return fileMap;
    }

    return {
        ensureNodeDeclaration,
        addEdge,
        getGraph,
        getFileMap
    };
}
module.exports = {
    resolveDiagramContext,
    createMermaidGraphWriter,
    generateDiagram,
    runABLScript,
    toMermaidNodeId,
    normalizeFsPath,
    getDsMapPath,
    getDsMapJsonObject,
    getDsMapArray,
    getRelativeFolderPath,
    findDsMapFileEntry,
    resolveXrefFilePath,
    resolveProparseFilePath,
    buildNodeDatabaseDetails,
    getFirstLinkTypeEntry,
    parseCallSignature,
    getCallLabel,
    collectDirectionalLinks,
    collectBidirectionalLinks,
    dedupeLinks,
    buildLinkEdgeMap,
    getCircularEdgeKeys,
    renderSortedEdges,
    buildEdgeDetailsMap,
    prependEdgeDetailsMetadata,
    parseNamedRelationLabel,
    generateMermaidRelationshipChainGraph,
    cleanupDirectory,
    getNodePrefix
};
