import { openExternal } from './tauri'

/** 项目仓库地址与外链打开（桌面壳走系统默认浏览器，浏览器走新标签页） */
export const REPO_URL = 'https://github.com/wosledon/Hetu'

export function openRepo(): void {
  openExternal(REPO_URL)
}
