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
    const { vscode, CrossWayAILog, openMermaidViewer, persistMermaid, getDsMapArray } = deps;
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
            await openMermaidViewer(context, vscode.Uri.file(savedPath));
            vscode.window.showInformationMessage(`Mermaid diagram saved: ${savedPath}`);
        }
    } catch (error) {
        CrossWayAILog.appendLine(`**Error generating ${diagramType} diagram: ${error.message}`);
        CrossWayAILog.show(true);
        vscode.window.showErrorMessage(config.errorMessage);
    }
}

function createMermaidGraphWriter(targetNode, graphType = 'LR') {
    let mermaidGraph = `graph ${graphType};\n`;
    const declaredNodes = new Set();

    function getMermaidNodeId(fileName) {
        return String(fileName || 'unknown').replace(/[^a-zA-Z0-9_]/g, '_');
    }

    function getMermaidNodeLabel(fileName) {
        return String(fileName || 'unknown').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    function ensureNodeDeclaration(node) {
        if (!node || !node.FileName) {
            return null;
        }

        const nodeId = getMermaidNodeId(node.FileName);
        if (!declaredNodes.has(nodeId)) {
            const nodeLabel = getMermaidNodeLabel(node.FileName);
            mermaidGraph += `    ${nodeId}["${nodeLabel}"]\n`;
            declaredNodes.add(nodeId);
        }

        return nodeId;
    }

    const startNodeName = ensureNodeDeclaration(targetNode);
    mermaidGraph += `    style ${startNodeName} fill:#f9f,stroke:#333,stroke-width:4px\n`;

    function addEdge(sourceName, destName, label) {
        if (!sourceName || !destName) {
            return;
        }

        if (label) {
            mermaidGraph += `    ${sourceName} -- ${label} --> ${destName};\n`;
        } else {
            mermaidGraph += `    ${sourceName} --> ${destName};\n`;
        }
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