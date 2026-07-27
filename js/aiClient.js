const http = require('http');
const https = require('https');
const vscode = require('vscode');
const { normalizeConfigValue, getWorkspaceRoot } = require('./workspaceProjects');
const { getCrosswayAISettings } = require('./crosswayaiSettings');
const { getCrossWayAILog } = require('./crosswayaiLogger');

const LOG_PREVIEW_LIMIT = 500;

function summarizeForLog(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) {
        return '(empty)';
    }
    if (text.length <= LOG_PREVIEW_LIMIT) {
        return text;
    }
    return `${text.slice(0, LOG_PREVIEW_LIMIT)}...`;
}

function logAI(message) {
    const CrossWayAILog = getCrossWayAILog();
    if (!CrossWayAILog || typeof CrossWayAILog.appendLine !== 'function') {
        return;
    }
    CrossWayAILog.appendLine(message);
}

function normalizeBaseUrl(baseUrl) {
    const normalized = normalizeConfigValue(baseUrl);
    if (!normalized) {
        return null;
    }

    return normalized
        .replace(/\/chat\/completions\/?$/i, '')
        .replace(/\/+$/, '');
}


// Produces the normalized config shape consumed by createAIClient.
function getAIConfig() {
    const workspaceRoot = getWorkspaceRoot();
    const workspaceAISettings = getCrosswayAISettings(workspaceRoot);
    const httpConfig = workspaceAISettings?.http || {};

    return {
        enabled: workspaceAISettings?.enabled === true,
        provider: normalizeConfigValue(workspaceAISettings?.provider),
        baseUrl: normalizeBaseUrl(httpConfig.baseUrl),
        apiKey: normalizeConfigValue(httpConfig.apiKey),
        model: normalizeConfigValue(httpConfig.model),
        vscode: {
            vendor: normalizeConfigValue(workspaceAISettings?.vscode?.vendor || workspaceAISettings?.vendor),
            model: normalizeConfigValue(workspaceAISettings?.vscode?.model || workspaceAISettings?.vscode?.family || workspaceAISettings?.model || workspaceAISettings?.family),
            id: normalizeConfigValue(workspaceAISettings?.vscode?.id || workspaceAISettings?.id),
            version: normalizeConfigValue(workspaceAISettings?.vscode?.version || workspaceAISettings?.version)
        }
    };
}

// Supports the OpenAI-compatible chat completions response shape.
function extractHttpAIText(payload) {
    const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
    const content = choice?.message?.content;

    if (typeof content === 'string') {
        return content;
    }

    if (Array.isArray(content)) {
        return content
            .map((item) => {
                if (typeof item === 'string') {
                    return item;
                }
                if (item && typeof item.text === 'string') {
                    return item.text;
                }
                return '';
            })
            .join('')
            .trim();
    }

    return '';
}

