const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { createBestAvailableAIClient } = require('./aiClient');
const { getCrossWayAILog } = require('./crosswayaiLogger');
const { normalizeFsPath, getDsMapPath, getDsMapJsonObject } = require('./dsMapStore');
const { getWorkspaceRoot } = require('./workspaceProjects');

const NODE_SUMMARY_PROMPT_PATH = ['resources', 'ai_prompts', '@node_summary'];
const SUMMARY_MAX_LENGTH = 420;
const SUMMARY_CACHE_MAX = 500;
const STALE_SUMMARY_MS = 7 * 24 * 60 * 60 * 1000;
const summaryCache = new Map();

function normalizeWhitespace(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
}

function limitSummaryLength(text, maxLength = SUMMARY_MAX_LENGTH) {
    const normalized = normalizeWhitespace(text).replace(/^[-*]\s+/, '');
    if (!normalized) {
        return '';
    }

    if (normalized.length <= maxLength) {
        return normalized;
    }

    const truncated = normalized.slice(0, maxLength);
    const lastSentenceBoundary = Math.max(
        truncated.lastIndexOf('. '),
        truncated.lastIndexOf('! '),
        truncated.lastIndexOf('? ')
    );

    if (lastSentenceBoundary >= 80) {
        return truncated.slice(0, lastSentenceBoundary + 1).trim();
    }

    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace >= 80) {
        return `${truncated.slice(0, lastSpace).trim()}...`;
    }

    return `${truncated.trim()}...`;
}

function buildSourceContext(fileContents) {
    return String(fileContents || '');
}

function getNodeSummaryPromptPath() {
    return path.join(__dirname, '..', ...NODE_SUMMARY_PROMPT_PATH);
}

function replaceAllLiteral(text, search, replacement) {
    return String(text || '').split(search).join(String(replacement || ''));
}

function buildPrompt(nodeId, filePath, sourceContext) {
    const templatePath = getNodeSummaryPromptPath();
    const templateContent = fs.readFileSync(templatePath, 'utf8');

    return [
        ['<nodeId>', nodeId || 'unknown'],
        ['<filePath>', filePath || 'unknown'],
        ['<source>', sourceContext]
    ].reduce(
        (prompt, [placeholder, value]) => replaceAllLiteral(prompt, placeholder, value),
        templateContent
    );
}

function getFileStats(filePath) {
    return fs.statSync(filePath);
}

function padDatePart(value) {
    return String(value).padStart(2, '0');
}

function formatSummaryTimestamp(date = new Date()) {
    return [
        date.getFullYear(),
        '-',
        padDatePart(date.getMonth() + 1),
        '-',
        padDatePart(date.getDate()),
        'T',
        padDatePart(date.getHours()),
        ':',
        padDatePart(date.getMinutes()),
        ':',
        padDatePart(date.getSeconds())
    ].join('');
}

