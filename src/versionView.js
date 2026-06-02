'use strict';
/*
 * versionView.js
 * 左サイドバー(アクティビティバー)の TreeView。
 *  - rtmVersionView: 1.12.2 / 1.7.10 を選択(チェックマークで現在値を表示)
 *  - rtmInfoView   : 現在バージョンの統計情報
 */

const vscode = require('vscode');

const VERSIONS = ['1.12.2', '1.7.10'];

class VersionTreeProvider {
  constructor(state) {
    this.state = state;
    this._onDidChange = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChange.event;
  }
  refresh() { this._onDidChange.fire(); }
  getTreeItem(el) { return el; }
  getChildren() {
    const cur = this.state.versionName();
    return VERSIONS.map(v => {
      const active = v === cur;
      const item = new vscode.TreeItem(
        (active ? '● ' : '○ ') + 'RTM ' + v,
        vscode.TreeItemCollapsibleState.None
      );
      item.description = active ? '使用中' : '';
      item.tooltip = 'クリックで ' + v + ' に切替';
      item.iconPath = new vscode.ThemeIcon(active ? 'check' : 'circle-large-outline');
      item.command = {
        command: 'rtmScript.selectVersionItem',
        title: 'select',
        arguments: [v],
      };
      item.contextValue = 'rtmVersion';
      return item;
    });
  }
}

class InfoTreeProvider {
  constructor(state) {
    this.state = state;
    this._onDidChange = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChange.event;
  }
  refresh() { this._onDidChange.fire(); }
  getTreeItem(el) { return el; }
  getChildren() {
    const api = this.state.current();
    const rows = [];
    const push = (label, desc, icon) => {
      const it = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
      it.description = String(desc);
      if (icon) it.iconPath = new vscode.ThemeIcon(icon);
      rows.push(it);
    };
    if (!api || !api.ok) {
      push('データ未読込', api && api.error ? api.error : 'api-*.json なし', 'warning');
      return rows;
    }
    push('バージョン', this.state.versionName(), 'versions');
    push('クラス数', api.stats.classes, 'symbol-class');
    push('パッケージ数', api.stats.packages, 'symbol-namespace');
    push('難読メソッド', api.stats.obf, 'symbol-method');
    return rows;
  }
}

module.exports = { VersionTreeProvider, InfoTreeProvider, VERSIONS };
