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

/**
 * Builds the source files an xref can belong to, most specific first.
 * The xref path is only relative to a source directory, so a plain suffix match
 * would also accept a same-named file in another folder. Anchoring every
 * candidate on a configured source directory keeps the mapping unambiguous.
 */
function buildSourceCandidates(projectRoot, pctIndex, relPath) {
    const sourceDirs = resolveProjectSourceDirs(projectRoot);
    const orderedSourceRoots = [];

    // The .pctN suffix identifies the source directory that produced the xref.
    if (Number.isInteger(pctIndex) && pctIndex >= 0 && pctIndex < sourceDirs.length) {
        orderedSourceRoots.push(sourceDirs[pctIndex]);
    }
    orderedSourceRoots.push(...sourceDirs, projectRoot);

    const normalizedProjectRoot = normalizeFsPath(path.resolve(projectRoot)) + path.sep;
    const candidates = [];
    const seenPaths = new Set();

    for (const sourceRoot of orderedSourceRoots) {
        const filePath = path.resolve(sourceRoot, relPath);
        const normalizedFilePath = normalizeFsPath(filePath);

        if (seenPaths.has(normalizedFilePath) || !normalizedFilePath.startsWith(normalizedProjectRoot)) {
            continue;
        }

        seenPaths.add(normalizedFilePath);
        candidates.push({ filePath, sourceRoot });
    }

    return candidates;
}

function buildDsMapFilesByPath(dsMap) {
    const ttFile = (dsMap && dsMap.dsMap && dsMap.dsMap.ttFile) || [];
    const filesByPath = new Map();

    for (const file of ttFile) {
        const filePath = String(file.filePath || '');
        if (filePath) {
            filesByPath.set(normalizeFsPath(path.resolve(filePath)), file);
        }
    }

    return filesByPath;
}

function mapXrefToSourceInfo(xrefPath, dsMap, { allowMissingSourceFile = false } = {}) {
    const parsedXref = parseXrefPath(xrefPath);
    if (!parsedXref) {
        return null;
    }

    const { projectRoot, pctIndex, relPath } = parsedXref;
    const candidates = buildSourceCandidates(projectRoot, pctIndex, relPath);
    const dsMapFilesByPath = buildDsMapFilesByPath(dsMap);

    for (const candidate of candidates) {
        const knownFile = dsMapFilesByPath.get(normalizeFsPath(candidate.filePath));
        if (knownFile) {
            return {
                filePath: knownFile.filePath,
                projectRoot,
                sourceRoot: candidate.sourceRoot,
                isNewDsMapEntry: false
            };
        }
    }

    const fallback = candidates.find(candidate => allowMissingSourceFile || fs.existsSync(candidate.filePath));
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
    mapXrefToSourceInfo
};