const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { runABLScript, cleanupDirectory } = require('./diagramCommon');
const { getDsMapPath, getDsMapJsonObject } = require('./dsMapStore');
const { getWorkspaceRoot, syncDsMapFilesWithWorkspace } = require('./workspaceProjects');
const { getCrossWayAILog } = require('./crosswayaiLogger');
const { setAnalysisRunning, getAnalysisRunning } = require('./analysisState');
const { mapXrefToSourceInfo } = require('./xrefSourceMap');
const { refreshActiveMermaidDiagram } = require('./mermaidRefreshState');

const XREF_WATCHER_DELAY_MS = 2000;

function setupXrefWatcher(context) {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) return;

    const watcherPattern = new vscode.RelativePattern(workspaceRoot, '**/.builder/**/*.xref');
    const watcher = vscode.workspace.createFileSystemWatcher(watcherPattern, false, false, false);
    const pendingXrefs = createPendingXrefBatch();
    const CrossWayAILog = getCrossWayAILog();
    const scheduleXrefProcessing = createXrefProcessingScheduler({
        context,
        workspaceRoot,
        pendingXrefs
    });

    CrossWayAILog.appendLine(`XREF watcher active.`);

    const watcherDisposables = registerXrefWatcherHandlers({
        watcher,
        pendingXrefs,
        scheduleXrefProcessing,
        CrossWayAILog
    });

    context.subscriptions.push(watcher);
    context.subscriptions.push(...watcherDisposables);
    context.subscriptions.push(createPendingXrefCleanup(pendingXrefs));
}

function createPendingXrefBatch() {
    return {
        changed: new Set(),
        deleted: new Set(),
        debounceTimer: null
    };
}

function takeCurrentXrefBatches(pendingXrefs) {
    const changedBatch = pendingXrefs.changed;
    const deletedBatch = pendingXrefs.deleted;
    pendingXrefs.changed = new Set();
    pendingXrefs.deleted = new Set();
    pendingXrefs.debounceTimer = null;
    return { changedBatch, deletedBatch };
}

function createXrefProcessingScheduler({ context, workspaceRoot, pendingXrefs }) {
    return function scheduleXrefProcessing() {
        if (pendingXrefs.debounceTimer) {
            clearTimeout(pendingXrefs.debounceTimer);
        }

        pendingXrefs.debounceTimer = setTimeout(async () => {
            if (getAnalysisRunning()) {
                scheduleXrefProcessing();
                return;
            }

            const { changedBatch, deletedBatch } = takeCurrentXrefBatches(pendingXrefs);
            await processChangedXrefs(context, workspaceRoot, changedBatch, deletedBatch);
        }, XREF_WATCHER_DELAY_MS);
    };
}

function registerXrefWatcherHandlers({ watcher, pendingXrefs, scheduleXrefProcessing, CrossWayAILog }) {
    const handleXrefChange = (uri, changeType = 'change') => {
        const xrefPath = uri.fsPath;
        const isNewPendingXref = updatePendingXrefs(pendingXrefs, changeType, xrefPath);

        if (isNewPendingXref) {
            logPendingXrefEvent(CrossWayAILog, changeType, xrefPath);
        }

        scheduleXrefProcessing();
    };

    return [
        watcher.onDidChange(uri => handleXrefChange(uri, 'change')),
        watcher.onDidCreate(uri => handleXrefChange(uri, 'create')),
        watcher.onDidDelete(uri => handleXrefChange(uri, 'delete'))
    ];
}

function updatePendingXrefs(pendingXrefs, changeType, xrefPath) {
    const targetSet = changeType === 'delete' ? pendingXrefs.deleted : pendingXrefs.changed;
    const isNewPendingXref = !targetSet.has(xrefPath);

    if (changeType === 'delete') {
        pendingXrefs.deleted.add(xrefPath);
        pendingXrefs.changed.delete(xrefPath);
    } else {
        pendingXrefs.changed.add(xrefPath);
        pendingXrefs.deleted.delete(xrefPath);
    }

    return isNewPendingXref;
}

function logPendingXrefEvent(CrossWayAILog, changeType, xrefPath) {
    if (changeType === 'delete') {
        CrossWayAILog.appendLine(`XREF deleted: ${xrefPath}`);
        return;
    }

    if (changeType === 'create') {
        CrossWayAILog.appendLine(`XREF created: ${xrefPath}`);
        return;
    }

    CrossWayAILog.appendLine(`XREF updated: ${xrefPath}`);
}

function createPendingXrefCleanup(pendingXrefs) {
    return {
        dispose: () => {
            if (pendingXrefs.debounceTimer) {
                clearTimeout(pendingXrefs.debounceTimer);
                pendingXrefs.debounceTimer = null;
            }
        }
    };
}

