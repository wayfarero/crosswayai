const path = require('path');

/**
 * Resolves the workspace root directory from the available workspace folders.
 * If there is only one folder, uses its path directly.
 * If the first folder is a parent of other folders, uses path.dirname of a subfolder.
 * Otherwise, uses path.dirname of the first folder.
 */
function resolveWorkspaceRoot(workspaceFolders) {
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return '';
    }

    const firstFolderPath = workspaceFolders[0].uri.fsPath;

    if (workspaceFolders.length === 1) {
        return firstFolderPath;
    }

    const otherFolders = workspaceFolders.slice(1);
    const isFirstFolderParent = otherFolders.some(folder => {
        const relative = path.relative(firstFolderPath, folder.uri.fsPath);
        return relative && !relative.startsWith('..');
    });

    if (isFirstFolderParent) {
        return path.dirname(otherFolders[0].uri.fsPath);
    }

    return path.dirname(firstFolderPath);
}

/**
 * Runs an ABL script using the provided parameters.
 * @param {Object} options - Options for running the ABL script.
 * @param {Object} options.context - VS Code extension context.
 * @param {string} options.workspaceRoot - The workspace root directory.
 * @param {Object} options.deps - Dependency injection object (vscode, fs, path, CrossWayAILog).
 * @param {string} [options.scriptName] - The relative path to the ABL script to run (default: 'core/runAnalysis.p').
 * @param {string} [options.propath] - The PROPATH to use (default: extension's crosswayai.pl).
 * @param {string[]} [options.args] - Additional arguments for the ABL process.
 * @returns {Promise<void>} Resolves when the process finishes successfully, rejects on error.
 */
async function runABLScript({ context, workspaceRoot, deps, scriptName, args: extraArgs = []}) {
    const { vscode, fs, path, CrossWayAILog } = deps;
    const dlcEnv = process.env.DLC || process.env.dlc;
    if (!dlcEnv) {
        vscode.window.showErrorMessage('Environment variable DLC is not set. Please set %DLC% to your OpenEdge installation path and restart VS Code.');
        return;
    }
    const crosswayaiDir = path.join(workspaceRoot, '.crosswayai');
    const logFile = path.join(crosswayaiDir, 'crosswayai.log');
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });
    const extensionAblPath = path.join(context.extensionPath, 'crosswayai.pl');
    const prodictPath = path.join(dlcEnv, 'tty','prodict.pl');
    const adecommPath = path.join(dlcEnv, 'tty','adecomm.pl');
    const runScriptPath = scriptName;
    const effectivePropath = `${extensionAblPath},${context.extensionPath},${prodictPath},${adecommPath}`;
    const executable = path.join(dlcEnv, 'bin', '_progres');
    const args = [
        '-b',
        '-p',
        runScriptPath,
        '-baseADE',
        effectivePropath
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

            const label = labelBuilder ? labelBuilder(edge) : '';
            addEdge(edge.sourceNode, edge.destNode, label, edgeTypes);
        });
}

function prependSourceMetadata(graph, targetNode) {
    const sourceNodeKey = targetNode && (targetNode.NodeId || targetNode.FilePath || targetNode.FileName);
    const sourceNodeId = toMermaidNodeId(sourceNodeKey || 'unknown');
    const sourceLine = `%%CROSSWAY_SOURCE_NODE:${sourceNodeId}`;
    const graphText = typeof graph === 'string' ? graph : String(graph || '');

    if (/^\s*%%CROSSWAY_SOURCE_NODE:/m.test(graphText)) {
        return graphText;
    }

    return `${sourceLine}\n${graphText}`;
}

function resolveDiagramContext(context, uri, deps, missingRelationshipMessage) {
    const { vscode, fs, path, getDsMapArray } = deps;
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

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('CrossWayAI: No workspace folder found.');
        return null;
    }

    const workspaceRoot = resolveWorkspaceRoot(workspaceFolders);
    const dsMapPath = path.join(workspaceRoot, '.crosswayai', 'dsMap.json');

    if (!fs.existsSync(dsMapPath)) {
        vscode.window.showErrorMessage('CrossWayAI: dsMap.json not found. Please generate the map first.');
        return null;
    }

    const dsMapContent = fs.readFileSync(dsMapPath, 'utf8');
    const dsMap = JSON.parse(dsMapContent);

    const fileNodes = getDsMapArray(dsMap, 'ttFileNode');
    const fileLinks = getDsMapArray(dsMap, 'ttFileLink');

    if (fileNodes.length === 0 || fileLinks.length === 0) {
        vscode.window.showWarningMessage('CrossWayAI: dsMap.json is missing required relationship information. Regenerate the map first.');
        return null;
    }

    const normalizedFilePath = path.normalize(filePath);
    const targetNode = fileNodes.find(node => node.FilePath && path.normalize(node.FilePath).toLowerCase() === normalizedFilePath.toLowerCase());
    if (!targetNode) {
        vscode.window.showInformationMessage(`File ${path.basename(filePath)} not found in dsMap.json.`);
        return null;
    }

    return {
        workspaceRoot,
        dsMap,
        targetNode
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
        default:
            throw new Error(`Unsupported diagram type: ${diagramType}`);
    }
}

