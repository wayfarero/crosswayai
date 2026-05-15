# CrossWayAI README

A VS Code extension that visualizes code dependencies for Progress OpenEdge ABL projects, to help developers understand project structure, navigate relationships between files and modules, and identify coupling and architectural issues. Visualize file, module, and symbol dependencies in VS Code with AI-assisted analysis. The extension uses AI to generate and update interactive dependency graphs, enabling faster code comprehension, refactoring, and architectural insights.

## Features

- **Automated Project Analysis:** Scans your OpenEdge ABL project to discover all source files (`.p`, `.w`, `.cls`, `.i`).
- **Multi-Project Workspace Support:** Supports workspaces containing multiple OpenEdge projects.
- **Dependency Mapping:** Triggers a deep analysis using an underlying ABL script to generate a dependency map.
- **Context Menu Integration:** Access diagram generation commands directly from the editor or explorer context menus for quick analysis.
- **AI support integration:** Several Diagram functionalities are handled via existing AI tooling (vscode / html): Table Relations Diagram, node functional description etc.
- **Multiple Diagram Types:** Provides commands to generate various diagrams to visualize your application's architecture, including:
    - Impact Diagram
    - Include Diagram
    - Interface Diagram
    - Inheritance Diagram
    - Call Diagram
    - Package Diagram
    - Instance Chain Diagram
    - Property Access Diagram
    - Table Relations Diagram 

## Requirements

- Progress OpenEdge 11.7 - 12.8 installation.
- [OpenEdge ABL](https://marketplace.visualstudio.com/items?itemName=riversidesoftware.openedge-abl-lsp) VS Code extension (installed automatically with CrossWayAI)
- Windows support only (for now)
- Workspace configuration file (`.code-workspace`) present in the workspace root folder, next to the workspace project folders

## AI Configuration

In order to use the integrated AI support you need to set the AI enabled = true (disabled by default)

CrossWayAI supports both external AI providers (OpenAI-compatible APIs) and VS Code Language Models.

For detailed setup instructions, see: [AI Configuration Guide](./resources/AI_CONFIGURATION.md)


## Before You Start

> **Important:** CrossWayAI requires your ABL sources to be compiled. It reads `.xref`
> files produced by the OpenEdge ABL extension's background builder — without them, no
> dependency data will be available.
>
> **Complete the [OpenEdge ABL extension setup](https://marketplace.visualstudio.com/items?itemName=riversidesoftware.openedge-abl-lsp)
> first** and make sure your project compiles successfully before running CrossWayAI.

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
    
- `Diagram`:

    - `Impact`: Generate an impact analysis diagram for the selected file.
    - `Include`: Generate an include diagram for the selected file
    - `Interface`: Generate an interface diagram for the selected class or interface.
    - `Inheritance`: Generate an inheritance diagram for the selected class.
    - `Call`: Generate a call (invoke and run) diagram for the selected class, procedure or .w .
    - `Package`: Generate a package diagram for the selected file.
    - `Instance Chain`: Generate an instantiation chain diagram for the selected file.
    - `Property Access`: Generate a property access chain diagram for the selected file.
    
- `File`:
    - `XREF`: Open the corresponding XREF file for the selected file.

![Impact Diagram](https://github.com/wayfarero/crosswayai/raw/main/resources/demo/impactdiagram.gif)

-   `Table Relations Diagram`: Generate the selected .df file's tables relations diagram using chat agent

![Table Relations](https://github.com/wayfarero/crosswayai/raw/main/resources/demo/tablerelations.gif)

-   `View diagram`: Open the CrossWayAI Viewer for the selected .md file

![View Diagram](https://github.com/wayfarero/crosswayai/raw/main/resources/demo/viewdiagram.gif)

## Release Notes

### 1.8.3
  - Improvements: 
    - introduced .crosswayai/crosswayai_settings.json default configuration file supporting ai settings; Table Relations diagram is restricted to use AI enabled = true.
    - AI node summary tooltip functionality is now available on all file nodes on every type of file related diagrams
    - reorganized CrossWayAI context menu, added new right-click context menu option to open the corresponding XREF file from the explorer, editor and `CrossWayAI Viewer`
    - added automatic refresh of currently active `CrossWayAI Viewer` diagram on xref updates
    - code refactoring for better maintainability
  - Bug Fixes: 
    - corrected pin tooltip behaviour for nodes and links; now possible to pin both a node DB access tooltip and a link tooltip at the same time
    

For the full release history, see the [CHANGELOG](./CHANGELOG.md).
---

**Enjoy!**
