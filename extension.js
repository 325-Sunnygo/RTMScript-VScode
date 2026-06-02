'use strict';
/*
 * extension.js — RTM Script Helper のエントリポイント。
 * バージョン状態(state)を中心に、補完・構文チェック・サイドバーを束ねる。
 */

const path = require('path');
const vscode = require('vscode');

const { ApiIndex } = require('./src/apiIndex');
const { createProvider } = require('./src/completion');
const { createDiagnostics } = require('./src/diagnostics');
const { VersionTreeProvider, InfoTreeProvider, VERSIONS } = require('./src/versionView');
const { looksLikeRtmScript } = require('./src/detect');
const { createSignatureProvider } = require('./src/signature');
const { createHoverProvider } = require('./src/hover');
const { TEMPLATES, CHEATSHEET } = require('./src/knowledge');

function activate(context) {
  const dataDir = path.join(context.extensionPath, 'data');

  // バージョンごとの ApiIndex を遅延ロードしてキャッシュ
  const cache = {};
  function indexFor(version) {
    if (!cache[version]) cache[version] = new ApiIndex(version, dataDir);
    return cache[version];
  }

  function cfg() {
    const c = vscode.workspace.getConfiguration('rtmScript');
    return {
      version: c.get('version', '1.12.2'),
      ecmaVersion: c.get('ecmaVersion', '5'),
      enableDiagnostics: c.get('enableDiagnostics', true),
      activateOnlyInRtmScripts: c.get('activateOnlyInRtmScripts', true),
      autoRtmLanguageMode: c.get('autoRtmLanguageMode', true),
    };
  }

  // 現在バージョンの状態オブジェクト(各モジュールへ渡す)
  const state = {
    versionName() { return cfg().version; },
    current() { return indexFor(cfg().version); },
  };

  // 対象言語: 通常の javascript と、RTM 専用モード rtmjs の両方
  const SELECTOR = [{ language: 'javascript' }, { language: 'rtmjs' }];

  // このドキュメントで RTM 支援を有効化するか。
  // - rtmjs(RTM 専用モード)なら常に有効
  // - javascript なら、既定では「RTM らしいファイル」だけで有効化(普通の開発を妨げない)
  function shouldActivate(document) {
    if (!document) return false;
    if (document.languageId === 'rtmjs') return true;
    if (document.languageId !== 'javascript') return false;
    if (!cfg().activateOnlyInRtmScripts) return true;
    const fsPath = (document.uri && document.uri.fsPath) ? document.uri.fsPath : (document.fileName || '');
    return looksLikeRtmScript(document.getText(), fsPath);
  }

  // ---- 補完プロバイダ -------------------------------------------------------
  const provider = createProvider(state, shouldActivate);
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(SELECTOR, provider, '.', '(')
  );

  // ---- 引数ヒント(SignatureHelp)-------------------------------------------
  context.subscriptions.push(
    vscode.languages.registerSignatureHelpProvider(
      SELECTOR, createSignatureProvider(state, shouldActivate), '(', ','
    )
  );

  // ---- ホバー ---------------------------------------------------------------
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      SELECTOR, createHoverProvider(state, shouldActivate)
    )
  );

  // ---- 構文チェック ---------------------------------------------------------
  const diag = createDiagnostics(cfg, shouldActivate);
  context.subscriptions.push(diag.collection);
  const runDiag = (doc) => { try { diag.run(doc); } catch (e) { /* noop */ } };
  if (vscode.window.activeTextEditor) runDiag(vscode.window.activeTextEditor.document);
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(runDiag),
    vscode.workspace.onDidChangeTextDocument(e => runDiag(e.document)),
    vscode.workspace.onDidSaveTextDocument(runDiag),
    vscode.workspace.onDidCloseTextDocument(d => diag.collection.delete(d.uri))
  );

  // ---- サイドバー -----------------------------------------------------------
  const versionView = new VersionTreeProvider(state);
  const infoView = new InfoTreeProvider(state);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('rtmVersionView', versionView),
    vscode.window.registerTreeDataProvider('rtmInfoView', infoView)
  );

  // ---- ステータスバー -------------------------------------------------------
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'rtmScript.toggleVersion';
  context.subscriptions.push(statusBar);
  function refreshAll() {
    const v = cfg().version;
    const api = indexFor(v);
    statusBar.text = '$(versions) RTM ' + v + (api.ok ? '' : ' (!)');
    statusBar.tooltip = 'RTM スクリプト補完バージョン: ' + v + '\nクリックで切替';
    statusBar.show();
    versionView.refresh();
    infoView.refresh();
    if (vscode.window.activeTextEditor) runDiag(vscode.window.activeTextEditor.document);
  }
  refreshAll();

  // ---- バージョン切替 -------------------------------------------------------
  async function setVersion(v) {
    if (!VERSIONS.includes(v)) return;
    // ワークスペースがあればワークスペース設定、無ければグローバル設定に保存
    const target = vscode.workspace.workspaceFolders
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    await vscode.workspace.getConfiguration('rtmScript').update('version', v, target);
    refreshAll();
    vscode.window.setStatusBarMessage('RTM バージョンを ' + v + ' に切替えました', 2500);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('rtmScript.setVersion1122', () => setVersion('1.12.2')),
    vscode.commands.registerCommand('rtmScript.setVersion1710', () => setVersion('1.7.10')),
    vscode.commands.registerCommand('rtmScript.selectVersionItem', (v) => setVersion(v)),
    vscode.commands.registerCommand('rtmScript.toggleVersion', () => {
      setVersion(cfg().version === '1.12.2' ? '1.7.10' : '1.12.2');
    })
  );

  // ---- スクリプト雛形の挿入 -------------------------------------------------
  async function insertTemplate(kind) {
    const tpl = TEMPLATES[kind];
    if (!tpl) return;
    let editor = vscode.window.activeTextEditor;
    // アクティブな JS が無ければ新規ファイルを作る
    if (!editor || editor.document.languageId !== 'javascript') {
      const doc = await vscode.workspace.openTextDocument({ language: 'javascript', content: tpl });
      await vscode.window.showTextDocument(doc);
      return;
    }
    await editor.edit(eb => eb.insert(editor.selection.active, tpl));
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('rtmScript.newRenderScript', () => insertTemplate('render')),
    vscode.commands.registerCommand('rtmScript.newServerScript', () => insertTemplate('server')),
    vscode.commands.registerCommand('rtmScript.newSoundScript', () => insertTemplate('sound'))
  );

  // ---- RTM 専用言語モード ---------------------------------------------------
  // 自動切替の対象は「中身が明らかに RTM」のものに限定(scriptsフォルダ名だけでは切替えない)。
  function contentLooksRtm(document) {
    const head = document.getText().slice(0, 4000);
    return /\bimportPackage\s*\(|\bPackages\.|\brenderer\b|registerParts\b|function\s+(onUpdate|render|init)\s*\(/.test(head);
  }
  const autoSwitched = new Set(); // 自動切替済みURI(戻した後に再切替しないため)
  async function maybeAutoSwitch(document) {
    if (!document || document.languageId !== 'javascript') return;
    if (!cfg().autoRtmLanguageMode) return;
    const key = document.uri.toString();
    if (autoSwitched.has(key)) return;
    if (!contentLooksRtm(document)) return;
    autoSwitched.add(key);
    try { await vscode.languages.setTextDocumentLanguage(document, 'rtmjs'); } catch (e) { /* noop */ }
  }
  // 起動時/開いた時/編集時に判定
  if (vscode.window.activeTextEditor) maybeAutoSwitch(vscode.window.activeTextEditor.document);
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(maybeAutoSwitch),
    vscode.window.onDidChangeActiveTextEditor(ed => { if (ed) maybeAutoSwitch(ed.document); })
  );

  async function setDocLanguage(lang) {
    const ed = vscode.window.activeTextEditor;
    if (!ed) return;
    try {
      await vscode.languages.setTextDocumentLanguage(ed.document, lang);
      if (lang === 'javascript') autoSwitched.add(ed.document.uri.toString()); // 戻したら自動切替しない
      else autoSwitched.delete(ed.document.uri.toString());
    } catch (e) { /* noop */ }
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('rtmScript.toRtmMode', () => setDocLanguage('rtmjs')),
    vscode.commands.registerCommand('rtmScript.toJsMode', () => setDocLanguage('javascript'))
  );

  // ---- API チートシートを開く -----------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('rtmScript.openCheatsheet', async () => {
      const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: CHEATSHEET });
      await vscode.window.showTextDocument(doc, { preview: true });
      try { await vscode.commands.executeCommand('markdown.showPreview'); } catch (e) { /* noop */ }
    })
  );

  // 設定変更に追従
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('rtmScript')) refreshAll();
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
