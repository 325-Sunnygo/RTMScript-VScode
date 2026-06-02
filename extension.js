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
      activateOnlyInRtmScripts: c.get('activateOnlyInRtmScripts', false),
    };
  }

  // 現在バージョンの状態オブジェクト(各モジュールへ渡す)
  const state = {
    versionName() { return cfg().version; },
    current() { return indexFor(cfg().version); },
  };

  // このドキュメントで RTM 支援を有効化するか。
  // 既定(activateOnlyInRtmScripts=true)では、普通の JavaScript 開発を妨げないよう
  // 「RTM らしいファイル」(中身・scripts フォルダ・RTM らしいファイル名)だけで有効化する。
  function shouldActivate(document) {
    if (!document || document.languageId !== 'javascript') return false;
    if (!cfg().activateOnlyInRtmScripts) return true;
    const fsPath = (document.uri && document.uri.fsPath) ? document.uri.fsPath : (document.fileName || '');
    return looksLikeRtmScript(document.getText(), fsPath);
  }

  // ---- 補完プロバイダ -------------------------------------------------------
  const provider = createProvider(state, shouldActivate);
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: 'javascript' },
      provider,
      '.', '(' // トリガー文字
    )
  );

  // ---- 引数ヒント(SignatureHelp)-------------------------------------------
  context.subscriptions.push(
    vscode.languages.registerSignatureHelpProvider(
      { language: 'javascript' },
      createSignatureProvider(state, shouldActivate),
      '(', ','
    )
  );

  // ---- ホバー ---------------------------------------------------------------
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      { language: 'javascript' },
      createHoverProvider(state, shouldActivate)
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
