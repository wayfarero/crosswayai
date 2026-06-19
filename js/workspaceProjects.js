const path = require('path');
const fs = require('fs');
const vscode = require('vscode');
const { getCrossWayAILog } = require('./crosswayaiLogger');

function normalizeConfigValue(value) {
    if (value === undefined || value === null) {
        return null;
    }

    const text = String(value).trim();
    return text || null;
}

function getProjectNameForFolder(folder) {
    return folder.name || path.basename(folder.uri.fsPath);
}

/**
 * Resolves the workspace root directory from the available workspace folders.
 * If there is only one folder, uses its path directly.
 * If the first folder is a parent of other folders, uses path.dirname of a subfolder.
 * Otherwise, uses path.dirname of the first folder.
 */
function resolveWorkspaceRoot(workspaceFolders) {
    const CrossWayAILog = getCrossWayAILog();
    if (!workspaceFolders || workspaceFolders.length === 0) {
        if (CrossWayAILog) CrossWayAILog.appendLine('resolveWorkspaceRoot: No workspace folders found.');
        return '';
    }

    // Look for .code-workspace file recursively upward from each workspace folder
    if (fs) {
        for (const folder of workspaceFolders) {
            let dir = folder.uri.fsPath;
            let prevDir = null;
            while (dir && dir !== prevDir) {
                let files = [];
                try {
                    files = fs.readdirSync(dir);
                } catch (e) {
                    CrossWayAILog.appendLine(`resolveWorkspaceRoot: Permission error reading dir ${dir}`);
                }
                const wsFile = files.find(f => f.endsWith('.code-workspace'));
                if (wsFile) {
                    return dir;
                }
                prevDir = dir;
                dir = path.dirname(dir);
            }
        }
    }

    // Fallback to previous logic
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

function getWorkspaceRoot() {
    const CrossWayAILog = getCrossWayAILog();
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('CrossWayAI: No workspace folder found.');
        return null;
    }

    const workspaceRoot = resolveWorkspaceRoot(workspaceFolders);
    if (!workspaceRoot) {
        vscode.window.showErrorMessage('CrossWayAI: Could not resolve workspace root for XREF lookup.');
        return null;
    }

    return workspaceRoot;
}

function resolveProjectRootFromName(projectName, workspaceRoot) {
    const workspace = vscode.workspace;
    const trimmedProjectName = String(projectName || '').trim();
    if (!trimmedProjectName) {
        return workspaceRoot || null;
    }

    const folders = (workspace && Array.isArray(workspace.workspaceFolders)) ? workspace.workspaceFolders : [];
    const matchingFolder = folders.find(folder => {
        const folderPath = folder && folder.uri ? folder.uri.fsPath : '';
        if (!folderPath) {
            return false;
        }

        const folderName = folder.name || path.basename(folderPath);
        return folderName === trimmedProjectName || path.basename(folderPath) === trimmedProjectName;
    });

    if (matchingFolder && matchingFolder.uri && matchingFolder.uri.fsPath) {
        return matchingFolder.uri.fsPath;
    }

    return workspaceRoot ? path.join(workspaceRoot, trimmedProjectName) : null;
}

function getOpenEdgeProjectConfig(projectRoot) {
    if (!projectRoot) {
        return null;
    }

    const projectJsonPath = path.join(projectRoot, 'openedge-project.json');
    if (!fs.existsSync(projectJsonPath)) {
        return null;
    }

    try {
        const raw = fs.readFileSync(projectJsonPath, 'utf8');
        return JSON.parse(raw);
    } catch (e) {
        return null;
    }
}

function normalizeSourcePathForWorkspace(absolutePath, workspaceRoot) {
    const relative = path.relative(workspaceRoot, absolutePath);
    return relative || '.';
}

function getProjectSourceDirs(projectConfig) {
    return (projectConfig && projectConfig.buildPath ? projectConfig.buildPath : [])
        .filter(entry => entry && entry.type === 'source' && entry.path)
        .map(entry => String(entry.path));
}

