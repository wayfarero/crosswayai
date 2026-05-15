const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { createBestAvailableAIClient } = require('./aiClient');
const { getCrossWayAILog } = require('./crosswayaiLogger');

const NODE_SUMMARY_PROMPT_PATH = ['resources', 'ai_prompts', '@node_summary'];
const SUMMARY_MAX_LENGTH = 420;
const SUMMARY_CACHE_MAX = 500;
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

async function generateNodeSummary(args) {
    const {
        filePath,
        nodeId,
        aiClient
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

    const mtimeMs = Number(stats.mtimeMs || 0);
    const cacheKey = `${normalizedFilePath}::${mtimeMs}`;
    const cachedSummary = summaryCache.get(cacheKey);
    if (cachedSummary) {
        // refresh LRU position
        summaryCache.delete(cacheKey);
        summaryCache.set(cacheKey, cachedSummary);
        CrossWayAILog.appendLine(`[NodeSummary] cache hit for ${path.basename(normalizedFilePath)}`);
        return {
            ok: true,
            summary: cachedSummary
        };
    }

    const resolvedAIClient = aiClient || await createBestAvailableAIClient();
    if (!resolvedAIClient) {
        return {
            ok: false,
            reason: 'NO_AI_PROVIDER'
        };
    }

    let fileContents;
    try {
        fileContents = fs.readFileSync(normalizedFilePath, 'utf8');
    } catch (error) {
        CrossWayAILog.appendLine(`[NodeSummary] file read failed: ${normalizedFilePath} (${error.message})`);
        return {
            ok: false,
            reason: 'FILE_READ_FAILED'
        };
    }

    const sourceContext = buildSourceContext(fileContents);
    let prompt;
    let promptForLog;
    try {
        prompt = buildPrompt(nodeId, normalizedFilePath, sourceContext);
        promptForLog = buildPrompt(nodeId, normalizedFilePath, `<source omitted - see ${normalizedFilePath}>`);
    } catch (error) {
        CrossWayAILog.appendLine(`[NodeSummary] prompt template read failed: ${error.message}`);
        return {
            ok: false,
            reason: 'PROMPT_TEMPLATE_READ_FAILED'
        };
    }

    CrossWayAILog.appendLine(`[NodeSummary] start provider=${resolvedAIClient.provider || 'unknown'} file=${normalizedFilePath}`);
    CrossWayAILog.appendLine('[NodeSummary] prompt begin');
    CrossWayAILog.appendLine(promptForLog);
    CrossWayAILog.appendLine('[NodeSummary] prompt end');

    try {
        const rawResponse = await resolvedAIClient.complete(prompt);
        const summary = limitSummaryLength(rawResponse, SUMMARY_MAX_LENGTH);

        if (!summary) {
            CrossWayAILog.appendLine('[NodeSummary] empty AI response');
            return {
                ok: false,
                reason: 'EMPTY_AI_RESPONSE'
            };
        }

        if (summaryCache.size >= SUMMARY_CACHE_MAX) {
            const oldestKey = summaryCache.keys().next().value;
            summaryCache.delete(oldestKey);
        }
        summaryCache.set(cacheKey, summary);
        return {
            ok: true,
            summary
        };
    } catch (error) {
        CrossWayAILog.appendLine(`[NodeSummary] AI failed: ${error.message}`);
        const reason = error?.summaryReason || error?.code || '';
        return {
            ok: false,
            reason: [
                'NO_AI_PROVIDER',
                'VSCODE_LM_QUOTA_EXHAUSTED',
                'OPENAI_QUOTA_EXHAUSTED'
            ].includes(reason)
                ? reason
                : 'AI_GENERATION_FAILED'
        };
    }
}

module.exports = {
    generateNodeSummary
};
