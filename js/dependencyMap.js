const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { runABLScript, cleanupDirectory } = require('./diagramCommon');
const { getDsMapPath, getDsMapJsonObject } = require('./dsMapStore');
const { getWorkspaceRoot, getProjectNameForFolder, loadOpenEdgeProjectConfig, findSourceFiles } = require('./workspaceProjects');
const { setAnalysisRunning } = require('./analysisState');
const { getCrossWayAILog } = require('./crosswayaiLogger');

const MISSING_XREF_WARNING_MESSAGE = 'CrossWayAI: Dependency map generation completed with missing XREF files. Some relationships may be incomplete. See CrossWayAILog and .crosswayai/crosswayai.log for details.';
const MISSING_XREF_LOG_PATTERNS = [
    '.xref file not found for',
    'no .xref file found for'
];


function appendLogLineSafely(CrossWayAILog, message, { show = false } = {}) {
    if (!CrossWayAILog) {
        return false;
    }

    try {
        CrossWayAILog.appendLine(message);
        if (show) {
            CrossWayAILog.show(true);
        }
        return true;
    } catch (error) {
        return false;
    }
}

function getDsMapFileCount(workspaceRoot) {
    try {
        const dsMapJson = getDsMapJsonObject(workspaceRoot, true);
        if (!dsMapJson) {
            return 0;
        }
        return (dsMapJson.dsMap && dsMapJson.dsMap.ttFile) ? dsMapJson.dsMap.ttFile.length : 0;
    } catch (error) {
        return 0;
    }
}

function getWorkspaceProjectsSourceDirMap(workspaceFolders, workspaceRoot) {
    const CrossWayAILog = getCrossWayAILog();
    const workspaceSourceDirMap = new Map();

    for (const folder of workspaceFolders) {
        const projectRoot = folder.uri.fsPath;

        // Skip the workspace root folder in multi-project workspaces
        if (workspaceFolders.length > 1 && path.normalize(projectRoot) === path.normalize(workspaceRoot)) {
            continue;
        }

        const projectCfg = loadOpenEdgeProjectConfig(folder, { vscode, fs, path, CrossWayAILog });
        const sourcePaths = (projectCfg.buildPath || [])
            .filter(p => p.type === 'source' && p.path)
            .map(p => p.path);

        workspaceSourceDirMap.set(projectRoot, sourcePaths);
    }

    return workspaceSourceDirMap;
}

function getMissingXrefLogStatus(workspaceRoot) {
    const logPath = path.join(workspaceRoot, '.crosswayai', 'crosswayai.log');
    if (!fs.existsSync(logPath)) {
        return { hasEntries: false, error: null };
    }

    try {
        const logContent = fs.readFileSync(logPath, 'utf8').toLowerCase();
        return {
            hasEntries: MISSING_XREF_LOG_PATTERNS.some(pattern => logContent.includes(pattern)),
            error: null
        };
    } catch (error) {
        return { hasEntries: false, error };
    }
}

function showMissingXrefWarningIfNeeded(workspaceRoot, CrossWayAILog) {
    const missingXrefLogStatus = getMissingXrefLogStatus(workspaceRoot);
    if (missingXrefLogStatus.error) {
        appendLogLineSafely(
            CrossWayAILog,
            `>Warning: Failed to inspect crosswayai.log for missing XREF entries: ${missingXrefLogStatus.error.message}`,
            { show: true }
        );
        return false;
    }

    if (!missingXrefLogStatus.hasEntries) {
        return false;
    }

    appendLogLineSafely(CrossWayAILog, MISSING_XREF_WARNING_MESSAGE, { show: true });

    vscode.window.showWarningMessage(MISSING_XREF_WARNING_MESSAGE);
    return true;
}


