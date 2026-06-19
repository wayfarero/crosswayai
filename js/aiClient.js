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
        model: normalizeConfigValue(httpConfig.model)
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

// Builds a VS Code Language Model client using only the first available model.
async function createVSCodeAIClient() {
    if (!vscode?.lm || typeof vscode.lm.selectChatModels !== 'function') {
        invalidConfig('VS Code AI provider requires vscode.lm.selectChatModels.');
    }

    const userMessageFactory = vscode.LanguageModelChatMessage?.User;
    if (typeof userMessageFactory !== 'function') {
        invalidConfig('VS Code AI provider requires LanguageModelChatMessage.User.');
    }

    let models;
    try {
        models = await vscode.lm.selectChatModels();
    } catch (error) {
        invalidConfig(`VS Code AI provider failed to select models: ${error.message}`);
    }

    if (!Array.isArray(models) || models.length === 0) {
        invalidConfig('VS Code AI provider has no available models.');
    }

    const model = models[0];
    if (!model || typeof model.sendRequest !== 'function') {
        invalidConfig('VS Code AI provider first model is not usable.');
    }

    return {
        provider: 'vscode',
        model: model.id || null,
        async execute(request) {
            const promptText = buildVSCodePrompt(request);
            if (!promptText) {
                return '';
            }

            logAI(`[AI] using provider=vscode model=${model.id || 'unknown'}`);

            const response = await model.sendRequest(
                [userMessageFactory(promptText)],
                {},
                undefined
            );

            let text = '';
            const stream = response?.text;
            if (stream && typeof stream[Symbol.asyncIterator] === 'function') {
                for await (const chunk of stream) {
                    if (typeof chunk === 'string') {
                        text += chunk;
                    } else if (chunk && typeof chunk.value === 'string') {
                        text += chunk.value;
                    } else if (chunk && typeof chunk.text === 'string') {
                        text += chunk.text;
                    }
                }
            }

            logAI(`[AI] response(vscode): ${summarizeForLog(text)}`);
            return text;
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
        const client = await createVSCodeAIClient();
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
