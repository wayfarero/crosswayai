# CrossWayAI Diagram Exclusions

Diagram exclusions hide selected files or folders from generated diagrams. They do not change `.crosswayai/dsMap.json`; they only affect the diagram output.

Update:

```txt
.crosswayai/crosswayai_settings.json
```

## Example

```json
{
  "excludes": [
    "src/legacy",
    "src/abl/core/manager.cls",
    "ProjectB/src/Enterprise/BusinessUnit"
  ]
}
```

## Rules

* Add file and folder paths to the same `excludes` array.
* Paths are relative to the workspace root.
* In multi-project workspaces, include the project path.
* Existing paths are checked to determine whether they are files or folders.
* Folder paths exclude all files under that folder.
* File paths exclude only that file.
* Unknown paths are treated as folder-style paths so nested files are excluded if they match the prefix.
