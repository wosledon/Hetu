import { isTauri, openAppWebview } from './tauri'

/** 项目仓库地址与外链打开（桌面壳用内嵌网页窗口，浏览器走新标签页） */
export const REPO_URL = 'https://github.com/wosledon/Hetu'

export function openRepo(): void {
  // 桌面壳的 webview 会拦掉 window.open（表现为点了没反应）；
  // 复用应用页那套内嵌网页窗口，不需要改 Tauri 侧
  if (isTauri()) {
    void openAppWebview(REPO_URL, 'GitHub · Hetu')
    return
  }
  window.open(REPO_URL, '_blank', 'noopener')
}
