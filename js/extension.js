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
const { getDsMapJsonObject } = require('./dsMapStore');
const { getSourceFileMapState, canGenerateDiagramForSource } = require('./floatingNodes');
const { openXrefFile, openProparseFile } = require('./fileHandling');
const { proparseAllProjects } = require('./proparseRunner');
const { ensureProparserCompiled } = require('./proparseContext');
const { setCrossWayAILog } = require('./crosswayaiLogger');
const { setRefreshActiveMermaidDiagramHandler } = require('./mermaidRefreshState');
const { ensureSettingsFile } = require('./crosswayaiSettings');

//Create output channel
let CrossWayAILog = vscode.window.createOutputChannel("CrossWayAILog");
setCrossWayAILog(CrossWayAILog);
const {
    openCrosswayAIViewer,
    showFileInViewer,
    deactivateMermaidViewer,
    isMermaidViewerOpen,
    usesMultipleViewerInstances,
    closeMermaidViewerForFile
} = createMermaidViewer();

const generatedDiagrams = new Map();
let xrefWatcherLifecycle = null;

function normalizeDiagramPath(diagramPath) {
    const normalizedPath = path.resolve(diagramPath);
    return process.platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath;
}

function registerXrefWatcherLifecycle(context, initialRoot) {
    let activeWatcher = setupXrefWatcher(context, initialRoot);
    let disposed = false;

    function restartWatcher(reason) {
        if (disposed) return;
        if (activeWatcher) activeWatcher.dispose();
        activeWatcher = null;

        const workspaceRoot = vscode.workspace.workspaceFolders?.length ? getWorkspaceRoot() : null;
        CrossWayAILog.appendLine(`Restarting XREF watcher (${reason}); workspace root: ${workspaceRoot || '(none)'}.`);
        if (!workspaceRoot) return;

        ensureWorkspaceSettingsFile(workspaceRoot);
        activeWatcher = setupXrefWatcher(context, workspaceRoot);
    }

    const listeners = [
        vscode.workspace.onDidChangeConfiguration(() => restartWatcher('configuration changed')),
        vscode.workspace.onDidChangeWorkspaceFolders(() => restartWatcher('workspace folders changed'))
    ];

    return {
        dispose() {
            if (disposed) return;
            disposed = true;
            listeners.forEach(listener => listener.dispose());
            if (activeWatcher) activeWatcher.dispose();
        }
    };
}

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

    const proparserCompilePromise = ensureProparserCompiled(context, workspaceRoot).catch(error => {
        CrossWayAILog.appendLine(`>Proparse: Unexpected Proparser compile check error: ${error.message}`);
        return false;
    });

    // Stop refreshing link-driven diagrams when their source becomes floating. A
    // floating class remains trackable only for its link-independent package diagram.
    function canRefreshGeneratedDiagram(generatedDiagram, dsMapJson) {
        if (!dsMapJson) {
            return true;
        }

        const sourceState = getSourceFileMapState(dsMapJson, generatedDiagram.uri.fsPath);
        if (canGenerateDiagramForSource(
            sourceState,
            generatedDiagram.uri.fsPath,
            generatedDiagram.diagramType
        )) {
            return true;
        }

        CrossWayAILog.appendLine(`Stopped tracking ${generatedDiagram.uri.fsPath}: the ${generatedDiagram.diagramType} diagram is no longer available.`);
        return false;
    }

    async function refreshActiveMermaidDiagram() {
        const currentWorkspaceRoot = getWorkspaceRoot();
        const dsMapJson = currentWorkspaceRoot ? getDsMapJsonObject(currentWorkspaceRoot, true) : null;

        for (const [diagramKey, generatedDiagram] of Array.from(generatedDiagrams.entries())) {
            if (!isMermaidViewerOpen(generatedDiagram.savedPath)) {
                generatedDiagrams.delete(diagramKey);
                continue;
            }

            if (!canRefreshGeneratedDiagram(generatedDiagram, dsMapJson)) {
                generatedDiagrams.delete(diagramKey);
                continue;
            }

            try {
                CrossWayAILog.appendLine(`Regenerating ${generatedDiagram.diagramType} Mermaid diagram after xref update: ${generatedDiagram.uri.fsPath}`);
                const refreshedPath = await generatedDiagram.handler(context, generatedDiagram.uri);
                if (refreshedPath && normalizeDiagramPath(refreshedPath) !== diagramKey) {
                    generatedDiagrams.delete(diagramKey);
                    generatedDiagram.savedPath = refreshedPath;
                    generatedDiagrams.set(normalizeDiagramPath(refreshedPath), generatedDiagram);
                }
            } catch (error) {
                CrossWayAILog.appendLine(`Failed to regenerate Mermaid diagram after xref update (${generatedDiagram.uri.fsPath}): ${error.message}`);
            }
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
    const handleShowInViewer = (ctx, uri) => showFileInViewer(
        uri || (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri)
    );

    const handleFileDelete = (uri) => {
        if (!uri || !uri.fsPath) {
            return;
        }

        const deletedFilePath = uri.fsPath;
        const workspaceRoot = getWorkspaceRoot();
        const removedDiagramPaths = removeMermaidDiagramsForSourceFile(workspaceRoot, deletedFilePath);

        if (removedDiagramPaths.length > 0) {
            closeMermaidViewerForFile(workspaceRoot, removedDiagramPaths);
            removedDiagramPaths.forEach(removedPath => generatedDiagrams.delete(normalizeDiagramPath(removedPath)));
            CrossWayAILog.appendLine(`Removed ${removedDiagramPaths.length} Mermaid diagram file(s) for deleted source: ${deletedFilePath}`);
        }
    };

    const commands = [
        { name: 'crosswayai.generateMap', handler: handleDependencyMap },
        { name: 'crosswayai.generateImpactDiagram', handler: handleImpactDiagram, diagramType: 'impact' },
        { name: 'crosswayai.generateIncludeDiagram', handler: handleIncludeDiagram, diagramType: 'include' },
        { name: 'crosswayai.generateInterfaceDiagram', handler: handleInterfaceDiagram, diagramType: 'interface' },
        { name: 'crosswayai.generateCallDiagram', handler: handleCallDiagram, diagramType: 'call' },
        { name: 'crosswayai.generateInheritanceDiagram', handler: handleInheritanceDiagram, diagramType: 'inheritance' },
        { name: 'crosswayai.openCrosswayAIViewer', handler: openCrosswayAIViewer },
        { name: 'crosswayai.dumpDfFile', handler: handleDumpDfFile },
        { name: 'crosswayai.dumpAllDBDefinitions', handler: handleDumpAllDBDefinitions },
        { name: 'crosswayai.generateTableRelationsDiagram', handler: handleTableRelationsDiagram },
        { name: 'crosswayai.generatePackageDiagram', handler: handlePackageDiagram, diagramType: 'package' },
        { name: 'crosswayai.generateInstanceChainDiagram', handler: handleInstanceChainDiagram, diagramType: 'instance_chain' },
        { name: 'crosswayai.generatePropertyAccessDiagram', handler: handlePropertyAccessDiagram, diagramType: 'property_access' },
        { name: 'crosswayai.proparseAllProjects', handler: handleProparseAllProjects },
        { name: 'crosswayai.openXrefFile', handler: handleOpenXrefFile },
        { name: 'crosswayai.openProparseFile', handler: handleOpenProparseFile },
        { name: 'crosswayai.showInViewer', handler: handleShowInViewer }
    ];

    xrefWatcherLifecycle = registerXrefWatcherLifecycle(context, workspaceRoot);
    context.subscriptions.push(xrefWatcherLifecycle);

    const fileDeleteDisposable = vscode.workspace.onDidDeleteFiles((event) => {
        event.files.forEach(handleFileDelete);
    });

    context.subscriptions.push(fileDeleteDisposable);

    commands.forEach(command => {
        let disposableCommand;
        if (command.handler) {
            disposableCommand = vscode.commands.registerCommand(command.name, async (uri) => {
                ensureWorkspaceSettingsFile();
                const sourceUri = command.diagramType
                    ? (uri || (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri))
                    : null;

                const savedPath = await command.handler(context, uri);

                if (savedPath && sourceUri && sourceUri.fsPath) {
                    if (!usesMultipleViewerInstances()) {
                        generatedDiagrams.clear();
                    }

                    generatedDiagrams.set(normalizeDiagramPath(savedPath), {
                        handler: command.handler,
                        uri: sourceUri,
                        diagramType: command.diagramType,
                        savedPath
                    });
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
    if (xrefWatcherLifecycle) xrefWatcherLifecycle.dispose();
    xrefWatcherLifecycle = null;
    setRefreshActiveMermaidDiagramHandler(null);
    generatedDiagrams.clear();
    deactivateMermaidViewer();
}

module.exports = {
    activate,
    deactivate
}