async function generateDependencyMap(context) {
    const CrossWayAILog = getCrossWayAILog();

    vscode.window.showInformationMessage('CrossWayAI: Generating dependency map...');

    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        return;
    }

    CrossWayAILog.appendLine(`\nStarted generating dependency map for workspace: ${workspaceRoot} ...`);
    CrossWayAILog.show(true);
    
    const crosswayaiDir = path.join(workspaceRoot, '.crosswayai');
    
    if (!fs.existsSync(crosswayaiDir)) {
        fs.mkdirSync(crosswayaiDir);
    }
    CrossWayAILog.appendLine(`>crosswayaiDir created: ${crosswayaiDir}`);
    CrossWayAILog.show(true);
    
    const projectResults = [];
    const workspaceFolders = vscode.workspace.workspaceFolders || [];
    const workspaceProjectsSourceDirMap = getWorkspaceProjectsSourceDirMap(workspaceFolders, workspaceRoot);

    const dsMapPath = getDsMapPath(workspaceRoot);
    // Remove existing dsMap.json to start fresh for every generate dependency map run
    if (fs.existsSync(dsMapPath)) {
        fs.unlinkSync(dsMapPath);
    }
    
    for (const folder of workspaceFolders) {
        const projectRoot = folder.uri.fsPath;
        const projectName = getProjectNameForFolder(folder);
        const projectSubPath = path.relative(workspaceRoot, projectRoot) || '';


        // Skip the workspace root folder in multi-project workspaces
        if (workspaceFolders.length > 1 && path.normalize(projectRoot) === path.normalize(workspaceRoot)) {
            continue;
        }       

        try {

            const projectSourceDirPaths = workspaceProjectsSourceDirMap.get(projectRoot) || [];

            CrossWayAILog.appendLine(`>projectName (${projectName}), projectSubPath (${projectSubPath}), sourcePaths: ${projectSourceDirPaths}`);
            CrossWayAILog.show(true);

            const dsMap = await findSourceFiles(projectRoot, projectSourceDirPaths, projectSubPath);

            const prevCount = getDsMapFileCount(workspaceRoot);

            // Append to existing dsMap.json if it exists from a previous iteration
            if (fs.existsSync(dsMapPath)) {
                try {
                    const dsMapJson = JSON.parse(fs.readFileSync(dsMapPath, 'utf8'));
                    if (dsMapJson.dsMap && dsMapJson.dsMap.ttFile) {
                        dsMap.dsMap.ttFile = dsMapJson.dsMap.ttFile.concat(dsMap.dsMap.ttFile);
                    }
                } catch (error) {
                    appendLogLineSafely(CrossWayAILog, `>Warning: Failed to read existing dsMap.json, starting fresh: ${error.message}`);
                }
            }
            fs.writeFileSync(dsMapPath, JSON.stringify(dsMap, null, 2));

            const totalCount = getDsMapFileCount(workspaceRoot);
            const deltaCount = totalCount - prevCount;
            projectResults.push({ projectName, projectRoot, fileCount: deltaCount, success: true });
            CrossWayAILog.appendLine(`>Found ${deltaCount} files for ${projectName} (total: ${totalCount}).`);
            CrossWayAILog.show(true);

        } catch (error) {
            projectResults.push({ projectName, projectRoot, success: false, error });
            CrossWayAILog.appendLine(`**Error during map generation for ${projectName}: ${error.message}`);
            CrossWayAILog.show(true);
        }
    }

    const failedProjects = projectResults.filter(result => !result.success);
    const successfulProjects = projectResults.filter(result => result.success);

    if (successfulProjects.length === 0) {
        CrossWayAILog.appendLine("**No successful projects. Aborting analysis.");
        CrossWayAILog.show(true);
        const failedNames = failedProjects.map(project => project.projectName).join(', ');
        vscode.window.showWarningMessage(`CrossWayAI: Dependency map generation failed for all projects: ${failedNames}. See CrossWayAILog for details.`);
        return;
    }

    CrossWayAILog.appendLine(`>Running ABL analysis...`);
    CrossWayAILog.show(true);
    let ablAnalysisCompleted = false;
    try {
        setAnalysisRunning(true);
        await runABLAnalysis(context, workspaceRoot);
        ablAnalysisCompleted = true;
    } catch (error) {
        CrossWayAILog.appendLine(`**Error during ABL analysis: ${error.message}`);
        CrossWayAILog.show(true);
    } finally {
        setAnalysisRunning(false);
    }

    if (ablAnalysisCompleted) {
        showMissingXrefWarningIfNeeded(workspaceRoot, CrossWayAILog);
    }

    CrossWayAILog.appendLine("Done generating dependency map.\n");
    CrossWayAILog.show(true);

    if (failedProjects.length > 0) {
        const failedNames = failedProjects.map(project => project.projectName).join(', ');
        vscode.window.showWarningMessage(`CrossWayAI: Dependency map generation completed with errors. Failed projects: ${failedNames}. See CrossWayAILog for details.`);
        return;
    }

    if (successfulProjects.length === 1) {
        vscode.window.showInformationMessage('CrossWayAI: Dependency map generation complete.');
        return;
    }

    vscode.window.showInformationMessage(`CrossWayAI: Dependency map generation complete for ${successfulProjects.length} projects.`);
}

async function runABLAnalysis(context, workspaceRoot) {
    // runABLScript will determine oeversion automatically if not provided
    const extraArgs = ['-param', JSON.stringify({ workspaceRoot })];
    await runABLScript({ context, workspaceRoot, scriptName: 'core/runAnalysis.p', args: extraArgs });
    const tempDir = path.join(workspaceRoot, '.crosswayai/temp');
    await cleanupDirectory(tempDir);
}




module.exports = {
    generateDependencyMap
};
