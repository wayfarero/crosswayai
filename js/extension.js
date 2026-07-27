const vscode = require('vscode');
const path = require('path');
const { generateDependencyMap } = require('./dependencyMap');
const { setupXrefWatcher } = require('./xrefWatcher');
const { generateIncludeDiagram } = require('./includeDiagram');
const { generateImpactDiagram } = require('./impactDiagram');
const { generateInterfaceDiagram } = require('./interfaceDiagram');
const { generateCallDiagram } = require('./callDiagram');
const { generateInheritanceDiagram } = require('./inheritanceDiagram');
const { generatePackageDiagram } = require('./packageDiagram');
const { generateInstanceChainDiagram } = require('./instanceChainDiagram');
const { generatePropertyAccessDiagram } = require('./propertyAccessDiagram');
const { generateTableRelationsDiagram } = require('./tableRelationsDiagram');
const { createMermaidViewer, cleanupLegacyMermaidDiagrams } = require('./crosswayaiContainer');
const { removeMermaidDiagramsForSourceFile } = require('./mermaidCleanup');
const { dumpDfFile, dumpAllDBDefinitions } = require('./dumpDfFile');
const { getWorkspaceRoot } = require('./workspaceProjects');
const { openXrefFile, openProparseFile } = require('./fileHandling');
const { proparseAllProjects } = require('./proparseRunner');
const { ensureProparserCompiled } = require('./proparseContext');
const { setCrossWayAILog } = require('./crosswayaiLogger');
const { setRefreshActiveMermaidDiagramHandler } = require('./mermaidRefreshState');
const { ensureSettingsFile } = require('./crosswayaiSettings');

//Create output channel
let CrossWayAILog = vscode.window.createOutputChannel("CrossWayAILog");
setCrossWayAILog(CrossWayAILog);
const { openCrosswayAIViewer, deactivateMermaidViewer, persistMermaid, isMermaidViewerVisible, closeMermaidViewerForFile } = createMermaidViewer();

let activeGeneratedDiagram = null;

