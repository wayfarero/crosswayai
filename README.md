# CrossWayAI README

A VS Code extension that visualizes code dependencies for Progress OpenEdge ABL projects, to help developers understand project structure, navigate relationships between files and modules, and identify coupling and architectural issues. Visualize file, module, and symbol dependencies in VS Code with AI-assisted analysis. The extension uses AI to generate and update interactive dependency graphs, enabling faster code comprehension, refactoring, and architectural insights.

## Features

- **Automated Project Analysis:** Scans your OpenEdge ABL project to discover all source files (`.p`, `.w`, `.cls`, `.i`).
- **Multi-Project Workspace Support:** Supports workspaces containing multiple OpenEdge projects.
- **Dependency Mapping:** Triggers a deep analysis using an underlying ABL script to generate a dependency map.
- **Context Menu Integration:** Access diagram generation commands directly from the editor or explorer context menus for quick analysis.
- **Multiple Diagram Types:** Provides commands to generate various diagrams to visualize your application's architecture, including:
    - Impact Diagram
    - Include Diagram
    - Interface Diagram
    - Inheritance Diagram
    - Call Diagram
    - Package Diagram
    - Instance Chain Diagram
    - Table Relations Diagram (AI)

## Requirements

- Progress OpenEdge installation.
- [OpenEdge ABL](https://marketplace.visualstudio.com/items?itemName=riversidesoftware.openedge-abl-lsp) VS Code extension
- Windows support only (for now)

## Recomandations
- Workspace configuration file (.code-workspace) present 

## Getting Started

1.  Open your OpenEdge ABL project workspace in VS Code.
2.  Open the Command Palette (`Ctrl+Shift+P`).
3.  Run the **"CrossWayAI: Generate Dependency Map"** command.
    -  This will create a `.crosswayai` directory in your workspace root, generate an initial `dsMap.json` file containing your project's source files, and then execute the backend ABL process for a full analysis.

![Generate Dependency Map](https://github.com/wayfarero/crosswayai/raw/main/resources/demo/dependency.gif)

5.  Run the **"CrossWayAI: Dump All DB Definitions"** command
    - This will dump all databases configured in the openedge-project.json under the `.crosswayai\dump` directory in your workspace root.

![Dump All DB Definitions](https://github.com/wayfarero/crosswayai/raw/main/resources/demo/dumpalldbdefinitions.gif)

Once the analysis is complete, you can use the other commands to generate specific diagrams.

## Extension Commands

The following commands are available in the Command Palette :

-   `CrossWayAI: Generate Dependency Map`: The primary command to kick off the full analysis of the workspace projects' files.
-   `CrossWayAI: Dump All DB Definitions`: Helper command to dump the current workspace databases schema definition files in order to 
enable users to generate table relationship diagrams using the chat agent.

and via context menus:

-   `Impact Diagram`: Generate an impact analysis diagram for the selected file.
-   `Include Diagram`: Generate an include diagram for the selected file
-   `Interface Diagram`: Generate an interface diagram for the selected class or interface.
-   `Inheritance Diagram`: Generate an inheritance diagram for the selected class.
-   `Call Diagram`: Generate a call (invoke and run) diagram for the selected class, procedure or .w .
-   `Package Diagram`: Generate a package diagram for the selected file.
-   `Instance Chain Diagram`: Generate an instantiation chain diagram for the selected file.

![Impact Diagram](https://github.com/wayfarero/crosswayai/raw/main/resources/demo/impactdiagram.gif)

-   `Table Relations Diagram`: Generate the selected .df file's tables relations diagram using chat agent

![Table Relations](https://github.com/wayfarero/crosswayai/raw/main/resources/demo/tablerelations.gif)

-   `View diagram`: Open the CrossWayAI Viewer for the selected .md file

![View Diagram](https://github.com/wayfarero/crosswayai/raw/main/resources/demo/viewdiagram.gif)

## Release Notes

### 1.7.5

- Bugfix: corrected some more edge cases on include file dependency mapping
- Improvements on zoom functionality: center on mouse cursor, limit the zoom in to the reset level, corrected the reset button to show the original view when the .md file was opened

### 1.7.4

- Bugfix: corrected some more edge cases on include file dependency mapping

### 1.7.3

- Bugfix: Properly determine workspaceRoot for multi-project workspaces and ABL script now uses -T `.crosswayai/temp` for temp files
- Bugfix: Corrected mapping of all types of include files dependencies in the `CrossWayAI: Generate Dependency Map` command

### 1.7.2

- Added support for searching nodes in CrossWayAI Viewer

### 1.7.1

- Fixed "new" (instantiation) links not showing up on impact diagrams
- Added new `Instance Chain Diagram` command to visualize instantiation ("new") chains for a selected file
- Added right-click context menu on diagram nodes in CrossWayAI Viewer with `Open File` action to navigate directly to the source file

### 1.7.0

- Updated Package Diagram to be generated by the extension, not by AI chat prompt
- Added support for multiple project workspace
- Fixed unique identification of file nodes
- Enhanced node label visibility ([project subpath]\(source directory)\package)
- Multiple code refactorings for cleaner maintenance
- Corrected impact diagram to correctly show the public-property and implements links

### 1.6.7

- Bug fixed links tooltip visibility in CrossWayAI Viewer
- Changed default legend state to collapsed in CrossWayAI Viewer
- Updated README.md information
- Fixed cleanup of `.crosswayai/temp` folder after `Dump All DB Definitions` command

### 1.6.6

- Added legend box in the CrossWayAI Viewer for better reference
- Added hover functionality over nodes and links + tooltip functionality for links in Call and Impact diagrams, for better visibility

### 1.6.5

- Added support for new `Package Diagram` diagram type for visualizing the complete package tree structure of a class
- Code refactoring improvements for better maintainability

### 1.6.4

- Refactored code diagram generation commands with enhanced node and link visibility:
  - Added colored node borders that differentiate by node type
  - Implemented colored arrows that differentiate by link type for better visual clarity
  - Updated node labels to display the relative path of the node

### 1.6.3

- Bug fixes in CrossWayAI Viewer link highlight functionality
- Improved Table Relations diagram prompt handling
- Bug fixed Impact diagram generation
- Automatically highlight circular references in Impact diagram

### 1.6.2

- Added mouse click highlight arrow functionality in the CrossWayAI viewer
- dropped dependecy towards [vscode-mermAId](https://marketplace.visualstudio.com/items?itemName=ms-vscode.copilot-mermaid-diagram) VS Code extension, replacing it's intended use with standard chat prompt for `Table Relations Diagram` command
- dropped the `Send to @mermAId` command as no longer needed

### 1.6.1

- Added mouse zoom in/out and drag functionality in the CrossWayAI viewer

### 1.6.0

- Added support for `Inheritance Diagram` via new explorer and editor context menu

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