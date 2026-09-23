const path = require('path');
const fs = require('fs');
const { createHash } = require('crypto');
const vscode = require('vscode');
const { getCrossWayAILog } = require('./crosswayaiLogger');
const { normalizeFsPath, dedupeFilesByPath } = require('./dsMapStore');

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

function getOutputRelativeDir(baseDir, targetDir) {
    const relativeDir = path.relative(baseDir, targetDir);
    if (relativeDir !== '..' && !relativeDir.startsWith('..' + path.sep) && !path.isAbsolute(relativeDir)) {
        return relativeDir;
    }

    // External directories need a stable identity without parent traversal or
    // collisions between projects that share a folder name.
    const absoluteDir = path.resolve(targetDir);
    const identity = process.platform === 'win32' ? absoluteDir.toLowerCase() : absoluteDir;
    const hash = createHash('sha256').update(identity).digest('hex').slice(0, 12);
    const name = path.basename(absoluteDir).replace(/[^a-zA-Z0-9_.-]/g, '_') || 'root';
    return path.join('_external', `${name}-${hash}`);
}

function getSourceOutputRelativeDir(workspaceRoot, projectRoot, sourceRoot) {
    const projectDir = getOutputRelativeDir(workspaceRoot, projectRoot) || path.basename(projectRoot) || 'workspace';
    const sourceDir = getOutputRelativeDir(projectRoot, sourceRoot);
    return path.join(projectDir, sourceDir);
}

let lastWorkspaceRootLogMessage = null;

/**
 * The workspace root is resolved on nearly every command, so the same message would
 * otherwise be repeated on each call. Logs only when the outcome changes.
 */
function logWorkspaceRootOnce(message) {
    if (message === lastWorkspaceRootLogMessage) {
        return;
    }

    lastWorkspaceRootLogMessage = message;

    const CrossWayAILog = getCrossWayAILog();
    if (CrossWayAILog) {
        CrossWayAILog.appendLine(message);
    }
}

/**
 * Reads the crosswayai.workspaceRoot setting. Returns null when unset or invalid,
 * allowing automatic detection to take over. Prevents bad values from breaking
 * resolveWorkspaceRoot by validating absolute paths and guarding filesystem checks.
 */
function getConfiguredWorkspaceRoot() {
    let configuredRoot = null;

    try {
        configuredRoot = normalizeConfigValue(vscode.workspace.getConfiguration('crosswayai').get('workspaceRoot'));
    } catch (error) {
        logWorkspaceRootOnce(`resolveWorkspaceRoot: failed to read crosswayai.workspaceRoot: ${error.message}`);
        return null;
    }

    if (!configuredRoot) {
        return null;
    }

    if (!path.isAbsolute(configuredRoot)) {
        logWorkspaceRootOnce(`resolveWorkspaceRoot: ignoring crosswayai.workspaceRoot '${configuredRoot}', an absolute path is required.`);
        return null;
    }

    // statSync still throws on a permission error, or when the folder disappears
    // right after the check. resolveWorkspaceRoot runs for every command, so a bad
    // value has to degrade to automatic detection instead of breaking the command.
    let isExistingDirectory = false;
    try {
        isExistingDirectory = fs.existsSync(configuredRoot) && fs.statSync(configuredRoot).isDirectory();
    } catch (error) {
        logWorkspaceRootOnce(`resolveWorkspaceRoot: ignoring crosswayai.workspaceRoot '${configuredRoot}': ${error.message}`);
        return null;
    }

    if (!isExistingDirectory) {
        logWorkspaceRootOnce(`resolveWorkspaceRoot: ignoring crosswayai.workspaceRoot '${configuredRoot}', it is not an existing folder.`);
        return null;
    }

    return path.normalize(configuredRoot);
}

/**
 * Returns the directory of the .code-workspace file currently open.
 * Avoids filesystem scanning, which can match workspace files from unrelated folders.
 * Returns null when VS Code is opened on a plain folder.
 */
function getOpenWorkspaceFileDir() {
    const workspaceFile = vscode.workspace.workspaceFile;
    if (!workspaceFile || workspaceFile.scheme !== 'file') {
        return null;
    }

    return path.dirname(workspaceFile.fsPath);
}