function parseSummaryTimestamp(timestamp) {
    const text = String(timestamp || '').trim();
    if (!text) {
        return null;
    }

    const parsedDate = new Date(text);
    return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

function isSummaryStale(timestamp, stats) {
    const parsedTimestamp = parseSummaryTimestamp(timestamp);
    if (!parsedTimestamp) {
        return false;
    }

    const fileModifiedMs = Number(stats && stats.mtimeMs ? stats.mtimeMs : 0);
    const ageMs = Date.now() - parsedTimestamp.getTime();
    return fileModifiedMs > parsedTimestamp.getTime() || ageMs > STALE_SUMMARY_MS;
}

function buildSummaryResult(summary, timestamp, stats, extra = {}) {
    return {
        ok: true,
        summary,
        aiSummaryTimestamp: timestamp || '',
        aiSummaryStale: isSummaryStale(timestamp, stats),
        ...extra
    };
}

function findDsMapFileRow(dsMapJson, filePath) {
    const rows = dsMapJson && dsMapJson.dsMap && Array.isArray(dsMapJson.dsMap.ttFile)
        ? dsMapJson.dsMap.ttFile
        : [];
    const normalizedFilePath = normalizeFsPath(path.resolve(String(filePath || '')));

    return rows.find(row => normalizeFsPath(path.resolve(String(row.filePath || ''))) === normalizedFilePath) || null;
}

function getSavedNodeSummary(filePath, stats, CrossWayAILog) {
    try {
        const workspaceRoot = getWorkspaceRoot();
        const dsMapJson = getDsMapJsonObject(workspaceRoot, true);
        const fileRow = findDsMapFileRow(dsMapJson, filePath);
        const savedSummary = fileRow ? String(fileRow.aiSummary || '').trim() : '';
        const savedTimestamp = fileRow ? String(fileRow.aiSummaryTimestamp || '').trim() : '';

        if (savedSummary) {
            CrossWayAILog.appendLine(`[NodeSummary] dsMap hit for ${path.basename(filePath)}`);
            return buildSummaryResult(savedSummary, savedTimestamp, stats);
        }
    } catch (error) {
        CrossWayAILog.appendLine(`[NodeSummary] dsMap summary read skipped: ${error.message}`);
    }

    return null;
}

function saveNodeSummary(filePath, summary, timestamp, CrossWayAILog) {
    try {
        const workspaceRoot = getWorkspaceRoot();
        const dsMapJson = getDsMapJsonObject(workspaceRoot, true);
        const fileRow = findDsMapFileRow(dsMapJson, filePath);

        if (!fileRow) {
            CrossWayAILog.appendLine(`[NodeSummary] dsMap summary write skipped: no dsMap row found for ${path.basename(filePath)}`);
            return;
        }

        // Keep the summary with the ttFile row so it survives viewer restarts.
        fileRow.aiSummary = summary;
        fileRow.aiSummaryTimestamp = timestamp || null;
        fs.writeFileSync(getDsMapPath(workspaceRoot), JSON.stringify(dsMapJson, null, 2), 'utf8');
    } catch (error) {
        CrossWayAILog.appendLine(`[NodeSummary] dsMap summary write skipped: ${error.message}`);
    }
}

function buildFailureWithSavedSummary(savedSummaryResult, reason) {
    if (!savedSummaryResult || !savedSummaryResult.summary) {
        return null;
    }

    return {
        ...savedSummaryResult,
        generationErrorReason: reason
    };
}

async function generateNodeSummary(args) {
    const {
        filePath,
        nodeId,
        aiClient,
        forceRefresh
    } = args || {};
    const CrossWayAILog = getCrossWayAILog();

    const normalizedFilePath = typeof filePath === 'string' ? path.normalize(filePath) : '';
    if (!normalizedFilePath) {
        return {
            ok: false,
            reason: 'FILE_NOT_FOUND'
        };
    }

    let stats;
    try {
        stats = getFileStats(normalizedFilePath);
    } catch (error) {
        CrossWayAILog.appendLine(`[NodeSummary] file stat failed: ${normalizedFilePath} (${error.message})`);
        return {
            ok: false,
            reason: 'FILE_READ_FAILED'
        };
    }

    if (!stats.isFile()) {
        CrossWayAILog.appendLine(`[NodeSummary] skipped non-file node path: ${normalizedFilePath}`);
        return {
            ok: false,
            reason: 'FILE_NODE_ONLY'
        };
    }

    const savedSummaryResult = getSavedNodeSummary(normalizedFilePath, stats, CrossWayAILog);
    if (forceRefresh !== true && savedSummaryResult) {
        return savedSummaryResult;
    }

    const mtimeMs = Number(stats.mtimeMs || 0);
    const cacheKey = `${normalizedFilePath}::${mtimeMs}`;
    if (forceRefresh !== true) {
        const cachedSummaryResult = summaryCache.get(cacheKey);
        if (cachedSummaryResult) {
            // refresh LRU position
            summaryCache.delete(cacheKey);
            summaryCache.set(cacheKey, cachedSummaryResult);
            CrossWayAILog.appendLine(`[NodeSummary] cache hit for ${path.basename(normalizedFilePath)}`);
            return cachedSummaryResult;
        }
    }

    const resolvedAIClient = aiClient || await createBestAvailableAIClient();
    if (!resolvedAIClient) {
        const savedFailureResult = buildFailureWithSavedSummary(savedSummaryResult, 'NO_AI_PROVIDER');
        return savedFailureResult || {
            ok: false,
            reason: 'NO_AI_PROVIDER'
        };
    }

    let fileContents;
    try {
        fileContents = fs.readFileSync(normalizedFilePath, 'utf8');
    } catch (error) {
        CrossWayAILog.appendLine(`[NodeSummary] file read failed: ${normalizedFilePath} (${error.message})`);
        const savedFailureResult = buildFailureWithSavedSummary(savedSummaryResult, 'FILE_READ_FAILED');
        return savedFailureResult || {
            ok: false,
            reason: 'FILE_READ_FAILED'
        };
    }

    const sourceContext = buildSourceContext(fileContents);
    let prompt;
    try {
        prompt = buildPrompt(nodeId, normalizedFilePath, sourceContext);
    } catch (error) {
        CrossWayAILog.appendLine(`[NodeSummary] prompt template read failed: ${error.message}`);
        const savedFailureResult = buildFailureWithSavedSummary(savedSummaryResult, 'PROMPT_TEMPLATE_READ_FAILED');
        return savedFailureResult || {
            ok: false,
            reason: 'PROMPT_TEMPLATE_READ_FAILED'
        };
    }

    CrossWayAILog.appendLine(`[NodeSummary] start provider=${resolvedAIClient.provider || 'unknown'} file=${normalizedFilePath}`);
    CrossWayAILog.appendLine('[NodeSummary] prompting AI');

    try {
        const rawResponse = await resolvedAIClient.complete(prompt);
        const summary = limitSummaryLength(rawResponse, SUMMARY_MAX_LENGTH);

        if (!summary) {
            CrossWayAILog.appendLine('[NodeSummary] empty AI response');
            const savedFailureResult = buildFailureWithSavedSummary(savedSummaryResult, 'EMPTY_AI_RESPONSE');
            return savedFailureResult || {
                ok: false,
                reason: 'EMPTY_AI_RESPONSE'
            };
        }

        if (summaryCache.size >= SUMMARY_CACHE_MAX) {
            const oldestKey = summaryCache.keys().next().value;
            summaryCache.delete(oldestKey);
        }

        const summaryTimestamp = formatSummaryTimestamp();
        const summaryResult = buildSummaryResult(summary, summaryTimestamp, stats);
        summaryCache.set(cacheKey, summaryResult);
        saveNodeSummary(normalizedFilePath, summary, summaryTimestamp, CrossWayAILog);
        return summaryResult;

    } catch (error) {
        CrossWayAILog.appendLine(`[NodeSummary] AI failed: ${error.message}`);
        const reason = error?.summaryReason || error?.code || '';
        const normalizedReason = [
            'NO_AI_PROVIDER',
            'VSCODE_LM_QUOTA_EXHAUSTED',
            'OPENAI_QUOTA_EXHAUSTED'
        ].includes(reason)
            ? reason
            : 'AI_GENERATION_FAILED';
        const savedFailureResult = buildFailureWithSavedSummary(savedSummaryResult, normalizedReason);
        return savedFailureResult || {
            ok: false,
            reason: normalizedReason
        };
    }
}

module.exports = {
    generateNodeSummary
};
