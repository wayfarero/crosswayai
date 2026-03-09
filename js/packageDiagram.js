const path = require('path');
const fs = require('fs');

function generatePackageDiagram(ctx, uri, deps) {
    const { vscode, CrossWayAILog } = deps;

    if (!uri || !uri.fsPath) {
        vscode.window.showErrorMessage('No file selected');
        return;
    }

    try {
        const fileName = path.basename(uri.fsPath);

        // Get workspace root
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage('No workspace folder found');
            return;
        }
        const workspaceRoot = workspaceFolders[0].uri.fsPath;

        // Get the relative path from workspace root to the selected file
        const relativePath = path.relative(workspaceRoot, uri.fsPath);

        // Read the template file
        const templatePath = path.join(ctx.extensionPath, 'resources', 'mermaid_prompts', '@mermaid_package_diagram');
        const templateContent = fs.readFileSync(templatePath, 'utf8');

        // Replace <selectedFilePath> and <workspaceRoot> with actual values
        const prompt = templateContent
            .replace(/<selectedFilePath>/g, relativePath)
            .replace(/<selectedFileName>/g, fileName)
            .replace(/<workspaceRoot>/g, workspaceRoot);

        // Open chat and pre-fill it with the prompt
        vscode.commands.executeCommand('workbench.action.chat.open', { query: prompt });
    } catch (error) {
        vscode.window.showErrorMessage(`Error processing package diagram: ${error.message}`);
    }
}

module.exports = {
    generatePackageDiagram
};
