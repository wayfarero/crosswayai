const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { runABLScript, cleanupDirectory } = require('./diagramCommon');
const { normalizeFsPath, getDsMapPath, getDsMapJsonObject } = require('./dsMapStore');
const { getWorkspaceRoot, buildDsMapFileEntry } = require('./workspaceProjects');
const { getCrossWayAILog } = require('./crosswayaiLogger');
const { setAnalysisRunning, getAnalysisRunning } = require('./analysisState');
const { mapXrefToSourceInfo } = require('./xrefSourceMap');
const { refreshActiveMermaidDiagram } = require('./mermaidRefreshState');

function setupXrefWatcher(context) {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) return;

    const watcherPattern = new vscode.RelativePattern(workspaceRoot, '**/.builder/**/*.xref');
    const watcher = vscode.workspace.createFileSystemWatcher(watcherPattern, false, false, false);
    let changedXrefs = new Set();
    let deletedXrefs = new Set();
    let debounceTimer = null;
    const CrossWayAILog = getCrossWayAILog();

    CrossWayAILog.appendLine(`XREF watcher active.`);

    const takeCurrentBatches = () => {
        const changedBatch = changedXrefs;
        const deletedBatch = deletedXrefs;
        changedXrefs = new Set();
        deletedXrefs = new Set();
        debounceTimer = null;
        return { changedBatch, deletedBatch };
    };

    const handleXrefChange = (uri, changeType = 'change') => {
        const xrefPath = uri.fsPath;
        if (changeType === 'delete') {
            deletedXrefs.add(xrefPath);
            changedXrefs.delete(xrefPath);
        } else {

            changedXrefs.add(xrefPath);
            deletedXrefs.delete(xrefPath);
        }

        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }

        debounceTimer = setTimeout(async () => {
            if (getAnalysisRunning()) {
                // Keep batched changes and retry after the current analysis cycle.
                debounceTimer = setTimeout(async () => {
                    const { changedBatch: retryChangedBatch, deletedBatch: retryDeletedBatch } = takeCurrentBatches();
                    await processChangedXrefs(context, workspaceRoot, retryChangedBatch, retryDeletedBatch);
                }, 2000);
                return;
            }

            const { changedBatch, deletedBatch } = takeCurrentBatches();
            await processChangedXrefs(context, workspaceRoot, changedBatch, deletedBatch);
        }, 2000);
    };

    const onChangeDisposable = watcher.onDidChange((uri) => {
        CrossWayAILog.appendLine(`XREF updated: ${uri.fsPath}`);
        handleXrefChange(uri, 'change');
    });
    const onCreateDisposable = watcher.onDidCreate((uri) => {
        CrossWayAILog.appendLine(`XREF created: ${uri.fsPath}`);
        handleXrefChange(uri, 'create');
    });
    const onDeleteDisposable = watcher.onDidDelete((uri) => {
        CrossWayAILog.appendLine(`XREF deleted: ${uri.fsPath}`);
        handleXrefChange(uri, 'delete');
    });

    context.subscriptions.push(watcher);
    context.subscriptions.push(onChangeDisposable, onCreateDisposable, onDeleteDisposable);
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

    let dsMapUpdated = false;

    const changedFilePathsSet = new Set();
    const deletedFilePathsSet = new Set();
    for (const xrefPath of changedXrefs) {
        const mapped = mapXrefToSourceInfo(xrefPath, dsMapJson);
        if (!mapped || !mapped.filePath) {
            continue;
        }

        changedFilePathsSet.add(mapped.filePath);

        if (mapped.isNewDsMapEntry) {
            const normalizedMappedPath = normalizeFsPath(path.resolve(String(mapped.filePath || '')));
            const alreadyExists = dsMapJson.dsMap.ttFile.some(file => normalizeFsPath(path.resolve(String(file.filePath || ''))) === normalizedMappedPath);
            if (!alreadyExists) {
                dsMapJson.dsMap.ttFile.push(buildDsMapFileEntry(mapped.projectRoot, mapped.sourceRoot, mapped.filePath, path.relative(workspaceRoot, mapped.projectRoot) || ''));
                dsMapUpdated = true;
            }
        }
    }

    for (const xrefPath of deletedXrefs) {
        const mapped = mapXrefToSourceInfo(xrefPath, dsMapJson, { allowMissingSourceFile: true });
        if (mapped && mapped.filePath) {
            deletedFilePathsSet.add(mapped.filePath);
        }
    }

    const changedFilePaths = [...changedFilePathsSet];
    const deletedFilePaths = [...deletedFilePathsSet];
    if (changedFilePaths.length === 0 && deletedFilePaths.length === 0) {
        CrossWayAILog.appendLine(`Incremental update skipped: no source mapping found for ${changedXrefs.size + deletedXrefs.size} changed/deleted xref file(s).`);
        return;
    }

    if (dsMapUpdated) {
        try {
            fs.writeFileSync(dsMapPath, JSON.stringify(dsMapJson, null, 2), 'utf8');
            CrossWayAILog.appendLine('Incremental update: dsMap.json updated with new source file entries before analysis.');
        } catch (error) {
            CrossWayAILog.appendLine(`Incremental update skipped: failed to write dsMap.json (${error.message}).`);
            return;
        }
    }

    CrossWayAILog.appendLine(`Incremental update for ${changedFilePaths.length} changed and ${deletedFilePaths.length} deleted file(s).`);
    if (changedFilePaths.length > 0) {
        CrossWayAILog.appendLine(`Changed: ${changedFilePaths.join(', ')}`);
    }
    if (deletedFilePaths.length > 0) {
        CrossWayAILog.appendLine(`Deleted: ${deletedFilePaths.join(', ')}`);
    }
    CrossWayAILog.show(true);

    try {
        setAnalysisRunning(true);
        const extraArgs = ['-param', JSON.stringify({
            workspaceRoot,
            changedFiles: changedFilePaths.join(','),
            deletedFiles: deletedFilePaths.join(',')
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

module.exports = {
    setupXrefWatcher
};