async function processChangedXrefs(context, workspaceRoot, changedXrefs, deletedXrefs) {
    const CrossWayAILog = getCrossWayAILog();
    const dsMapPath = getDsMapPath(workspaceRoot);

    if (!fs.existsSync(dsMapPath)) {
        CrossWayAILog.appendLine('Incremental update skipped: dsMap.json not found. Run full analysis first.');
        return;
    }

    const dsMapJson = getDsMapJsonObject(workspaceRoot, true);
    if (!dsMapJson) {
        CrossWayAILog.appendLine('Incremental update skipped: failed to parse dsMap.json.');
        return;
    }

    if (!dsMapJson.dsMap || typeof dsMapJson.dsMap !== 'object') {
        dsMapJson.dsMap = {};
    }
    if (!Array.isArray(dsMapJson.dsMap.ttFile)) {
        dsMapJson.dsMap.ttFile = [];
    }

    const changedFilePaths = mapXrefsToSourceFiles(changedXrefs, dsMapJson);
    const deletedFilePaths = mapXrefsToSourceFiles(deletedXrefs, dsMapJson, { allowMissingSourceFile: true });
    if (changedFilePaths.length === 0 && deletedFilePaths.length === 0) {
        CrossWayAILog.appendLine(`Incremental update skipped: no source mapping found for ${changedXrefs.size + deletedXrefs.size} changed/deleted xref file(s).`);
        return;
    }

    const syncResult = await syncDsMapBeforeIncrementalAnalysis({
        dsMapJson,
        workspaceRoot,
        dsMapPath,
        CrossWayAILog
    });
    if (!syncResult.ok) {
        return;
    }

    const deletedFilesForAnalysis = [...new Set([...deletedFilePaths, ...syncResult.removedFiles])];

    CrossWayAILog.appendLine(`Incremental update for ${changedFilePaths.length} changed and ${deletedFilesForAnalysis.length} deleted file(s).`);
    if (changedFilePaths.length > 0) {
        CrossWayAILog.appendLine(`Changed: ${changedFilePaths.join(', ')}`);
    }
    if (deletedFilesForAnalysis.length > 0) {
        CrossWayAILog.appendLine(`Deleted: ${deletedFilesForAnalysis.join(', ')}`);
    }
    CrossWayAILog.show(true);

    try {
        setAnalysisRunning(true);
        const extraArgs = ['-param', JSON.stringify({
            workspaceRoot,
            changedFiles: changedFilePaths.join(','),
            deletedFiles: deletedFilesForAnalysis.join(',')
        })];
        await runABLScript({ context, workspaceRoot, scriptName: 'core/runIncrementalAnalysis.p', args: extraArgs });

        const tempDir = path.join(workspaceRoot, '.crosswayai/temp');
        await cleanupDirectory(tempDir);

        CrossWayAILog.appendLine('Incremental analysis complete.\n');
        await refreshActiveMermaidDiagram(context);
        CrossWayAILog.show(true);
    } catch (error) {
        CrossWayAILog.appendLine(`Incremental analysis error: ${error.message}`);
        CrossWayAILog.show(true);
    } finally {
        setAnalysisRunning(false);
    }
}

function mapXrefsToSourceFiles(xrefPaths, dsMapJson, options = {}) {
    const filePaths = new Set();
    for (const xrefPath of xrefPaths) {
        const mapped = mapXrefToSourceInfo(xrefPath, dsMapJson, options);
        if (mapped && mapped.filePath) {
            filePaths.add(mapped.filePath);
        }
    }
    return [...filePaths];
}

async function syncDsMapBeforeIncrementalAnalysis({ dsMapJson, workspaceRoot, dsMapPath, CrossWayAILog }) {
    let syncResult;
    try {
        syncResult = await syncDsMapFilesWithWorkspace(dsMapJson, workspaceRoot);
    } catch (error) {
        CrossWayAILog.appendLine(`Incremental update: workspace ttFile sync failed (${error.message}). Proceeding with existing dsMap.json.`);
        return { ok: true, removedFiles: [] };
    }

    logWorkspaceSyncResult(syncResult, CrossWayAILog);
    if (!syncResult.updated) {
        return { ok: true, removedFiles: syncResult.removed };
    }

    try {
        fs.writeFileSync(dsMapPath, JSON.stringify(dsMapJson, null, 2), 'utf8');
        CrossWayAILog.appendLine('Incremental update: dsMap.json synchronized with workspace files before analysis.');
        return { ok: true, removedFiles: syncResult.removed };
    } catch (error) {
        CrossWayAILog.appendLine(`Incremental update skipped: failed to write dsMap.json (${error.message}).`);
        return { ok: false, removedFiles: [] };
    }
}

function logWorkspaceSyncResult(syncResult, CrossWayAILog) {
    if (!syncResult.updated) {
        return;
    }

    if (syncResult.added.length > 0) {
        CrossWayAILog.appendLine(`Incremental update: added ${syncResult.added.length} new workspace file(s) to dsMap.json.`);
    }
    if (syncResult.removed.length > 0) {
        CrossWayAILog.appendLine(`Incremental update: removed ${syncResult.removed.length} deleted workspace file(s) from dsMap.json.`);
    }
}

module.exports = {
    setupXrefWatcher
};
