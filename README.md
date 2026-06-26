# CrossWayAI README

A VS Code extension that visualizes code dependencies for Progress OpenEdge ABL projects, to help developers understand project structure, navigate relationships between files and modules, and identify coupling and architectural issues. Visualize file, module, and symbol dependencies in VS Code with AI-assisted analysis. The extension uses AI to generate and update interactive dependency graphs, enabling faster code comprehension, refactoring, and architectural insights.

## Features

- **Automated Project Analysis:** Scans your OpenEdge ABL project to discover all source files (`.p`, `.w`, `.cls`, `.i`).
- **Windows/Unix support:** Supports both types of operation systems VSCode workspaces
- **Single/Multi-Project Workspace Support:** Supports workspaces containing either single or multiple OpenEdge projects.
- **Dependency Mapping:** Triggers a deep analysis using an underlying ABL script to generate a dependency map.
- **Proparse Support** Integrated [Proparse](https://github.com/consultingwerk/proparse) support to enable more complex code analysis in later releases
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

- [Progress OpenEdge](https://www.progress.com/openedge) 11.7 - 12.8 installation.
- [OpenEdge ABL](https://marketplace.visualstudio.com/items?itemName=riversidesoftware.openedge-abl-lsp) VS Code extension (installed automatically with CrossWayAI)
- Java [JDK](https://www.oracle.com/java/technologies/downloads/) installation (needed by Proparse to run)
- Workspace configuration file (`.code-workspace`) present in the workspace root folder, next to the workspace project folders

## AI Configuration

In order to use the integrated AI support you need to set the AI enabled = true (disabled by default)
CrossWayAI supports both external AI providers (OpenAI-compatible APIs) and VS Code Language Models.
For detailed setup instructions, see: [AI Configuration Guide](./resources/AI_CONFIGURATION.md)

## Java Configuration

To use Proparse support, you need to have a correctly installed and configured JDK in the PATH environment variable. This is mandatory for the Proparse functionalities to be available.

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

6. (optionally) run the **"CrossWayAI: Proparse All Projects"** command
    - This will output corresponding proparse files of all workspace ABL files under the `.crosswayai\proparse` directory in your workspace root.

Once the analysis is complete, you can use the other commands to generate specific diagrams or to view the corresponding XREF or Proparse content of an ABL file.

## Diagram Exclusions

You can hide specific files or folders from generated diagrams by adding paths to the `excludes` array in `.crosswayai/crosswayai_settings.json`.

For detailed setup instructions, see: [Diagram Exclusions Guide](./resources/DIAGRAM_EXCLUSIONS.md)

## Extension Commands

The following commands are available in the Command Palette :

-   `CrossWayAI: Generate Dependency Map`: The primary command to kick off the full analysis of the workspace projects' files.
-   `CrossWayAI: Dump All DB Definitions`: Helper command to dump the current workspace databases schema definition files in order to 
enable users to generate table relationship diagrams using the chat agent.
-   `CrossWayAI: Proparse All Projects`: (optional) Helper command to output proparse files for the whole workspace

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
    - `PROPARSE`: Open the corresponding Proparse file for the selected file.

![Impact Diagram](https://github.com/wayfarero/crosswayai/raw/main/resources/demo/impactdiagram.gif)

-   `Table Relations Diagram`: Generate the selected .df file's tables relations diagram using chat agent

![Table Relations](https://github.com/wayfarero/crosswayai/raw/main/resources/demo/tablerelations.gif)

-   `View diagram`: Open the CrossWayAI Viewer for the selected .md file

![View Diagram](https://github.com/wayfarero/crosswayai/raw/main/resources/demo/viewdiagram.gif)

## Release Notes

### 1.9.1
  - Bug Fixes:
    - corrected the automatic refresh of the `CrossWayAI Viewer` due to previous code refactoring
    - corrected .pl class nodes not showing the relative path under unix environment
    - corrected Proparse javac usage under linux
    
For the full release history, see the [CHANGELOG](./CHANGELOG.md).
---

**Enjoy!**