function ensureWorkspaceSettingsFile(workspaceRoot = getWorkspaceRoot()) {
    try {
        if (!workspaceRoot) {
            return;
        }

        const settingsPath = path.join(workspaceRoot, '.crosswayai', 'crosswayai_settings.json');
        const result = ensureSettingsFile(settingsPath);

        if (result.created) {
            CrossWayAILog.appendLine(`Created default settings file at ${settingsPath}`);
            return;
        }

        if (result.patched) {
            CrossWayAILog.appendLine(`Patched workspace settings at ${settingsPath}: added ${result.addedPaths.join(', ')}`);
        }
    } catch (error) {
        CrossWayAILog.appendLine(`Warning: Failed to ensure workspace settings file: ${error.message}`);
    }
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    CrossWayAILog.appendLine("CrossWayAI extension is now active!");

    // Resolve the workspace root once so a no-workspace activation surfaces the
    // "No workspace folder found" error at most once across the operations below.
    const workspaceRoot = getWorkspaceRoot();

    // Ensure default workspace settings are present.
    ensureWorkspaceSettingsFile(workspaceRoot);

    // Remove old version flat .md diagrams left over from before the folder-structured layout.
    cleanupLegacyMermaidDiagrams(workspaceRoot);

    const proparserCompilePromise = ensureProparserCompiled(context).catch(error => {
        CrossWayAILog.appendLine(`>Proparse: Unexpected Proparser compile check error: ${error.message}`);
        CrossWayAILog.show(true);
        return false;
    });

    async function refreshActiveMermaidDiagram() {
        if (!activeGeneratedDiagram) {
            return;
        }

        if (!isMermaidViewerVisible()) {
            return;
        }

        try {
            CrossWayAILog.appendLine('Regenerating active Mermaid diagram after xref update.');
            await activeGeneratedDiagram.handler(context, activeGeneratedDiagram.uri);
        } catch (error) {
            CrossWayAILog.appendLine(`Failed to regenerate active Mermaid diagram after xref update: ${error.message}`);
        }
    }

    setRefreshActiveMermaidDiagramHandler(refreshActiveMermaidDiagram);

    const handleDependencyMap = (ctx) => generateDependencyMap(ctx);
    const handleImpactDiagram = (ctx, uri) => generateImpactDiagram(ctx, uri);
    const handleIncludeDiagram = (ctx, uri) => generateIncludeDiagram(ctx, uri);
    const handleInterfaceDiagram = (ctx, uri) => generateInterfaceDiagram(ctx, uri);
    const handleCallDiagram = (ctx, uri) => generateCallDiagram(ctx, uri);
    const handleInheritanceDiagram = (ctx, uri) => generateInheritanceDiagram(ctx, uri);
    const handlePackageDiagram = (ctx, uri) => generatePackageDiagram(ctx, uri);
    const handleInstanceChainDiagram = (ctx, uri) => generateInstanceChainDiagram(ctx, uri);
    const handlePropertyAccessDiagram = (ctx, uri) => generatePropertyAccessDiagram(ctx, uri);
    const handleTableRelationsDiagram = (ctx, uri) => generateTableRelationsDiagram(ctx, uri);
    const handleDumpDfFile = (ctx, dbName, workspaceRoot, pfFilePath) => dumpDfFile(ctx, dbName, workspaceRoot, undefined, pfFilePath);
    const handleDumpAllDBDefinitions = (ctx) => dumpAllDBDefinitions(ctx);
    const handleProparseAllProjects = async (ctx) => {
        const proparserReady = await proparserCompilePromise;
        if (!proparserReady) {
            vscode.window.showErrorMessage('CrossWayAI: Proparser is not compiled. See CrossWayAILog for details.');
            return;
        }
        await proparseAllProjects(ctx);
    };
    const handleOpenXrefFile = (ctx, uri) => openXrefFile(uri);
    const handleOpenProparseFile = (ctx, uri) => openProparseFile(uri);

    const handleFileDelete = (uri) => {
        if (!uri || !uri.fsPath) {
            return;
        }

        const deletedFilePath = uri.fsPath;
        const workspaceRoot = getWorkspaceRoot();
        const removedDiagramPaths = removeMermaidDiagramsForSourceFile(workspaceRoot, deletedFilePath);

        if (removedDiagramPaths.length > 0) {
            closeMermaidViewerForFile(workspaceRoot, removedDiagramPaths);
            CrossWayAILog.appendLine(`Removed ${removedDiagramPaths.length} Mermaid diagram file(s) for deleted source: ${deletedFilePath}`);
            CrossWayAILog.show(true);
        }
    };

    const commands = [
        { name: 'crosswayai.generateMap', handler: handleDependencyMap },
        { name: 'crosswayai.generateImpactDiagram', handler: handleImpactDiagram, trackDiagram: true },
        { name: 'crosswayai.generateIncludeDiagram', handler: handleIncludeDiagram, trackDiagram: true },
        { name: 'crosswayai.generateInterfaceDiagram', handler: handleInterfaceDiagram, trackDiagram: true },
        { name: 'crosswayai.generateCallDiagram', handler: handleCallDiagram, trackDiagram: true },
        { name: 'crosswayai.generateInheritanceDiagram', handler: handleInheritanceDiagram, trackDiagram: true },
        { name: 'crosswayai.openCrosswayAIViewer', handler: openCrosswayAIViewer },
        { name: 'crosswayai.dumpDfFile', handler: handleDumpDfFile },
        { name: 'crosswayai.dumpAllDBDefinitions', handler: handleDumpAllDBDefinitions },
        { name: 'crosswayai.generateTableRelationsDiagram', handler: handleTableRelationsDiagram },
        { name: 'crosswayai.generatePackageDiagram', handler: handlePackageDiagram, trackDiagram: true },
        { name: 'crosswayai.generateInstanceChainDiagram', handler: handleInstanceChainDiagram, trackDiagram: true },
        { name: 'crosswayai.generatePropertyAccessDiagram', handler: handlePropertyAccessDiagram, trackDiagram: true },
        { name: 'crosswayai.proparseAllProjects', handler: handleProparseAllProjects },
        { name: 'crosswayai.openXrefFile', handler: handleOpenXrefFile },
        { name: 'crosswayai.openProparseFile', handler: handleOpenProparseFile }
    ];

    setupXrefWatcher(context);

    const fileDeleteDisposable = vscode.workspace.onDidDeleteFiles((event) => {
        event.files.forEach(handleFileDelete);
    });

    context.subscriptions.push(fileDeleteDisposable);

    commands.forEach(command => {
        let disposableCommand;
        if (command.handler) {
            disposableCommand = vscode.commands.registerCommand(command.name, async (uri) => {
                ensureWorkspaceSettingsFile();
                const sourceUri = command.trackDiagram
                    ? (uri || (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri))
                    : null;

                await command.handler(context, uri);

                if (sourceUri && sourceUri.fsPath) {
                    activeGeneratedDiagram = { handler: command.handler, uri: sourceUri };
                }
            });
        } else {
            disposableCommand = vscode.commands.registerCommand(command.name, () => {
                vscode.window.showInformationMessage(command.message);
            });
        }
        context.subscriptions.push(disposableCommand);
    });

}

function deactivate() {
    setRefreshActiveMermaidDiagramHandler(null);
    deactivateMermaidViewer();
}

module.exports = {
    activate,
    deactivate
}
