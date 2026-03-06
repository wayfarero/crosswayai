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

    const workspaceRoot = workspaceFolders[0].uri.fsPath;
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

    const targetNode = fileNodes.find(node => node.FilePath && node.FilePath.toLowerCase() === filePath.toLowerCase());
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
        default:
            throw new Error(`Unsupported diagram type: ${diagramType}`);
    }
}

async function generateDiagram(context, uri, deps, diagramType, graphBuilder) {
    const { vscode, CrossWayAILog, openCrosswayAIViewer, persistMermaid, getDsMapArray } = deps;
    const config = getDiagramConfig(diagramType);

    try {
        const resolvedContext = resolveDiagramContext(context, uri, deps);
        if (!resolvedContext) {
            return;
        }

        const { dsMap, targetNode, workspaceRoot } = resolvedContext;
        const mermaidGraph = graphBuilder(dsMap, targetNode, { vscode, getDsMapArray });

        if (!mermaidGraph) {
            return;
        }

        const savedPath = persistMermaid(workspaceRoot, config.persistDiagramType, targetNode.FileName, mermaidGraph);
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

    const NODE_BORDER_COLORS = {
        class: "#006400",
        include: "#b00060",
        procedure: "#0033cc",
        screen: "#b59b00"
    };

    let mermaidGraph = `graph ${graphType};\n`;

    const declaredNodes = new Set();

    function getMermaidNodeId(fileName) {
        return String(fileName || 'unknown').replace(/[^a-zA-Z0-9_]/g, '_');
    }

    function getNodePrefix(node) {
        return node.FileDesc ? node.FileDesc.trim() : '';
    }

    function buildNodeLabel(node) {
        const prefix = getNodePrefix(node);
        const firstLine = prefix ? `${prefix}${node.FileName}` : node.FileName;
        const relPath = node.FileRelPath || '';

        let displayPath = '';

        if (relPath) {
            const lastSep = relPath.lastIndexOf('\\');
            const folderPath = lastSep !== -1 ? relPath.substring(0, lastSep) : relPath;

            if (folderPath) {
                displayPath = `(${folderPath})`;
            }
        }

        const escapedFirst = firstLine.replace(/"/g, '\\"');
        const escapedRel = displayPath.replace(/"/g, '\\"');

        if (escapedRel) {
            return `${escapedFirst}\\n${escapedRel}`;
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

        const nodeId = getMermaidNodeId(node.FileName);

        if (!declaredNodes.has(nodeId)) {

            const label = buildNodeLabel(node);
            const nodeType = resolveNodeType(node);

            writeNode(nodeId, label, nodeType);

            declaredNodes.add(nodeId);
        }

        return nodeId;
    }

    function resolveEdgeColor(sourceType) {

        return NODE_BORDER_COLORS[sourceType] || "#333";
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

    function addEdge(sourceNode, destNode, label) {

        if (!sourceNode || !destNode) {
            return;
        }

        if (!sourceNode.FileName || !destNode.FileName) {
            return;
        }

        const sourceId = getMermaidNodeId(sourceNode.FileName);
        const destId = getMermaidNodeId(destNode.FileName);

        const sourceType = resolveNodeType(sourceNode);
        const targetType = resolveNodeType(destNode);

        const color = resolveEdgeColor(targetType);

        const safeLabel = label ? String(label).replace(/"/g, "").trim() : "";

        if (safeLabel) {
            mermaidGraph += `    ${sourceId} -->|${safeLabel}| ${destId};\n`;
        } else {
            mermaidGraph += `    ${sourceId} --> ${destId};\n`;
        }
        
        mermaidGraph += `    linkStyle ${edgeCounter} stroke:${color},stroke-width:2px\n`;
        
        edgeCounter++;
    }

    function getGraph() {
        return mermaidGraph;
    }

    return {
        ensureNodeDeclaration,
        addEdge,
        getGraph
    };
}
module.exports = {
    resolveDiagramContext,
    createMermaidGraphWriter,
    generateDiagram,
    runABLScript
};