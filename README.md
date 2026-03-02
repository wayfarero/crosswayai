# CrossWayAI README

A VS Code extension that visualizes code dependencies for Progress OpenEdge ABL projects, to help developers understand project structure, navigate relationships between files and modules, and identify coupling and architectural issues. Visualize file, module, and symbol dependencies in VS Code with AI-assisted analysis. The extension uses AI to generate and update interactive dependency graphs, enabling faster code comprehension, refactoring, and architectural insights.

## Features

- **Automated Project Analysis:** Scans your OpenEdge ABL project to discover all source files (`.p`, `.w`, `.cls`, `.i`).
- **Dependency Mapping:** Triggers a deep analysis using an underlying ABL script to generate a dependency map.
- **Context Menu Integration:** Access diagram generation commands directly from the editor or explorer context menus for quick analysis.
- **Multiple Diagram Types:** Provides commands to generate various diagrams to visualize your application's architecture, including:
    - Impact Analysis
    - Include Diagram
    - Interface Diagram
    - Call Diagram

## Requirements

- Progress OpenEdge installation.
- [OpenEdge ABL](https://marketplace.visualstudio.com/items?itemName=riversidesoftware.openedge-abl-lsp) VS Code extension
- [vscode-mermAId](https://marketplace.visualstudio.com/items?itemName=ms-vscode.copilot-mermaid-diagram) VS Code extension


## Getting Started

1.  Open your OpenEdge ABL project workspace in VS Code.
2.  Open the Command Palette (`Ctrl+Shift+P`).
3.  Run the **"CrossWayAI: Generate Dependency Map"** command.
4.  This will create a `.crosswayai` directory in your workspace root, generate an initial `dsMap.json` file containing your project's source files, and then execute the backend ABL process for a full analysis.

Once the analysis is complete, you can use the other commands to generate specific diagrams.

## Extension Commands

The following commands are available in the Command Palette and via context menus:

-   `CrossWayAI: Generate Dependency Map`: The primary command to kick off the full analysis of the workspace projects' files.
-   `CrossWayAI: Dump All DB Definitions`: Helper command to dump the current workspace databases schema definition files in order to enable users to generate table relationship diagrams using the @mermAId chat agent.
-   `Impact Diagram`: Generate an impact analysis diagram for the selected file.
-   `Include Diagram`: Generate an include diagram for the selected file
-   `Interface Diagram`: Generate an interface diagram for the selected class or interface.
-   `Call Diagram`: Generate a call (invoke and run) diagram for the selected class, procedure or .w .
-   `Table Relations`: Generate the selected .df file's tables relations diagram using @mermAId chat agent
-   `Send to @mermaid`: Generate a diagram based on a @mermaid chat agent prompt
-   `View diagram`: Open the local Mermaid viewer for the selected or active markdown file, or prompt you to choose a `.md` file from the workspace

## Release Notes

### 1.5.2

- Bug fixes on diagram commands
- Added new explorer and editor context command `Table relations` to AI generate the database table relations diagram (.md file under .crosswayai/mermaid) out of the selected .df file , using the @mermAId chat agent


### 1.5.1

- Added support to generate database table relations diagram using `@mermaid_table_relations` template prompt out of .df files dumped by new `CrossWayAI: Dump All DB Definitions` command


### 1.5.0

- Bug fixed CrossWayAI submenu visibility in explorer context menu for supported file types.
- Renamed all diagram types options by removing the `Generate` prefix
- Renamed mermaid viewer container tab to "CrossWayAI viewer - <.md file name>"
- Added new `Call Diagram` option

### 1.4.4

- Added new `Generate Interface Diagram` option
- Bug fixing on mermaid rendering auto refresh.

### 1.4.3

- More code refactoring on HTML components for improved maintainability.

### 1.4.2

- Refactored extension JavaScript code to improve maintainability and simplify future bug fixes.
- Fixed impact diagram generation issues, including layout and duplicate-link rendering behavior.

### 1.4.1

- Bug fixes for workspace configuration and source-path handling.
- Refactoring of xref and diagram processing internals.
- Stability improvements for Mermaid rendering and dependency map generation.

### 1.4.0

- Dropped the Markdown Preview Mermaid extension integration and replaced it with a a proprietary custom Mermaid Viewer.
- Added a new Mermaid viewer command: `CrossWayAI: View diagram`.
- Updated the `Generate Impact Diagram` and `Generate Include Diagram` to automatically show the generated diagram using the custom Mermaid Viewer

### 1.3.0

- Renamed extension from CrosswAI to CrossWayAI
 
- Updated package dependencies to automatically install required extensions:
  - [OpenEdge ABL](https://marketplace.visualstudio.com/items?itemName=riversidesoftware.openedge-abl-lsp)
  - [Markdown Preview Mermaid Support](https://marketplace.visualstudio.com/items?itemName=bierner.markdown-mermaid)
  - [vscode-mermAId](https://marketplace.visualstudio.com/items?itemName=ms-vscode.copilot-mermaid-diagram)

### 1.2.1

- Added support to send a prompt text to @mermaid chat agent from a text file.

### 1.1.1

- The mermaid file for the generate diagram commands is now persisted under the .crosswayai/mermaid folder for future usage.

### 1.1.0

-   Support for Impact and Include Diagrams has been added.

### 1.0.0

-   Initial release of CrossWayAI.
-   Added commands for generating dependency maps and various diagrams.
-   File discovery and hand-off to ABL backend for analysis.

---

**Enjoy!**