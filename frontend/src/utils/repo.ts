/** 项目仓库地址与外链打开（桌面壳由 opener 插件接管 window.open，浏览器走新标签页） */
export const REPO_URL = 'https://github.com/wosledon/Hetu'

export function openRepo() {
  window.open(REPO_URL, '_blank', 'noopener')
}