function buildDsMapFileEntry(projectRoot, sourceDir, filePath, projectName) {
    const sourceRelative = path.relative(projectRoot, sourceDir || projectRoot);
    const source = sourceRelative === '.' ? '' : sourceRelative;

    return {
        fileName: path.basename(filePath),
        filePath,
        source,
        project: projectName
    };
}

function resolveProjectSourceDirs(projectRoot) {
    if (!projectRoot) {
        return [];
    }

    const cfg = getOpenEdgeProjectConfig(projectRoot);
    if (!cfg) {
        return [];
    }

    const sourceDirs = getProjectSourceDirs(cfg);
    return sourceDirs.map(sourceDir => {
        const normalizedSourceDir = sourceDir.replace(/[\\/]/g, path.sep);
        return path.isAbsolute(normalizedSourceDir)
            ? path.resolve(normalizedSourceDir)
            : path.resolve(projectRoot, normalizedSourceDir);
    });
}

/**
 * Determines the oeversion for a specific project root, considering the active profile if present.
 * @param {string} projectRoot - The root directory of the project
 * @returns {string|null} oeversion for the project, or null if not found
 */
function getProjectOEVersion(projectRoot) {
    const CrossWayAILog = getCrossWayAILog();
    let activeProfile = null;
    const profilePath = path.join(projectRoot, '.vscode', 'profile.json');
    if (fs.existsSync(profilePath)) {
        try {
            const profileJson = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
            if (profileJson && profileJson.profile) {
                activeProfile = profileJson.profile;
            }
        } catch (e) {}
    }

    const projectJsonPath = path.join(projectRoot, 'openedge-project.json');
    const projectJson = getOpenEdgeProjectConfig(projectRoot);
    if (projectJson) {
        //try active profile first
        if (activeProfile && Array.isArray(projectJson.profiles)) {
            const foundProfile = projectJson.profiles.find(p => p.name === activeProfile);
            if (foundProfile && foundProfile.value && foundProfile.value.oeversion) {
                if (CrossWayAILog) CrossWayAILog.appendLine(`>oeversion '${foundProfile.value.oeversion}' picked up from current profile '${activeProfile}' in ${projectJsonPath}`);
                return foundProfile.value.oeversion;
            }
        }
        //then try project level
        if (projectJson.oeversion) {
            if (CrossWayAILog) CrossWayAILog.appendLine(`>oeversion '${projectJson.oeversion}' picked up from project configuration in ${projectJsonPath}`);
            return projectJson.oeversion;
        }
    } else if (!fs.existsSync(projectJsonPath)) {
        if (CrossWayAILog) CrossWayAILog.appendLine(`>getProjectOEVersion: openedge-project.json not found at ${projectJsonPath}`);
    } else {
        if (CrossWayAILog) CrossWayAILog.appendLine(`Failed to parse openedge-project.json at ${projectJsonPath}`);
    }

    //then try workspace default runtime setting
    try {
        const defaultRuntime = vscode.workspace.getConfiguration('abl.configuration').get('defaultRuntime');
        if (defaultRuntime) {
            if (CrossWayAILog) CrossWayAILog.appendLine(`>oeversion '${defaultRuntime}' picked up from workspace defaultRuntime`);
            return defaultRuntime;
        }
    } catch (e) {
        if (CrossWayAILog) CrossWayAILog.appendLine('Failed to read abl.configuration.defaultRuntime: ' + e.message);
    }

    throw new Error(`Could not determine oeversion for ${projectRoot}`);
}

function getRuntimeDLC(oeversion) {
    const CrossWayAILog = getCrossWayAILog();
    try {
        const runtimes = vscode.workspace.getConfiguration('abl.configuration').get('runtimes') || [];
        const runtimeEntry = runtimes.find(r => r.name === String(oeversion));
        const runtimePath = runtimeEntry && runtimeEntry.path;
        if (runtimePath) {
            if (CrossWayAILog) CrossWayAILog.appendLine(`>getRuntimeDLC: resolved runtime path '${runtimePath}' for oeversion '${oeversion}'`);
        }
        return runtimePath || null;
    } catch (e) {
        if (CrossWayAILog) CrossWayAILog.appendLine(`>getRuntimeDLC: failed to read runtimes: ${e.message}`);
        return null;
    }
}