// Minimal JSON POST helper used by the HTTP provider.
function postJson(urlText, headers, payload) {
    return new Promise((resolve, reject) => {
        let url;
        try {
            url = new URL(urlText);
        } catch (error) {
            reject(new Error(`Invalid HTTP AI URL: ${error.message}`));
            return;
        }

        const transport = url.protocol === 'http:' ? http : https;
        const body = JSON.stringify(payload);
        const request = transport.request({
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port || undefined,
            path: `${url.pathname}${url.search || ''}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
                ...headers
            }
        }, (response) => {
            const chunks = [];

            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => {
                const rawText = Buffer.concat(chunks).toString('utf8');
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    const error = new Error(`HTTP AI request failed (${response.statusCode}): ${summarizeForLog(rawText)}`);
                    error.statusCode = response.statusCode;
                    reject(error);
                    return;
                }

                try {
                    resolve(JSON.parse(rawText || '{}'));
                } catch (error) {
                    reject(new Error(`HTTP AI response parse failed: ${error.message}`));
                }
            });
        });

        request.on('error', reject);
        request.write(body);
        request.end();
    });
}

function invalidConfig(message) {
    logAI(`[AI] invalid config: ${message}`);
    throw new Error(message);
}

function requireConfigValue(value, message) {
    if (value) {
        return value;
    }

    invalidConfig(message);
}

// Builds an OpenAI-compatible HTTP client; required HTTP settings fail fast.
function createHttpAIClient(config) {
    const apiKey = requireConfigValue(config?.apiKey, 'HTTP AI provider requires ai.http.apiKey.');
    const baseUrl = requireConfigValue(config?.baseUrl, 'HTTP AI provider requires ai.http.baseUrl.');
    const model = normalizeConfigValue(config?.model);

    return {
        provider: 'http',
        model,
        async execute(request) {
            const messages = Array.isArray(request?.messages) ? request.messages : [];
            if (messages.length === 0) {
                return '';
            }

            logAI(`[AI] using provider=http model=${model || 'auto'}`);

            const payload = await postJson(
                `${baseUrl}/chat/completions`,
                {
                    Authorization: `Bearer ${apiKey}`
                },
                {
                    ...(model ? { model } : {}),
                    messages,
                    ...(request?.temperature !== undefined ? { temperature: request.temperature } : {}),
                    ...(request?.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {})
                }
            );

            const text = extractHttpAIText(payload);
            logAI(`[AI] response(http): ${summarizeForLog(text)}`);
            return text;
        }
    };
}

// VS Code chat models accept one user message, so flatten role/content messages into one prompt.
function buildVSCodePrompt(request) {
    const messages = Array.isArray(request?.messages) ? request.messages : [];
    return messages
        .map((message) => {
            const role = message?.role || 'user';
            const content = String(message?.content || '').trim();
            if (!content) {
                return '';
            }
            return `[${role}]\n${content}`;
        })
        .filter(Boolean)
        .join('\n\n');
}

function collectVSCodeChunkText(chunk) {
    if (chunk == null) {
        return '';
    }

    if (typeof chunk === 'string') {
        return chunk;
    }

    if (Array.isArray(chunk)) {
        return chunk.map(collectVSCodeChunkText).join('');
    }

    if (typeof chunk === 'object') {
        for (const key of ['value', 'text', 'content', 'delta']) {
            if (typeof chunk[key] === 'string') {
                return chunk[key];
            }
        }
    }

    return '';
}

async function extractVSCodeAIText(response) {
    if (typeof response === 'string') {
        return response.trim();
    }

    const sources = [
        response?.stream,
        response?.text
    ];
    const seen = new Set();

    for (const source of sources) {
        if (source == null || seen.has(source)) {
            continue;
        }
        seen.add(source);

        if (typeof source === 'string') {
            return source.trim();
        }

        if (source && typeof source[Symbol.asyncIterator] === 'function') {
            let text = '';
            for await (const chunk of source) {
                text += collectVSCodeChunkText(chunk);
            }
            if (text.trim()) {
                return text.trim();
            }
        }
    }

    return '';
}

function getVSCodeModelId(model) {
    return String(model?.id || model?.name || 'unknown');
}

function isAutoVSCodeModel(model) {
    return getVSCodeModelId(model).toLowerCase() === 'auto';
}

function getConfiguredVSCodeSelector(config) {
    const vscodeConfig = config?.vscode || {};
    return {
        ...(vscodeConfig.vendor ? { vendor: vscodeConfig.vendor } : {}),
        ...(vscodeConfig.model ? { family: vscodeConfig.model } : {}),
        ...(vscodeConfig.id ? { id: vscodeConfig.id } : {}),
        ...(vscodeConfig.version ? { version: vscodeConfig.version } : {})
    };
}

function hasConfiguredVSCodeSelector(config) {
    return Object.keys(getConfiguredVSCodeSelector(config)).length > 0;
}

function formatVSCodeSelector(selector) {
    const parts = Object.entries(selector || {})
        .map(([key, value]) => key + '=' + value);
    return parts.length > 0 ? parts.join(', ') : '(none)';
}

function notifyInvalidConfig(message) {
    logAI('[AI] invalid config: ' + message);
    if (vscode?.window && typeof vscode.window.showErrorMessage === 'function') {
        vscode.window.showErrorMessage('CrossWayAI: ' + message);
    }
}

function getVSCodeModelSelectors(config) {
    const configuredSelector = getConfiguredVSCodeSelector(config);

    if (Object.keys(configuredSelector).length > 0) {
        return [configuredSelector];
    }

    return [
        { vendor: 'copilot', family: 'gpt-4o' },
        { vendor: 'copilot' },
        {}
    ].filter((selector, index, selectors) => {
        const text = JSON.stringify(selector);
        return index === selectors.findIndex((candidate) => JSON.stringify(candidate) === text);
    });
}

async function selectVSCodeChatModels(config) {
    const modelsById = new Map();

    for (const selector of getVSCodeModelSelectors(config)) {
        let selectedModels;
        try {
            selectedModels = await vscode.lm.selectChatModels(selector);
        } catch (error) {
            continue;
        }

        const usableModels = Array.isArray(selectedModels)
            ? selectedModels.filter((model) => model && typeof model.sendRequest === 'function')
            : [];

        for (const model of usableModels) {
            const id = getVSCodeModelId(model);
            if (!modelsById.has(id)) {
                modelsById.set(id, model);
            }
        }
    }

    return Array.from(modelsById.values()).sort((left, right) => {
        if (isAutoVSCodeModel(left) === isAutoVSCodeModel(right)) {
            return 0;
        }
        return isAutoVSCodeModel(left) ? 1 : -1;
    });
}

async function requestVSCodeModelText(model, promptText, userMessageFactory) {
    logAI(`[AI] using provider=vscode model=${getVSCodeModelId(model)}`);

    const tokenSource = typeof vscode.CancellationTokenSource === 'function'
        ? new vscode.CancellationTokenSource()
        : null;
    let response;
    try {
        response = await model.sendRequest(
            [userMessageFactory(promptText)],
            {},
            tokenSource?.token
        );
    } catch (error) {
        logAI(`[AI] sendRequest failed for model=${getVSCodeModelId(model)}: ${error.message}`);
        throw error;
    }

    try {
        return await extractVSCodeAIText(response);
    } finally {
        if (tokenSource && typeof tokenSource.dispose === 'function') {
            tokenSource.dispose();
        }
    }
}

// Builds a VS Code Language Model client using available model candidates.
async function createVSCodeAIClient(config) {
    if (!vscode?.lm || typeof vscode.lm.selectChatModels !== 'function') {
        invalidConfig('VS Code AI provider requires vscode.lm.selectChatModels.');
    }

    const userMessageFactory = vscode.LanguageModelChatMessage?.User;
    if (typeof userMessageFactory !== 'function') {
        invalidConfig('VS Code AI provider requires LanguageModelChatMessage.User.');
    }

    const models = await selectVSCodeChatModels(config);
    if (models.length === 0) {
        if (hasConfiguredVSCodeSelector(config)) {
            const selectorText = formatVSCodeSelector(getConfiguredVSCodeSelector(config));
            const message = 'VS Code AI provider found no available model for configured selector: ' + selectorText + '.';
            notifyInvalidConfig(message);
            throw new Error(message);
        }
        invalidConfig('VS Code AI provider has no available models.');
    }

    return {
        provider: 'vscode',
        model: getVSCodeModelId(models[0]),
        async execute(request) {
            const promptText = buildVSCodePrompt(request);
            if (!promptText) {
                return '';
            }

            let lastError = null;
            for (const model of models) {
                try {
                    const text = await requestVSCodeModelText(model, promptText, userMessageFactory);
                    if (text) {
                        logAI(`[AI] response(vscode): ${summarizeForLog(text)}`);
                        return text;
                    }
                } catch (error) {
                    lastError = error;
                }
            }

            if (lastError) {
                throw lastError;
            }
            logAI('[AI] response(vscode): (empty)');
            return '';
        }
    };
}

// Keeps the old complete(prompt) API while new code uses execute(request).
function promptToRequest(prompt) {
    return {
        messages: [
            {
                role: 'user',
                content: String(prompt || '').trim()
            }
        ]
    };
}

function withLegacyComplete(client) {
    return {
        ...client,
        // legacy helper
        async complete(prompt) {
            return client.execute(promptToRequest(prompt));
        }
    };
}

// Chooses exactly one explicitly configured provider.
async function createAIClient() {
    const config = getAIConfig();

    if (config.enabled !== true) {
        logAI('[AI] disabled');
        return null;
    }

    if (!config.provider) {
        logAI('[AI] invalid config: provider not set');
        return null;
    }

    if (config.provider === 'http') {
        logAI('[AI] provider=http');
        const client = createHttpAIClient(config);
        return withLegacyComplete(client);
    }

    if (config.provider === 'vscode') {
        logAI('[AI] provider=vscode');
        const client = await createVSCodeAIClient(config);
        return withLegacyComplete(client);
    }

    invalidConfig(`Unknown AI provider: ${config.provider}`);
}

module.exports = {
    getAIConfig,
    createHttpAIClient,
    createVSCodeAIClient,
    createAIClient,
    createBestAvailableAIClient: createAIClient
};
