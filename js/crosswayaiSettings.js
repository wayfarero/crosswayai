const path = require('path');
const fs = require('fs');
const DEFAULT_SETTINGS = require('../resources/crosswayai_settings.json');

function normalizeEntry(value) {
    return String(value || '')
        .split('\\')
        .join('/')
        .trim()
        .replace(/^\.\/+/, '')
        .replace(/\/+$/, '')
        .toLowerCase();
}

function ensureSettingsFile(settingsPath) {
    const dir = path.dirname(settingsPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(settingsPath)) {
        fs.writeFileSync(settingsPath, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf8');
    }
}

function getExclusionEntries(exclusions) {
    if (!exclusions) {
        return [];
    }

    if (Array.isArray(exclusions)) {
        return exclusions;
    }

    if (exclusions && typeof exclusions === 'object') {
        const folders = Array.isArray(exclusions.folders) ? exclusions.folders : [];
        const files = Array.isArray(exclusions.files) ? exclusions.files : [];
        return [...folders, ...files];
    }

    return [];
}

function getSettingsJson(workspaceRoot) {
    if (!workspaceRoot) {
        return null;
    }

    const settingsPath = path.join(workspaceRoot, '.crosswayai', 'crosswayai_settings.json');
    ensureSettingsFile(settingsPath);

    try {
        return JSON.parse(fs.readFileSync(settingsPath, 'utf8')) || null;
    } catch (error) {
        throw new Error(`Invalid workspace config: ${error.message}`);
    }
}

function getExclusionsSettings(workspaceRoot) {
    try {
        const settings = getSettingsJson(workspaceRoot);
        return getExclusionEntries(settings?.excludes);
    } catch (e) {
        return getExclusionEntries(null);
    }
}

// Reads only the AI block from workspace-level settings.
function getCrosswayAISettings(workspaceRoot) {
    try {
        const settings = getSettingsJson(workspaceRoot);
        return settings?.ai;
    } catch (e) {
        return null;
    }
}

function getExclusionPathType(exclusionPath, rootDir) {
    const rawPath = String(exclusionPath || '').trim();
    if (!rawPath) {
        return 'unknown';
    }

    if (rawPath.endsWith('/') || rawPath.endsWith('\\')) {
        return 'folder';
    }

    const absoluteExclusionPath = path.resolve(rootDir, rawPath);
    try {
        if (fs.existsSync(absoluteExclusionPath)) {
            const stat = fs.statSync(absoluteExclusionPath);
            if (stat.isDirectory()) {
                return 'folder';
            }
            if (stat.isFile()) {
                return 'file';
            }
        }
    } catch (e) {
        return 'unknown';
    }

    return 'unknown';
}

function buildExclusionRules(exclusions, rootDir) {
    return getExclusionEntries(exclusions)
        .map(entry => {
            const normalized = normalizeEntry(entry);
            if (!normalized) {
                return null;
            }

            return {
                path: normalized,
                type: getExclusionPathType(entry, rootDir)
            };
        })
        .filter(Boolean);
}

function createExclusionMatcher(exclusions, rootDir) {
    const rules = buildExclusionRules(exclusions, rootDir);

    return filePath => {
        if (rules.length === 0) {
            return false;
        }

        const relPath = normalizeEntry(path.isAbsolute(filePath) ? path.relative(rootDir, filePath) : filePath);

        for (const rule of rules) {
            if (relPath === rule.path) {
                return true;
            }
            if (rule.type !== 'file' && relPath.startsWith(rule.path + '/')) {
                return true;
            }
        }

        return false;
    };
}

function isExcluded(filePath, exclusions, rootDir) {
    return createExclusionMatcher(exclusions, rootDir)(filePath);
}

module.exports = {
    getExclusionsSettings,
    isExcluded,
    createExclusionMatcher,
    getCrosswayAISettings
};