function isSameOrAncestorDir(candidateDir, targetDir) {
    const relative = path.relative(candidateDir, targetDir);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Returns the deepest directory shared by all workspace folders.
 * Returns null when folders span multiple drives or share only the drive root,
 * since a drive root is not a usable workspace root. Used when the open
 * .code-workspace file sits inside one project and cannot serve as root for others.
 */
function getCommonAncestorDir(workspaceFolders) {
    const folderPaths = workspaceFolders.map(folder => path.resolve(folder.uri.fsPath));
    const driveRoot = path.parse(folderPaths[0]).root;

    if (folderPaths.some(folderPath => path.parse(folderPath).root.toLowerCase() !== driveRoot.toLowerCase())) {
        return null;
    }

    const segmentLists = folderPaths.map(folderPath => folderPath.slice(driveRoot.length).split(path.sep).filter(Boolean));
    const sharedSegments = [];

    for (let index = 0; index < segmentLists[0].length; index++) {
        const segment = segmentLists[0][index];
        const sharedByAll = segmentLists.every(segments => {
            const otherSegment = segments[index];
            return otherSegment === segment || (process.platform === 'win32'
                && otherSegment !== undefined && otherSegment.toLowerCase() === segment.toLowerCase());
        });

        if (!sharedByAll) {
            break;
        }

        sharedSegments.push(segment);
    }

    if (sharedSegments.length === 0) {
        return null;
    }

    return path.join(driveRoot, ...sharedSegments);
}

/**
 * Resolves the workspace root directory, in order:
 * The crosswayai.workspaceRoot setting when it points at an existing folder.
 * The folder holding the open .code-workspace file, when it contains every workspace folder.
 * The deepest common folder of all workspace folders, for multi-root workspaces whose
 * .code-workspace file lives inside one of the projects.
 * Otherwise the original behaviour:
 * If there is only one folder, uses its path directly.
 * If the first folder is a parent of other folders, uses path.dirname of a subfolder.
 * Otherwise, uses path.dirname of the first folder.
 */
function resolveWorkspaceRoot(workspaceFolders) {
    const CrossWayAILog = getCrossWayAILog();

    const configuredRoot = getConfiguredWorkspaceRoot();
    if (configuredRoot) {
        logWorkspaceRootOnce(`resolveWorkspaceRoot: using configured workspace root ${configuredRoot}`);
        return configuredRoot;
    }

    if (!workspaceFolders || workspaceFolders.length === 0) {
        if (CrossWayAILog) CrossWayAILog.appendLine('resolveWorkspaceRoot: No workspace folders found.');
        return '';
    }

    const workspaceFileDir = getOpenWorkspaceFileDir();
    if (workspaceFileDir && workspaceFolders.every(folder => isSameOrAncestorDir(workspaceFileDir, folder.uri.fsPath))) {
        logWorkspaceRootOnce(`resolveWorkspaceRoot: using the folder of the open workspace file ${workspaceFileDir}`);
        return workspaceFileDir;
    }

    // The open .code-workspace file sits inside one of the projects, so its folder cannot
    // hold the others. The folder shared by all of them is the root the user sees.
    if (workspaceFolders.length > 1) {
        const commonAncestorDir = getCommonAncestorDir(workspaceFolders);
        if (commonAncestorDir) {
            logWorkspaceRootOnce(`resolveWorkspaceRoot: using the common folder of the workspace folders ${commonAncestorDir}`);
            return commonAncestorDir;
        }
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
        project: projectName,
        aiSummary: '',
        aiSummaryTimestamp: null
    };
}

function resolveSourceDirsFromPaths(projectRoot, sourcePaths) {
    return sourcePaths.map(sourceDir => {
        const normalizedSourceDir = sourceDir.replace(/[\\/]/g, path.sep);
        return path.isAbsolute(normalizedSourceDir)
            ? path.resolve(normalizedSourceDir)
            : path.resolve(projectRoot, normalizedSourceDir);
    });
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
    return resolveSourceDirsFromPaths(projectRoot, sourceDirs);
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

    // Source directories that overlap inside the same project collect a file more than once
    const uniqueFiles = dedupeFilesByPath(ttFile);
    const duplicateCount = ttFile.length - uniqueFiles.length;

    if (duplicateCount > 0) {
        CrossWayAILog.appendLine(`>Skipped ${duplicateCount} duplicate file(s) in ${projectName}: its source directories overlap.`);
    }

    return { dsMap: { ttFile: uniqueFiles } };
}

async function collectWorkspaceSourceScan(workspaceFolders, workspaceRoot) {
    const collectedFiles = [];
    const scannedSourceDirs = [];

    for (const folder of workspaceFolders || []) {
        const projectRoot = folder.uri.fsPath;

        if (workspaceFolders.length > 1 && path.normalize(projectRoot) === path.normalize(workspaceRoot)) {
            continue;
        }

        const projectName = getProjectNameForFolder(folder);
        const projectSubPath = path.relative(workspaceRoot, projectRoot) || '';
        const projectCfg = loadOpenEdgeProjectConfig(folder);
        const sourcePaths = getProjectSourceDirs(projectCfg);
        const sourceDirs = resolveSourceDirsFromPaths(projectRoot, sourcePaths)
            .filter(sourceDir => fs.existsSync(sourceDir));

        const dsMap = await findSourceFiles(projectRoot, sourcePaths, projectSubPath);
        collectedFiles.push(...((dsMap.dsMap && dsMap.dsMap.ttFile) || []));
        scannedSourceDirs.push(...sourceDirs);
    }

    return {
        files: collectedFiles,
        scannedSourceDirs
    };
}

async function collectWorkspaceSourceFiles(workspaceFolders, workspaceRoot) {
    const scan = await collectWorkspaceSourceScan(workspaceFolders, workspaceRoot);

    // findSourceFiles only sees one project, so projects declaring the same source
    // directory still contribute the same file once each to the combined scan.
    return dedupeFilesByPath(scan.files);
}

/**
 * Mutates dsMapJson.dsMap.ttFile in place so callers can persist it before
 * running incremental analysis.
 */
async function syncDsMapFilesWithWorkspace(dsMapJson, workspaceRoot) {
    if (!dsMapJson || !dsMapJson.dsMap) {
        return { updated: false, added: [], removed: [] };
    }

    const workspaceFolders = vscode.workspace.workspaceFolders || [];
    const workspaceSourceScan = await collectWorkspaceSourceScan(workspaceFolders, workspaceRoot);
    const currentFiles = workspaceSourceScan.files;
    const scannedSourceDirs = workspaceSourceScan.scannedSourceDirs;

    const scannedPrefixes = scannedSourceDirs.map(dir => normalizeFsPath(dir) + path.sep);
    const isUnderScannedSourceDir = (filePath) => {
        const normalized = normalizeFsPath(filePath);
        return scannedPrefixes.some(prefix => normalized.startsWith(prefix));
    };

    const currentEntriesByPath = new Map();
    for (const entry of currentFiles) {
        currentEntriesByPath.set(normalizeFsPath(entry.filePath), entry);
    }

    const existingFiles = Array.isArray(dsMapJson.dsMap.ttFile) ? dsMapJson.dsMap.ttFile : [];
    const keptFiles = [];
    const keptPaths = new Set();
    const added = [];
    const removed = [];

    for (const entry of existingFiles) {
        const filePath = entry.filePath || entry.FilePath || '';
        const key = normalizeFsPath(filePath);

        if (currentEntriesByPath.has(key)) {
            keptFiles.push(entry);
            keptPaths.add(key);
        } else if (isUnderScannedSourceDir(filePath)) {
            removed.push(filePath);
        } else {
            keptFiles.push(entry);
            keptPaths.add(key);
        }
    }

    for (const [key, entry] of currentEntriesByPath) {
        if (!keptPaths.has(key)) {
            keptFiles.push(entry);
            added.push(entry.filePath);
        }
    }

    dsMapJson.dsMap.ttFile = keptFiles;

    return { updated: added.length > 0 || removed.length > 0, added, removed };
}

module.exports = {
    normalizeConfigValue,
    getProjectNameForFolder,
    getSourceOutputRelativeDir,
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
    syncDsMapFilesWithWorkspace,
    resolveWorkspaceRoot
};
