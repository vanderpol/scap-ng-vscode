# Assessment Authoring prototype

**Status:** explicit opt-in, source-backed authoring prototype. This does not replace or
modify the existing SCAP-NG custom YAML editor or Authoring sidebar.

## What it tries

The prototype is a focused tree-and-detail authoring view for an automated Assessment:

1. the Assessment title and mode;
2. an expandable tree rooted at Assessment → Tests → Test → Collect/Require/fields;
3. schema-driven controls for every visible scalar field;
4. a **Show schema-backed defaults** toggle that changes only this view;
5. native undoable scalar edits with stale-revision checks;
6. a direct **Reveal in YAML** escape hatch.

It is opened only through **SCAP-NG: Open Assessment Authoring (tree prototype)**.
It does not auto-open, take over a workbench container, or maintain a second
YAML model. Edits are targeted WorkspaceEdit scalar patches, so normal VS Code
undo/redo remains available. It never reports scanner PASS/FAIL. The native
YAML TextDocument remains authoritative. Changes to the source refresh the
prototype while it is open.

## Research and design references

The prototype was informed by these public references, reviewed on 2026-11-04.
No third-party UI code was copied or bundled:

- [VS Code Sidebars UX guidelines](https://code.visualstudio.com/api/ux-guidelines/sidebars): keep sidebar surfaces focused and avoid using them as a general-purpose editor canvas.
- [VS Code custom editor sample](https://github.com/microsoft/vscode-extension-samples/tree/main/custom-editor-sample): synchronize a webview with the native TextDocument and dispose listeners with the panel.
- [Visual JSON](https://github.com/vercel-labs/visual-json/tree/8f3a9eeb55c32b5e233502819b941cef669b0679): tree/form/diff views suggest progressive disclosure rather than one giant form.
- [Monokle](https://github.com/kubeshop/monokle/tree/64cac77463ce3f05e5c88ff1ed884caa7378fa51): schema-aware navigation and validation are useful patterns for content review.
- [React JSON Schema Form](https://github.com/rjsf-team/react-jsonschema-form/tree/c8b120c1bbb984a19a0599345aa54e85458804e2): schema/UI separation is useful, but a normal submit/re-serialize flow is deliberately not used here because it would threaten lossless YAML editing.

These projects are references only. The Inspector uses the existing pinned
SCAP-NG model and source navigation layer, not a competing schema or enum
registry.

## Evaluation gate

Before considering any integration with the existing graphical editor, review
the prototype against the Windows Registry, Linux mount, and optional-input
samples:

- Can a novice find a Test and understand the nested Collect/Require tree?
- Is the collection-versus-requirement distinction understandable without
  knowing SCAP-NG terminology?
- Can a reviewer find the exact YAML source for every displayed value?
- Are complex/unknown authored members visibly retained in the YAML escape
  hatch?
- Does opening the prototype leave the existing YAML editor and Authoring
  sidebar unchanged?
