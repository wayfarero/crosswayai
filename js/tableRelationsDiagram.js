const path = require('path');
const fs = require('fs');

function generateTableRelationsDiagram(ctx, uri, deps) {
    const { vscode, CrossWayAILog } = deps;

    if (!uri || !uri.fsPath) {
        vscode.window.showErrorMessage('No file selected');
        return;
    }

    try {
        // Get the filename without extension (database name)
        const fileName = path.basename(uri.fsPath, path.extname(uri.fsPath));

        // Get workspace root
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage('No workspace folder found');
            return;
        }
        const workspaceRoot = workspaceFolders[0].uri.fsPath;

        // Read the template file
        const templatePath = path.join(ctx.extensionPath, 'resources', 'mermaid_prompts', '@mermaid_table_relations');
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
