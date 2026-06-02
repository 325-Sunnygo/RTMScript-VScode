'use strict';
// テスト用の最小 vscode スタブ。
class CompletionItem { constructor(label, kind) { this.label = label; this.kind = kind; } }
class SnippetString { constructor(v) { this.value = v; } }
class MarkdownString { constructor(v) { this.value = v; } }
class Range { constructor(a, b, c, d) { this.a = a; this.b = b; this.c = c; this.d = d; } }
class Position { constructor(l, c) { this.line = l; this.character = c; } translate(dl, dc) { return new Position(this.line + dl, this.character + dc); } }
class Diagnostic { constructor(range, msg, sev) { this.range = range; this.message = msg; this.severity = sev; } }
class CompletionList { constructor(items, inc) { this.items = items; this.isIncomplete = inc; } }
class SignatureInformation { constructor(label) { this.label = label; this.parameters = []; } }
class ParameterInformation { constructor(label) { this.label = label; } }
class SignatureHelp { constructor() { this.signatures = []; this.activeSignature = 0; this.activeParameter = 0; } }
class Hover { constructor(contents, range) { this.contents = contents; this.range = range; } }
module.exports = {
  CompletionItem, SnippetString, MarkdownString, Range, Position, Diagnostic, CompletionList,
  SignatureInformation, ParameterInformation, SignatureHelp, Hover,
  CompletionItemKind: new Proxy({}, { get: (_, k) => k }),
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  languages: { createDiagnosticCollection: () => ({ set() {}, delete() {} }) },
};
