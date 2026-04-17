const { runABLScript, resolveWorkspaceRoot, cleanupDirectory } = require('./diagramCommon');

let isAnalysisRunning = false;

function setAnalysisRunning(value) {
    isAnalysisRunning = value;
}

function getAnalysisRunning() {
    return isAnalysisRunning;
}

function setupXrefWatcher(context, deps) {
    const { vscode, fs, path, CrossWayAILog } = deps;

    const workspaceRoot = resolveWorkspaceRoot(vscode.workspace.workspaceFolders, fs, CrossWayAILog);
    if (!workspaceRoot) return;

    const dsMapPath = path.join(workspaceRoot, '.crosswayai', 'dsMap.json');

    const watcher = vscode.workspace.createFileSystemWatcher('**/.builder/**/*.xref');
    let changedXrefs = new Set();
    let debounceTimer = null;

    const handleXrefChange = (uri) => {
        if (isAnalysisRunning) return;

        changedXrefs.add(uri.fsPath);

        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }

        debounceTimer = setTimeout(async () => {
            const batch = changedXrefs;
            changedXrefs = new Set();
            debounceTimer = null;
            await processChangedXrefs(context, workspaceRoot, dsMapPath, batch, deps);
        }, 2000);
    };

    watcher.onDidChange(handleXrefChange);
    watcher.onDidCreate(handleXrefChange);

    context.subscriptions.push(watcher);
}

function mapXrefToSourceFile(xrefPath, dsMapPath, deps) {
    const { fs, path } = deps;

    if (!fs.existsSync(dsMapPath)) return null;

    const builderMatch = xrefPath.match(/^(.+?)[\\\/]\.builder[\\\/]\.pct\d+[\\\/](.+)\.xref$/i);
    if (!builderMatch) return null;

    const projectRoot = builderMatch[1];
    const relPath = builderMatch[2].replace(/\//g, path.sep);

    try {
        const data = JSON.parse(fs.readFileSync(dsMapPath, 'utf8'));
        const ttFile = (data.dsMap && data.dsMap.ttFile) || [];

        for (const file of ttFile) {
            if (!file.filePath.startsWith(projectRoot + path.sep)) continue;
            if (file.filePath.endsWith(path.sep + relPath)) {
                return file.filePath;
            }
        }
    } catch (e) { /* ignore parse errors */ }

    return null;
}

async function processChangedXrefs(context, workspaceRoot, dsMapPath, changedXrefs, deps) {
    const { vscode, fs, path, CrossWayAILog } = deps;

    if (!fs.existsSync(dsMapPath)) {
        CrossWayAILog.appendLine('Incremental update skipped: dsMap.json not found. Run full analysis first.');
        return;
    }

    const changedFilePathsSet = new Set();
    for (const xrefPath of changedXrefs) {
        const filePath = mapXrefToSourceFile(xrefPath, dsMapPath, deps);
        if (filePath) {
            changedFilePathsSet.add(filePath);
        }
    }

    const changedFilePaths = [...changedFilePathsSet];
    if (changedFilePaths.length === 0) return;

    CrossWayAILog.appendLine(`Incremental update for ${changedFilePaths.length} file(s): ${changedFilePaths.join(', ')}`);
    CrossWayAILog.show(true);

    try {
        isAnalysisRunning = true;
        const extraArgs = ['-param', JSON.stringify({ workspaceRoot, changedFiles: changedFilePaths.join(',') })];
        await runABLScript({ context, workspaceRoot, deps, scriptName: 'core/runIncrementalAnalysis.p', args: extraArgs });

        const tempDir = path.join(workspaceRoot, '.crosswayai/temp');
        await cleanupDirectory(tempDir, fs, CrossWayAILog);

        CrossWayAILog.appendLine('Incremental analysis complete.');
        CrossWayAILog.show(true);
    } catch (error) {
        CrossWayAILog.appendLine(`Incremental analysis error: ${error.message}`);
        CrossWayAILog.show(true);
    } finally {
        isAnalysisRunning = false;
    }
}

module.exports = {
    setupXrefWatcher,
    setAnalysisRunning,
    getAnalysisRunning
};
