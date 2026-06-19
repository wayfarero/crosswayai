const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const { getAIConfig } = require('./aiClient');
const { getWorkspaceRoot } = require('./workspaceProjects');
const { getCrossWayAILog } = require('./crosswayaiLogger');

function generateTableRelationsDiagram(ctx, uri) {
    const CrossWayAILog = getCrossWayAILog();

    if (!uri || !uri.fsPath) {
        vscode.window.showErrorMessage('No file selected');
        return;
    }

    try {
        // Get the filename without extension (database name)
        const fileName = path.basename(uri.fsPath, path.extname(uri.fsPath));

        // Get workspace root
        const workspaceRoot = getWorkspaceRoot();
        if (!workspaceRoot) {
            return;
        }

        const aiConfig = getAIConfig();
        if (aiConfig.enabled !== true) {
            vscode.window.showErrorMessage('AI Summary is disabled or not configured. Enable it in .crosswayai/crosswayai_settings.json.');
            return;
        }

        // Read the template file
        const templatePath = path.join(ctx.extensionPath, 'resources', 'ai_prompts', '@mermaid_table_relations');
        const templateContent = fs.readFileSync(templatePath, 'utf8');

        // Replace <databasename> and <workspaceRoot> with actual values
        const prompt = templateContent
            .replace(/<databasename>/g, fileName)
            .replace(/<workspaceRoot>/g, workspaceRoot);

        // Open chat and pre-fill it with the prompt
        vscode.commands.executeCommand('workbench.action.chat.open', { query: prompt });
    } catch (error) {
        vscode.window.showErrorMessage(`Error processing table relations: ${error.message}`);
    }
}

module.exports = {
    generateTableRelationsDiagram
};
