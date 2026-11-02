declare module 'vscode' {
  export class EventEmitter<T> { event: any; fire(data: T): void; dispose(): void; }
  export interface TreeDataProvider<T> { getTreeItem(element: T): TreeItem | Thenable<TreeItem>; getChildren(element?: T): ProviderResult<T>; }
  export type ProviderResult<T> = T[] | undefined | null | Thenable<T[] | undefined | null>;
  export class TreeItem { constructor(label: string, collapsibleState?: TreeItemCollapsibleState); description?: string; contextValue?: string; }
  export enum TreeItemCollapsibleState { None = 0, Collapsed = 1, Expanded = 2 }
  export namespace window {
    function registerTreeDataProvider<T>(viewId: string, provider: TreeDataProvider<T>): Disposable;
    function registerWebviewViewProvider(viewId: string, provider: WebviewViewProvider): Disposable;
    function createDiagnosticCollection(name: string): DiagnosticCollection;
    function showInformationMessage(message: string): Thenable<unknown>;
    function showWarningMessage(message: string): Thenable<unknown>;
  }
  export namespace commands { function registerCommand(id: string, callback: (...args: any[]) => any): Disposable; }
  export namespace workspace { const workspaceFolders: readonly WorkspaceFolder[] | undefined; function getConfiguration(section?: string): { get<T>(key: string, defaultValue?: T): T | undefined }; }
  export namespace languages { function createDiagnosticCollection(name: string): DiagnosticCollection; }
  export class Uri { static file(path: string): Uri; fsPath: string; toString(): string; }
  export interface WorkspaceFolder { uri: Uri; name: string; index: number; }
  export interface TextDocument { uri: Uri; getText(): string; languageId: string; }
  export class Diagnostic { constructor(range: Range, message: string, severity: DiagnosticSeverity); source?: string; }
  export class Range { constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number); }
  export enum DiagnosticSeverity { Error = 0, Warning = 1, Information = 2, Hint = 3 }
  export interface DiagnosticCollection { set(uri: Uri, diagnostics: Diagnostic[]): void; delete(uri: Uri): void; dispose(): void; }
  export interface ExtensionContext { subscriptions: Disposable[]; extensionPath: string; }
  export interface Disposable { dispose(): void; }
  export interface WebviewViewProvider { resolveWebviewView(view: WebviewView): void | Thenable<void>; }
  export interface WebviewView { webview: Webview; }
  export interface Webview { html: string; options?: unknown; }
  export function onDidOpenTextDocument(listener: (document: TextDocument) => void): Disposable;
  export function onDidSaveTextDocument(listener: (document: TextDocument) => void): Disposable;
  export namespace workspace { function onDidOpenTextDocument(listener: (document: TextDocument) => void): Disposable; function onDidSaveTextDocument(listener: (document: TextDocument) => void): Disposable; }
}