async function generateDiagram(context, uri, deps, diagramType, graphBuilder) {
    const { vscode, CrossWayAILog, openCrosswayAIViewer, persistMermaid, getDsMapArray, path } = deps;
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
        const resolvedContext = resolveDiagramContext(context, uri, deps);
        if (!resolvedContext) {
            return;
        }

        const { dsMap, targetNode, workspaceRoot } = resolvedContext;
        const mermaidGraph = graphBuilder(dsMap, targetNode, { vscode, getDsMapArray, workspaceRoot, path });

        if (!mermaidGraph) {
            return;
        }

        const graphWithMetadata = prependSourceMetadata(mermaidGraph, targetNode);
        const savedPath = persistMermaid(workspaceRoot, config.persistDiagramType, targetNode.FileName, graphWithMetadata);
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

function createMermaidGraphWriter(targetNode, graphType = 'LR') {
    
    let edgeCounter = 0;
    const MAX_EDGE_LABEL_LENGTH = 120;

    const NODE_BORDER_COLORS = {
        class: "#0da33f",       // new / class
        include: "#ed1e97",     // include
        procedure: "#1d6be0",   // run / invoke
        screen: "#e0781c"       // screen
    };

    const LINK_COLORS = {
        include: "#ed1e97",
        run: "#1d6be0",
        invoke: "#1d6be0",
        inherits: "#18e2ce",
        implements: "#1fcce2",
        circular: "#ff0000"
    };

    let mermaidGraph = `graph ${graphType};\n`;

    const declaredNodes = new Set();
    const fileMap = {};

    function getMermaidNodeId(node) {
        if (!node) {
            return toMermaidNodeId('unknown');
        }

        return toMermaidNodeId(node.NodeId || node.FilePath || node.FileName || 'unknown');
    }

    function getNodePrefix(node) {
        return node.FileDesc ? node.FileDesc.trim() : '';
    }

    function buildNodeLabel(node) {
        const prefix = getNodePrefix(node);
        const firstLine = prefix ? `${prefix}${node.FileName}` : node.FileName;
        const relPath = node.FileRelPath || '';
        const projectName = node.project || node.Project || '';
        const sourceName = node.source || node.Source || '';

        const isStartNode = Boolean(
            targetNode &&
            ((node.NodeId && targetNode.NodeId && node.NodeId === targetNode.NodeId) ||
                (node.FilePath && targetNode.FilePath &&
                    path.normalize(node.FilePath).toLowerCase() === path.normalize(targetNode.FilePath).toLowerCase()))
        );

        // Derive the folder path relative to project\source\ by stripping both prefixes
        // from FileRelPath, then dropping the trailing filename segment.
        // Result format: [project subpath]\(source directory)\relative folder path
        let relFolder = '';
        if (relPath) {
            let stripped = relPath;
            if (projectName) {
                const projectPrefix = projectName + '\\';
                if (stripped.toLowerCase().startsWith(projectPrefix.toLowerCase())) {
                    stripped = stripped.slice(projectPrefix.length);
                }
            }
            if (sourceName) {
                const sourcePrefix = sourceName + '\\';
                if (stripped.toLowerCase().startsWith(sourcePrefix.toLowerCase())) {
                    stripped = stripped.slice(sourcePrefix.length);
                }
            }
            const lastSep = stripped.lastIndexOf('\\');
            relFolder = lastSep !== -1 ? stripped.substring(0, lastSep) : '';
        }

        const escapedFirst = firstLine.replace(/"/g, '\\"');
        const escapedProject = projectName
            ? `<span style='color:#f59e0b'>[${projectName}]</span>`.replace(/"/g, '\\"')
            : '';
        const escapedSource = sourceName
            ? (`<span style='color:${isStartNode ? '#f9a8d4' : '#ec4899'}'>(${sourceName})</span>`).replace(/"/g, '\\"')
            : '';
        const escapedRelFolder = relFolder.replace(/"/g, '\\"');

        const parts = [escapedProject, escapedSource, escapedRelFolder].filter(Boolean);
        if (parts.length > 0) {
            return `${escapedFirst}\\n${parts.join('\\')}`;
        }

        return escapedFirst;
    }

    function resolveNodeType(node) {

        if (!node || !node.FileName) {
            return "class";
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

            const label = buildNodeLabel(node);
            const nodeType = resolveNodeType(node);

            writeNode(nodeId, label, nodeType);

            declaredNodes.add(nodeId);

            if (node.FilePath) {
                fileMap[nodeId] = node.FilePath;
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
            return "#555";
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
            return "#555";
        }

        // run and invoke are intentionally rendered with the same color.
        const collapsedTypes = Array.from(new Set(
            normalizedTypes.map((type) => (type === "invoke" ? "run" : type))
        ));

        if (collapsedTypes.includes("circular")) {
            return LINK_COLORS.circular;
        }

        if (collapsedTypes.length === 1) {
            const singleType = collapsedTypes[0];
            if (singleType === "extends") {
                return LINK_COLORS.inherits;
            }
            return LINK_COLORS[singleType] || "#555";
        }

        // Mixed relationship types on the same edge -> undefined/multiple color.
        return "#555";
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

    const startNodeName = ensureNodeDeclaration(targetNode);
    const startNodeType = resolveNodeType(targetNode);
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
        if (safeLabel.length > MAX_EDGE_LABEL_LENGTH) {
            safeLabel = `${safeLabel.slice(0, MAX_EDGE_LABEL_LENGTH - 1)}...`;
        }

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
        if (serializedFileMap && serializedFileMap !== '{}') {
            return `%%CROSSWAY_FILE_MAP:${serializedFileMap}\n${mermaidGraph}`;
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
    resolveWorkspaceRoot,
    resolveDiagramContext,
    createMermaidGraphWriter,
    generateDiagram,
    runABLScript,
    toMermaidNodeId,
    getDsMapArray,
    getFirstLinkTypeEntry,
    collectDirectionalLinks,
    collectBidirectionalLinks,
    dedupeLinks,
    buildLinkEdgeMap,
    getCircularEdgeKeys,
    renderSortedEdges
};
