/**
 * 把滚动容器直接滚到底部。
 *
 * 不用 Element.scrollIntoView：它会连带滚动所有可滚动的祖先，而页面根节点是
 * overflow:hidden——只要有内容溢出（流式预览、抽屉、绝对定位浮层），根节点就变成
 * 可编程滚动的区域，对话期间每个流式分片调用一次就会把整页一起滚走（输入框被顶走、
 * 页面上下跳）。这里只写容器自身的 scrollTop，绝不碰祖先，也不会触发平滑动画重启。
 */
export function scrollToBottom(container: HTMLElement | null): void {
  if (container) container.scrollTop = container.scrollHeight
}
