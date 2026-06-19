const fs = require('fs');
const path = require('path');
const { normalizeFsPath } = require('./dsMapStore');
const { resolveProjectSourceDirs } = require('./workspaceProjects');

function parseXrefPath(xrefPath) {
    const builderMatch = xrefPath.match(/^(.+?)[\\/]\.builder[\\/]\.pct(\d+)[\\/](.+)\.xref$/i);
    if (!builderMatch) {
        return null;
    }

    return {
        projectRoot: builderMatch[1],
        pctIndex: Number.parseInt(builderMatch[2], 10),
        relPath: builderMatch[3].replace(/[\\/]/g, path.sep)
    };
}

function resolveFallbackSourcePath(projectRoot, pctIndex, relPath, requireExistingFile = true) {
    const normalizedProjectRoot = path.resolve(projectRoot).toLowerCase() + path.sep;
    const sourceDirs = resolveProjectSourceDirs(projectRoot);

    if (Number.isInteger(pctIndex) && pctIndex >= 0 && pctIndex < sourceDirs.length) {
        const mappedCandidate = path.resolve(sourceDirs[pctIndex], relPath);
        const normalizedMappedCandidate = mappedCandidate.toLowerCase();
        if (normalizedMappedCandidate.startsWith(normalizedProjectRoot) && (!requireExistingFile || fs.existsSync(mappedCandidate))) {
            return {
                filePath: mappedCandidate,
                sourceRoot: sourceDirs[pctIndex]
            };
        }
    }

    const directCandidate = path.resolve(projectRoot, relPath);
    const normalizedDirectCandidate = directCandidate.toLowerCase();
    if (normalizedDirectCandidate.startsWith(normalizedProjectRoot) && (!requireExistingFile || fs.existsSync(directCandidate))) {
        return {
            filePath: directCandidate,
            sourceRoot: projectRoot
        };
    }

    return null;
}

function mapXrefToSourceInfo(xrefPath, dsMap, { allowMissingSourceFile = false } = {}) {
    const parsedXref = parseXrefPath(xrefPath);
    if (!parsedXref) {
        return null;
    }

    const { projectRoot, pctIndex, relPath } = parsedXref;
    const ttFile = (dsMap && dsMap.dsMap && dsMap.dsMap.ttFile) || [];

    const normalizedProjectRoot = path.resolve(projectRoot).toLowerCase();
    const normalizedSuffix = (path.sep + relPath).toLowerCase();

    for (const file of ttFile) {
        const normalizedFilePath = normalizeFsPath(path.resolve(String(file.filePath || '')));
        if (!normalizedFilePath.startsWith(normalizedProjectRoot + path.sep)) {
            continue;
        }
        if (normalizedFilePath.endsWith(normalizedSuffix)) {
            return {
                filePath: file.filePath,
                projectRoot,
                sourceRoot: null,
                isNewDsMapEntry: false
            };
        }
    }

    const fallback = resolveFallbackSourcePath(projectRoot, pctIndex, relPath, !allowMissingSourceFile);
    if (!fallback) {
        return null;
    }

    return {
        filePath: fallback.filePath,
        projectRoot,
        sourceRoot: fallback.sourceRoot,
        isNewDsMapEntry: true
    };
}

module.exports = {
    parseXrefPath,
    resolveFallbackSourcePath,
    mapXrefToSourceInfo
};