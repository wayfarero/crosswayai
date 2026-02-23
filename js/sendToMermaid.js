async function sendToMermaid(context, uri, deps) {
    const { vscode, fs } = deps;
    let fileContent;

    if (uri && uri.fsPath) {
        // Command was triggered from the explorer context menu.
        try {
            fileContent = fs.readFileSync(uri.fsPath, 'utf8');
        } catch (error) {
            vscode.window.showErrorMessage(`Error reading file: ${error.message}`);
            return;
        }
    } else {
        // Command was triggered from the editor context menu.
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage('No active editor found.');
            return;
        }
        fileContent = editor.document.getText();
    }

    if (!fileContent) {
        vscode.window.showInformationMessage('No content to process.');
        return;
    }

    const prompt = `@mermaid\n${fileContent}`;

    // Open chat and pre-fill it with the prompt.
    await vscode.commands.executeCommand('workbench.action.chat.open', { query: prompt });
}

module.exports = {
    sendToMermaid
};
