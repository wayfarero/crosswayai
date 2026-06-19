const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { runABLScript, cleanupDirectory } = require('./diagramCommon');
const { getDsMapPath, getDsMapJsonObject } = require('./dsMapStore');
const { getWorkspaceRoot, getProjectNameForFolder, loadOpenEdgeProjectConfig, findSourceFiles } = require('./workspaceProjects');
const { setAnalysisRunning } = require('./analysisState');
const { getCrossWayAILog } = require('./crosswayaiLogger');


function getDsMapFileCount(workspaceRoot) {
    try {
        const dsMapJson = getDsMapJsonObject(workspaceRoot, true);
        if (!dsMapJson) {
            return 0;
        }
        return (dsMapJson.dsMap && dsMapJson.dsMap.ttFile) ? dsMapJson.dsMap.ttFile.length : 0;
    } catch (e) {
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
                } catch (e) { /* ignore parse errors, start fresh */ }
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
    try {
        setAnalysisRunning(true);
        await runABLAnalysis(context, workspaceRoot);
    } catch (error) {
        CrossWayAILog.appendLine(`**Error during ABL analysis: ${error.message}`);
        CrossWayAILog.show(true);
    } finally {
        setAnalysisRunning(false);
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