function loadOpenEdgeProjectConfig(folder) {
    
    const projectRoot = folder.uri.fsPath;
    const CrossWayAILog = getCrossWayAILog();
    const projectName = getProjectNameForFolder(folder);
    let cfg = {};
    
    const openedgeProjectJsonPath = path.join(projectRoot, 'openedge-project.json');

    if (fs.existsSync(openedgeProjectJsonPath)) {
        CrossWayAILog.appendLine(`>OpenEdge project config found for project : ${projectName}`);
        CrossWayAILog.show(true);        
        cfg = getOpenEdgeProjectConfig(projectRoot);
        if (!cfg) {
            vscode.window.showErrorMessage('Failed to load openedge-project.json due to parse error.');
        }
    }

    return cfg;
}

async function findSourceFiles(projectRoot, sourceDirs = [], projectName) {
    const CrossWayAILog = getCrossWayAILog();
    const sourceExtensions = ['.p', '.w', '.cls', '.i'];
    const ttFile = [];

    for (const sourcePath of sourceDirs) {
        const normalizedSourceDir = sourcePath.replace(/[\\/]/g, path.sep);
        const sourceDir = path.isAbsolute(normalizedSourceDir)
            ? normalizedSourceDir
            : path.resolve(projectRoot, normalizedSourceDir);

        if (!fs.existsSync(sourceDir)) {
            CrossWayAILog.appendLine(`>Source path not found: ${sourceDir}`);
            continue;
        }

        const source = normalizeSourcePathForWorkspace(sourceDir, projectRoot);
        const normalizedSource = (source === '.') ? '' : source;

        const queue = [{ fsPath: sourceDir, rawPath: sourceDir }];
        while (queue.length > 0) {
            const { fsPath, rawPath } = queue.shift();
            let dirents;
            try {
                dirents = fs.readdirSync(fsPath, { withFileTypes: true });
            } catch (error) {
                CrossWayAILog.appendLine(`>Error reading directory: ${fsPath} - ${error.message}`);
                continue;
            }
            for (const dirent of dirents) {
                const childFsPath = path.join(fsPath, dirent.name);
                const childRawPath = path.join(rawPath, dirent.name);
                if (dirent.isDirectory()) {
                    if (!dirent.name.startsWith('.')) {
                        queue.push({ fsPath: childFsPath, rawPath: childRawPath });
                    }
                } else if (sourceExtensions.includes(path.extname(dirent.name).toLowerCase())) {
                    ttFile.push(buildDsMapFileEntry(projectRoot, sourceDir, childRawPath, projectName));
                }
            }
        }
    }

    return { dsMap: { ttFile } };
}

async function collectWorkspaceSourceFiles(workspaceFolders, workspaceRoot) {
    const collectedFiles = [];

    for (const folder of workspaceFolders || []) {
        const projectRoot = folder.uri.fsPath;

        if (workspaceFolders.length > 1 && path.normalize(projectRoot) === path.normalize(workspaceRoot)) {
            continue;
        }

        const projectName = getProjectNameForFolder(folder);
        const projectSubPath = path.relative(workspaceRoot, projectRoot) || '';
        const projectCfg = loadOpenEdgeProjectConfig(folder);
        const sourcePaths = getProjectSourceDirs(projectCfg);

        const dsMap = await findSourceFiles(projectRoot, sourcePaths, projectSubPath);
        collectedFiles.push(...((dsMap.dsMap && dsMap.dsMap.ttFile) || []));
    }

    return collectedFiles;
}

module.exports = {
    normalizeConfigValue,
    getProjectNameForFolder,
    getWorkspaceRoot,
    resolveProjectRootFromName,
    getOpenEdgeProjectConfig,
    getProjectOEVersion,
    getRuntimeDLC,
    loadOpenEdgeProjectConfig,
    getProjectSourceDirs,
    buildDsMapFileEntry,
    resolveProjectSourceDirs,
    findSourceFiles,
    collectWorkspaceSourceFiles,
    resolveWorkspaceRoot
};