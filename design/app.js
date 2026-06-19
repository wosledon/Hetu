// 设置页面切换逻辑
function showSettings(settingsId) {
    // 隐藏所有设置面板
    const panels = ['app', 'ai', 'mcp', 'skill', 'prompt', 'database', 'trash'];
    panels.forEach(id => {
        const panel = document.getElementById('settings-' + id);
        if (panel) {
            panel.classList.add('hidden');
        }
    });
    
    // 显示选中的设置面板
    const selectedPanel = document.getElementById('settings-' + settingsId);
    if (selectedPanel) {
        selectedPanel.classList.remove('hidden');
    }
    
    // 更新左侧菜单激活状态
    const menuBtns = document.querySelectorAll('.settings-menu-btn');
    menuBtns.forEach(btn => {
        btn.classList.remove('bg-blue-50', 'text-blue-700', 'font-medium');
        btn.classList.add('text-gray-600');
    });
    
    event.target.closest('button').classList.remove('text-gray-600');
    event.target.closest('button').classList.add('bg-blue-50', 'text-blue-700', 'font-medium');
}

// 页面初始化
document.addEventListener('DOMContentLoaded', function() {
    // 可以在这里添加页面加载后的初始化逻辑
    console.log('Hetu 页面已加载');
});
