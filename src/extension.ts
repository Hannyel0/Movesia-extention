import * as vscode from 'vscode'
import { NextWebviewPanel } from './NextWebview'

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('NextWebview1.start', async () => {
      await NextWebviewPanel.getInstance({
        extensionUri: context.extensionUri,
        route: 'chatView',
        title: 'Movesia AI Chat',
        viewId: 'movesiaChat',
      })
    }),
    vscode.commands.registerCommand('NextWebview2.start', async () => {
      await NextWebviewPanel.getInstance({
        extensionUri: context.extensionUri,
        route: 'view2',
        title: 'GitHub Next Webview 2',
        viewId: 'ghnextB',
      })
    })
  )
}
