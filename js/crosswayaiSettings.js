const path = require('path');
const fs = require('fs');
const DEFAULT_SETTINGS = require('../resources/crosswayai_settings.json');

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneSettingsValue(value) {
    if (Array.isArray(value)) {
        return value.map(cloneSettingsValue);
    }

    if (isPlainObject(value)) {
        return Object.fromEntries(
            Object.entries(value).map(([key, nestedValue]) => [key, cloneSettingsValue(nestedValue)])
        );
    }

    return value;
}

function addMissingSettings(settings, defaultSettings, parentPath = '') {
    const addedPaths = [];

    for (const key of Object.keys(defaultSettings)) {
        const settingPath = parentPath ? `${parentPath}.${key}` : key;

        if (!Object.prototype.hasOwnProperty.call(settings, key)) {
            settings[key] = cloneSettingsValue(defaultSettings[key]);
            addedPaths.push(settingPath);
            continue;
        }

        if (isPlainObject(settings[key]) && isPlainObject(defaultSettings[key])) {
            addedPaths.push(...addMissingSettings(settings[key], defaultSettings[key], settingPath));
        }
    }

    return addedPaths;
}

function createDefaultSettingsFile(settingsPath) {
    fs.writeFileSync(settingsPath, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf8');
    return {
        created: true,
        patched: false,
        addedPaths: Object.keys(DEFAULT_SETTINGS),
        settings: cloneSettingsValue(DEFAULT_SETTINGS)
    };
}

function readSettingsFile(settingsPath) {
    try {
        return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch (error) {
        throw new Error(`Invalid workspace config: ${error.message}`);
    }
}

function patchMissingDefaultSettings(settingsPath, settings) {
    const addedPaths = addMissingSettings(settings, DEFAULT_SETTINGS);
    if (addedPaths.length > 0) {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    }

    return addedPaths;
}

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
        return createDefaultSettingsFile(settingsPath);
    }

    let settings = readSettingsFile(settingsPath);

    if (!isPlainObject(settings)) {
        settings = {};
    }

    const addedPaths = patchMissingDefaultSettings(settingsPath, settings);

    return {
        created: false,
        patched: addedPaths.length > 0,
        addedPaths,
        settings
    };
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
    return ensureSettingsFile(settingsPath).settings || null;
}

function getExclusionsSettings(workspaceRoot) {
    try {
        const settings = getSettingsJson(workspaceRoot);
        return getExclusionEntries(settings?.excludes);
    } catch (error) {
        return getExclusionEntries(null);
    }
}

// Reads only the AI block from workspace-level settings.
function getCrosswayAISettings(workspaceRoot) {
    try {
        const settings = getSettingsJson(workspaceRoot);
        return settings?.ai;
    } catch (error) {
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
    } catch (error) {
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
    ensureSettingsFile,
    getExclusionsSettings,
    isExcluded,
    createExclusionMatcher,
    getCrosswayAISettings
};
