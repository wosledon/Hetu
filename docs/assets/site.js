/* Hetu 站点脚本：主题、导航、搜索、目录、截图切换、版本与访问计数 */
(function () {
  'use strict';

  var root = document.documentElement;
  var THEME_KEY = 'hetu-site-theme';
  var lang = (root.lang || 'zh').toLowerCase().indexOf('en') === 0 ? 'en' : 'zh';
  var siteRoot = root.getAttribute('data-root') || '';
  var isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');
  var labels = lang === 'en'
    ? { themeDark: 'Switch to light theme', themeLight: 'Switch to dark theme', copied: 'Copied', copy: 'Copy code', toc: 'On this page', zoom: 'Open image' }
    : { themeDark: '切换到浅色主题', themeLight: '切换到深色主题', copied: '已复制', copy: '复制代码', toc: '本页目录', zoom: '查看大图' };

  /* ---------- theme ---------- */
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function storedTheme() {
    try { return window.localStorage.getItem(THEME_KEY); } catch (e) { return null; }
  }
  function systemTheme() {
    return media && media.matches ? 'dark' : 'light';
  }
  function updateThemeButtons(theme) {
    var buttons = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < buttons.length; i++) {
      var label = theme === 'dark' ? labels.themeDark : labels.themeLight;
      buttons[i].setAttribute('aria-label', label);
      buttons[i].setAttribute('title', label);
    }
  }
  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    updateThemeButtons(theme);
  }
  applyTheme(storedTheme() || systemTheme());
  if (media) {
    var onSystemTheme = function () {
      if (!storedTheme()) applyTheme(systemTheme());
    };
    if (media.addEventListener) media.addEventListener('change', onSystemTheme);
    else if (media.addListener) media.addListener(onSystemTheme);
  }

  /* ---------- search index ---------- */
  var DOCS = {
    zh: [
      { u: 'index.html', t: '文档索引', d: '学习路径、功能地图与深入实现目录', k: '文档 首页 导航 目录' },
      { u: 'getting-started.html', t: '快速开始', d: '安装、首次配置、数据目录', k: '安装 下载 启动 配置 模型 供应商 setup install' },
      { u: 'notes.html', t: '笔记', d: '双视图编辑、选区 AI 动作、版本、分享、导出', k: 'Markdown Milkdown 编辑器 标签 版本 分享 回收站 export' },
      { u: 'workspace.html', t: 'Agent 工作台', d: '会话与话题、权限模式、队列与运行中引导', k: '对话 chat 会话 话题 权限 审批 队列 SSE 引导' },
      { u: 'code-sessions.html', t: 'Code 会话', d: '工作树、分支、七个面板与 PR', k: '代码 编码 worktree 分支 git diff 终端 terminal PR 仓库' },
      { u: 'knowledge.html', t: '知识库', d: '分块、向量索引、覆盖率与语义搜索', k: 'RAG 向量 embedding sqlite-vec pgvector 索引 检索 search' },
      { u: 'graph-wiki.html', t: '知识图谱与 Wiki', d: '实体关系抽取、项目文档生成', k: '图谱 graph 实体 关系 wiki 文档生成' },
      { u: 'memories.html', t: '记忆与 Dream', d: '作用域、召回、巩固与遗忘', k: 'memory 长期记忆 召回 Dream 巩固 遗忘' },
      { u: 'organize.html', t: '看板与自动化', d: '任务看板、工作流、后台与定时任务', k: 'kanban 任务 工作流 workflow cron 定时 后台 inbox' },
      { u: 'whiteboard.html', t: '白板', d: '多张画板、形状/画笔/连接线绘图、导出与演示', k: '白板 whiteboard 画板 架构图 流程图 绘图 手绘 演示 导出 png svg 连接线' },
      { u: 'extensions.html', t: '扩展与集成', d: '智能体、技能、工具与 MCP', k: 'agent 智能体 技能 skill 工具 tool MCP server' },
      { u: 'models.html', t: '模型与用量', d: '供应商、场景默认、代理与成本', k: 'model provider OpenAI Anthropic 代理 proxy 成本 token 用量' },
      { u: 'foundry-local.html', t: '本地模型', d: '通过 Foundry Local CLI 在本地运行开源模型：安装、目录、下载、加载与接入 Hetu', k: 'foundry local cli 本地模型 phi qwen onnx winget 下载 加载 卸载 缓存路径 接入' },
      { u: 'theme.html', t: '主题与外观', d: '配色、画布背景与亚克力材质', k: 'theme 主题 配色 深色 浅色 外观 字体' },
      { u: 'desktop.html', t: '桌面应用', d: '安装包、自动更新、托盘与 sidecar', k: 'Tauri desktop 安装包 更新 托盘 sidecar fat slim' },
      { u: 'data.html', t: '数据与安全', d: '数据目录、备份、PostgreSQL 与隐私边界', k: '数据 备份 backup 迁移 postgresql sqlite 安全 隐私 key' },
      { u: 'architecture.html', t: '架构与实现', d: '分层、请求流、数据模型与性能实践', k: '架构 architecture API EF Core React 仓储 数据库' },
      { u: 'faq.html', t: '常见问题', d: '安装、索引、工作树、更新与排错', k: 'FAQ 问题 排错 错误 端口 vec0 链接' },
      { u: 'dev.html', t: '参与开发', d: '构建、验证、实现约定与发版', k: '开发 构建 build test eslint 发版 release 贡献' },
      { u: 'compression.html', t: '压缩管道', d: '节点顺序、摘要门槛与配置合并', k: '压缩 compression context token 摘要' },
      { u: 'agent-loop.html', t: 'Agent 循环', d: '六步顺序、迭代上限与引导注入', k: 'agent loop 工具调用 迭代 引导 循环' },
      { u: 'permissions.html', t: '权限与审批', d: '五档模式、三层判定与规则匹配', k: '权限 permission 审批 approval 规则 自动 bypass' },
      { u: 'context.html', t: '上下文与自动压缩', d: '占用算法、触发比例与摘要重试', k: '上下文 context 压缩 自动 窗口 摘要' },
      { u: 'sse.html', t: 'SSE 事件协议', d: '帧形态、事件清单与两条流差异', k: 'SSE stream 流式 事件 delta tool 协议' },
      { u: 'chunking.html', t: '分块与向量索引', d: '分块参数、虚表写入与维度解析', k: 'chunk 分块 向量 index 维度 sqlite-vec' },
      { u: 'retrieval.html', t: '语义检索', d: '两路召回、去重合并与消费方', k: '检索 retrieval recall rerank 语义 search' },
      { u: 'graph-extraction.html', t: '知识图谱抽取', d: 'JSON 契约、归一化与失败路径', k: '图谱 extraction 抽取 实体 关系 JSON' },
      { u: 'wiki-generation.html', t: 'Wiki 生成', d: '采集压缩、规划、并发续写', k: 'wiki 生成 文档 项目 并发 规划' },
      { u: 'memory-recall.html', t: '记忆写入与召回', d: '三条写入路径与打分公式', k: 'memory 记忆 召回 打分 作用域' },
      { u: 'dream.html', t: 'Dream 巩固', d: '聚类、合并、衰减与遗忘', k: 'dream 记忆 巩固 聚类 衰减' },
      { u: 'kanban.html', t: '任务看板与自动化', d: '状态机、触发点与评论回流', k: 'kanban 看板 任务 状态 自动 agent' },
      { u: 'workflows.html', t: '工作流引擎', d: '图校验、十种节点与人审回传', k: 'workflow 工作流 节点 图 审批' },
      { u: 'background-tasks.html', t: '后台与定时任务', d: '去重、巡检恢复与 Cron', k: '后台 task cron 定时 队列 任务' },
      { u: 'inbox.html', t: '收件箱与通知', d: '聚合、合并动作与状态语义', k: 'inbox 通知 notification 收件箱 未读' }
    ],
    en: [
      { u: 'index.html', t: 'Documentation', d: 'Learning path, feature map and deep-dive index', k: 'docs home navigation index' },
      { u: 'getting-started.html', t: 'Getting started', d: 'Install, first-run setup and data directory', k: 'install download setup provider model config' },
      { u: 'notes.html', t: 'Notes', d: 'Dual editors, selection AI actions, history, sharing, export', k: 'markdown editor milkdown tags version share trash' },
      { u: 'workspace.html', t: 'Agent workspace', d: 'Sessions and topics, permission modes, queue and steering', k: 'chat session topic permission approval queue SSE steering' },
      { u: 'code-sessions.html', t: 'Code sessions', d: 'Worktrees, branches, seven panels and pull requests', k: 'code worktree branch git diff terminal PR repository' },
      { u: 'knowledge.html', t: 'Knowledge base', d: 'Chunking, vector index, coverage and semantic search', k: 'RAG vector embedding sqlite-vec pgvector index search' },
      { u: 'graph-wiki.html', t: 'Graph & Wiki', d: 'Entity extraction and generated project documentation', k: 'graph entity relation wiki generation' },
      { u: 'memories.html', t: 'Memories & Dream', d: 'Scopes, recall, consolidation and forgetting', k: 'memory long-term recall dream consolidate forget' },
      { u: 'organize.html', t: 'Kanban & automation', d: 'Task board, workflows, background and scheduled jobs', k: 'kanban task workflow cron background inbox' },
      { u: 'whiteboard.html', t: 'Whiteboard', d: 'Multiple boards, shape/pen/connector drawing, export and presentation', k: 'whiteboard board architecture diagram flow draw pen present export png svg connector' },
      { u: 'extensions.html', t: 'Extensions & MCP', d: 'Agents, skills, tools and MCP servers', k: 'agent skill tool MCP server extension' },
      { u: 'models.html', t: 'Models & usage', d: 'Providers, per-scenario defaults, proxy and cost', k: 'model provider OpenAI Anthropic proxy cost token usage' },
      { u: 'foundry-local.html', t: 'Local models', d: 'Run open-source models locally via the Foundry Local CLI: install, catalog, download, load and wire into Hetu', k: 'foundry local cli winget phi qwen onnx download load unload cache path wire' },
      { u: 'theme.html', t: 'Theme & appearance', d: 'Palettes, canvas backgrounds and acrylic material', k: 'theme palette dark light appearance font' },
      { u: 'desktop.html', t: 'Desktop app', d: 'Installers, auto-update, tray and sidecar', k: 'tauri desktop installer update tray sidecar fat slim' },
      { u: 'data.html', t: 'Data & security', d: 'Data directory, backup, PostgreSQL and privacy', k: 'data backup migrate postgresql sqlite security privacy key' },
      { u: 'architecture.html', t: 'Architecture', d: 'Layers, request flow, data model and performance', k: 'architecture API EF Core React repository database' },
      { u: 'faq.html', t: 'FAQ', d: 'Install, indexing, worktrees, updates and troubleshooting', k: 'faq question troubleshoot error port vec0 link' },
      { u: 'dev.html', t: 'Development', d: 'Build, verify, conventions and release', k: 'development build test eslint release contribute' },
      { u: 'compression.html', t: 'Compression pipeline', d: 'Node order, summary thresholds and config merge', k: 'compression context token summary' },
      { u: 'agent-loop.html', t: 'Agent loop', d: 'Six-step run, iteration limits and steering', k: 'agent loop tool call iteration steering' },
      { u: 'permissions.html', t: 'Permission modes & approvals', d: 'Five modes, three-layer decision and matching', k: 'permission approval rule auto bypass' },
      { u: 'context.html', t: 'Context & auto compaction', d: 'Usage algorithm, trigger ratio and summary retry', k: 'context compaction window summary' },
      { u: 'sse.html', t: 'SSE event protocol', d: 'Frame shapes, event list and stream differences', k: 'SSE stream event delta tool protocol' },
      { u: 'chunking.html', t: 'Chunking & vector index', d: 'Chunk parameters, virtual table writes and dimensions', k: 'chunk vector index dimension sqlite-vec' },
      { u: 'retrieval.html', t: 'Semantic retrieval', d: 'Two recall paths, merge and consumers', k: 'retrieval recall rerank semantic search' },
      { u: 'graph-extraction.html', t: 'Knowledge graph extraction', d: 'JSON contract, normalization and failure paths', k: 'graph extraction entity relation JSON' },
      { u: 'wiki-generation.html', t: 'Wiki generation', d: 'Collection, planning and concurrent writing', k: 'wiki generation documentation project concurrency' },
      { u: 'memory-recall.html', t: 'Memory write & recall', d: 'Three write paths and the scoring formula', k: 'memory recall score scope' },
      { u: 'dream.html', t: 'Dream consolidation', d: 'Clustering, merging, decay and forgetting', k: 'dream memory consolidation cluster decay' },
      { u: 'kanban.html', t: 'Task board & automation', d: 'State machine, triggers and comment flow', k: 'kanban board task state automation agent' },
      { u: 'workflows.html', t: 'Workflow engine', d: 'Graph validation, ten node types and human review', k: 'workflow node graph approval' },
      { u: 'background-tasks.html', t: 'Background & scheduled tasks', d: 'Dedupe, recovery and Cron', k: 'background task cron schedule queue' },
      { u: 'inbox.html', t: 'Inbox & notifications', d: 'Aggregation, merge actions and state semantics', k: 'inbox notification unread' }
    ]
  };

  /* ---------- document helpers ---------- */
  function closest(node, selector) {
    return node && node.closest ? node.closest(selector) : null;
  }
  function lockScroll(locked) {
    document.body.style.overflow = locked ? 'hidden' : '';
  }

  /* ---------- theme / nav / copy / lightbox ---------- */
  var lastFocus = null;
  document.addEventListener('click', function (event) {
    var themeBtn = closest(event.target, '[data-theme-toggle]');
    if (themeBtn) {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      try { window.localStorage.setItem(THEME_KEY, next); } catch (e) { /* private mode */ }
      applyTheme(next);
      return;
    }

    var navBtn = closest(event.target, '[data-nav-toggle]');
    if (navBtn) {
      var nav = document.querySelector('.site-nav');
      if (nav) {
        var open = nav.getAttribute('data-open') === 'true';
        nav.setAttribute('data-open', open ? 'false' : 'true');
        navBtn.setAttribute('aria-expanded', open ? 'false' : 'true');
      }
      return;
    }

    var openNav = document.querySelector('.site-nav[data-open="true"]');
    if (openNav && !closest(event.target, '.site-header')) {
      openNav.setAttribute('data-open', 'false');
      var toggle = document.querySelector('[data-nav-toggle]');
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
    }

    var copyBtn = closest(event.target, '.code .copy');
    if (copyBtn) {
      var block = closest(copyBtn, '.code');
      var code = block && block.querySelector('code');
      if (!code) return;
      var text = code.innerText;
      var done = function () {
        copyBtn.setAttribute('data-copied', 'true');
        copyBtn.setAttribute('aria-label', labels.copied);
        window.setTimeout(function () {
          copyBtn.removeAttribute('data-copied');
          copyBtn.setAttribute('aria-label', labels.copy);
        }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, done);
      } else {
        var area = document.createElement('textarea');
        area.value = text;
        document.body.appendChild(area);
        area.select();
        try { document.execCommand('copy'); } catch (e) { /* ignore */ }
        document.body.removeChild(area);
        done();
      }
      return;
    }

    var shot = closest(event.target, '.frame img, .gallery img, .shot');
    var box = document.querySelector('[data-lightbox]');
    if (shot && box) {
      openLightbox(shot, box);
      return;
    }
    if (box && (closest(event.target, '[data-lightbox-close]') || event.target === box)) {
      closeLightbox(box);
    }
  });

  function openLightbox(shot, box) {
    var big = box.querySelector('img');
    var caption = box.querySelector('.lightbox-caption');
    lastFocus = document.activeElement;
    big.src = shot.getAttribute('src');
    big.alt = shot.getAttribute('alt') || '';
    if (caption) {
      var fig = closest(shot, 'figure');
      var cap = fig && fig.querySelector('figcaption');
      caption.textContent = cap ? cap.innerText : (shot.getAttribute('alt') || '');
    }
    box.setAttribute('data-open', 'true');
    box.setAttribute('aria-hidden', 'false');
    lockScroll(true);
    var close = box.querySelector('[data-lightbox-close]');
    if (close) close.focus();
  }
  function closeLightbox(box) {
    box.setAttribute('data-open', 'false');
    box.setAttribute('aria-hidden', 'true');
    lockScroll(false);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      var box = document.querySelector('[data-lightbox][data-open="true"]');
      if (box) { closeLightbox(box); return; }
      var openNav = document.querySelector('.site-nav[data-open="true"]');
      if (openNav) {
        openNav.setAttribute('data-open', 'false');
        var toggle = document.querySelector('[data-nav-toggle]');
        if (toggle) { toggle.setAttribute('aria-expanded', 'false'); toggle.focus(); }
      }
    }
    var target = event.target;
    if (!target || !target.matches) return;
    if (event.key === 'Enter' || event.key === ' ') {
      if (target.matches('img.shot[tabindex]')) {
        event.preventDefault();
        var box2 = document.querySelector('[data-lightbox]');
        if (box2) openLightbox(target, box2);
      }
    }
  });

  var shots = document.querySelectorAll('img.shot');
  for (var s = 0; s < shots.length; s++) {
    shots[s].setAttribute('tabindex', '0');
    shots[s].setAttribute('role', 'button');
    shots[s].setAttribute('aria-label', labels.zoom + ': ' + (shots[s].getAttribute('alt') || ''));
  }

  /* ---------- reading progress ---------- */
  var progress = document.querySelector('[data-progress]');
  function updateProgress() {
    if (!progress) return;
    var height = document.documentElement.scrollHeight - window.innerHeight;
    var ratio = height > 0 ? Math.min(1, Math.max(0, window.scrollY / height)) : 0;
    progress.style.transform = 'scaleX(' + ratio + ')';
  }

  /* ---------- docs toc ---------- */
  var toc = document.querySelector('[data-docs-toc]');
  var docsBody = document.querySelector('.docs-body');
  var tocLinks = [];
  var tocHeadings = [];
  if (toc && docsBody) {
    var used = Object.create(null);
    var headings = docsBody.querySelectorAll('h2, h3');
    var items = [];
    for (var h = 0; h < headings.length; h++) {
      var heading = headings[h];
      var base = (heading.textContent || '').trim().toLowerCase()
        .replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '') || ('section-' + h);
      var id = base;
      var n = 2;
      while (used[id]) { id = base + '-' + n; n++; }
      used[id] = true;
      heading.id = id;
      items.push({ id: id, text: heading.textContent.trim(), level: heading.tagName === 'H3' ? 3 : 2 });
    }
    if (items.length) {
      var html = '<p class="toc-label">' + labels.toc + '</p><ol>';
      for (var i = 0; i < items.length; i++) {
        html += '<li class="' + (items[i].level === 3 ? 'toc-h3' : 'toc-h2') + '"><a href="#' + items[i].id + '">' + escapeHtml(items[i].text) + '</a></li>';
      }
      toc.innerHTML = html + '</ol>';
      tocLinks = Array.prototype.slice.call(toc.querySelectorAll('a'));
      for (var j = 0; j < tocLinks.length; j++) {
        tocHeadings.push(document.getElementById(tocLinks[j].getAttribute('href').slice(1)));
      }
    }
  }
  function updateToc() {
    if (!tocLinks.length) return;
    var current = 0;
    for (var i = 0; i < tocHeadings.length; i++) {
      if (tocHeadings[i] && tocHeadings[i].getBoundingClientRect().top <= 130) current = i;
    }
    for (var j = 0; j < tocLinks.length; j++) {
      tocLinks[j].classList.toggle('is-active', j === current);
      if (j === current) tocLinks[j].setAttribute('aria-current', 'true');
      else tocLinks[j].removeAttribute('aria-current');
    }
  }

  /* ---------- mobile sidebar groups ---------- */
  var sideGroups = document.querySelectorAll('.side-group');
  var sidebarMedia = window.matchMedia ? window.matchMedia('(max-width: 900px)') : null;
  function syncSideGroups() {
    if (!sideGroups.length) return;
    var mobile = sidebarMedia && sidebarMedia.matches;
    if (!mobile) {
      for (var i = 0; i < sideGroups.length; i++) sideGroups[i].open = true;
      return;
    }
    var activeGroup = null;
    for (var j = 0; j < sideGroups.length; j++) {
      if (sideGroups[j].querySelector('[aria-current="page"]')) { activeGroup = sideGroups[j]; break; }
    }
    for (var k = 0; k < sideGroups.length; k++) sideGroups[k].open = sideGroups[k] === activeGroup;
    if (!activeGroup) sideGroups[0].open = true;
  }
  syncSideGroups();
  if (sidebarMedia && sidebarMedia.addEventListener) sidebarMedia.addEventListener('change', syncSideGroups);

  /* ---------- homepage showcase ---------- */
  var showcase = document.querySelector('[data-showcase]');
  if (showcase) {
    var tabs = Array.prototype.slice.call(showcase.querySelectorAll('[data-src]'));
    var image = showcase.querySelector('[data-showcase-img]');
    var title = showcase.querySelector('[data-showcase-title]');
    var desc = showcase.querySelector('[data-showcase-desc]');
    var count = showcase.querySelector('[data-showcase-count]');
    var current = 0;
    function shotId(tab) {
      var src = tab.getAttribute('data-src') || '';
      return src.split('/').pop().replace(/^\d+-/, '').replace(/\.png$/, '');
    }
    function selectTab(index, focus, skipUrl) {
      if (!tabs.length) return;
      current = (index + tabs.length) % tabs.length;
      for (var i = 0; i < tabs.length; i++) {
        var selected = i === current;
        tabs[i].setAttribute('aria-selected', selected ? 'true' : 'false');
        tabs[i].tabIndex = selected ? 0 : -1;
      }
      var tab = tabs[current];
      if (focus) tab.focus();
      if (title) title.textContent = tab.getAttribute('data-title') || tab.textContent.trim();
      if (desc) desc.textContent = tab.getAttribute('data-desc') || '';
      if (count) count.textContent = String(current + 1).padStart(2, '0') + ' / ' + String(tabs.length).padStart(2, '0');
      if (!skipUrl && window.history && history.replaceState) {
        var url = new URL(window.location.href);
        if (current === 0) url.searchParams.delete('shot');
        else url.searchParams.set('shot', shotId(tab));
        history.replaceState(null, '', url.pathname + (url.search || '') + url.hash);
      }
      var src = tab.getAttribute('data-src');
      if (image && src && image.getAttribute('src') !== src) {
        image.classList.add('is-loading');
        var preload = new Image();
        preload.onload = function () {
          image.src = src;
          image.classList.remove('is-loading');
        };
        preload.onerror = function () { image.classList.remove('is-loading'); };
        preload.src = src;
      }
    }
    var initialTab = 0;
    try {
      var requested = new URLSearchParams(window.location.search).get('shot');
      if (requested) {
        for (var t0 = 0; t0 < tabs.length; t0++) {
          if (shotId(tabs[t0]) === requested) { initialTab = t0; break; }
        }
      }
    } catch (e) { /* ignore malformed query */ }
    for (var t = 0; t < tabs.length; t++) {
      (function (index) {
        tabs[index].addEventListener('click', function () { selectTab(index, false); });
        tabs[index].addEventListener('keydown', function (event) {
          if (event.key === 'ArrowDown' || event.key === 'ArrowRight') { event.preventDefault(); selectTab(index + 1, true); }
          if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') { event.preventDefault(); selectTab(index - 1, true); }
          if (event.key === 'Home') { event.preventDefault(); selectTab(0, true); }
          if (event.key === 'End') { event.preventDefault(); selectTab(tabs.length - 1, true); }
        });
      })(t);
    }
    selectTab(initialTab, false, true);
  }

  /* ---------- search ---------- */
  var modal = document.querySelector('[data-search-modal]');
  var searchInput = modal && modal.querySelector('[data-search-input]');
  var resultsBox = modal && modal.querySelector('[data-search-results]');
  var searchStatus = modal && modal.querySelector('[data-search-status]');
  var activeResult = -1;
  var searchReturnFocus = null;
  var docs = DOCS[lang] || DOCS.zh;
  var baseUrl = siteRoot + (lang === 'en' ? 'en/guide/' : 'guide/');

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function scoreDoc(doc, query) {
    var title = doc.t.toLowerCase();
    var desc = doc.d.toLowerCase();
    var key = doc.k.toLowerCase();
    var score = 0;
    if (title === query) score += 120;
    else if (title.indexOf(query) === 0) score += 90;
    else if (title.indexOf(query) > -1) score += 65;
    if (key.indexOf(query) > -1) score += 32;
    if (desc.indexOf(query) > -1) score += 18;
    var parts = query.split(/\s+/);
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      if (title.indexOf(parts[i]) > -1) score += 12;
      if (key.indexOf(parts[i]) > -1) score += 6;
    }
    return score;
  }
  function renderResults(query) {
    if (!resultsBox) return;
    var q = (query || '').trim().toLowerCase();
    var list = docs.slice();
    if (q) {
      list = list.map(function (doc) { return { doc: doc, score: scoreDoc(doc, q) }; })
        .filter(function (entry) { return entry.score > 0; })
        .sort(function (a, b) { return b.score - a.score; })
        .slice(0, 8)
        .map(function (entry) { return entry.doc; });
    } else {
      list = list.slice(0, 6);
    }
    activeResult = list.length ? 0 : -1;
    if (!list.length) {
      resultsBox.innerHTML = '<div class="search-empty">' + (lang === 'en' ? 'No matching pages.' : '没有找到匹配的页面。') + '</div>';
      if (searchStatus) searchStatus.textContent = lang === 'en' ? 'No results' : '没有结果';
      return;
    }
    var html = '';
    for (var i = 0; i < list.length; i++) {
      html += '<a class="search-result' + (i === 0 ? ' is-active' : '') + '" href="' + baseUrl + list[i].u + '" data-search-index="' + i + '">'
        + '<b>' + escapeHtml(list[i].t) + '</b><span>' + escapeHtml(list[i].d) + '</span></a>';
    }
    resultsBox.innerHTML = html;
    if (searchStatus) searchStatus.textContent = (lang === 'en' ? list.length + ' results' : list.length + ' 个结果');
  }
  function searchItems() {
    return resultsBox ? Array.prototype.slice.call(resultsBox.querySelectorAll('.search-result')) : [];
  }
  function setActiveResult(index) {
    var items = searchItems();
    if (!items.length) return;
    activeResult = (index + items.length) % items.length;
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle('is-active', i === activeResult);
    }
    items[activeResult].scrollIntoView({ block: 'nearest' });
  }
  function openSearch() {
    if (!modal) return;
    searchReturnFocus = document.activeElement;
    modal.setAttribute('data-open', 'true');
    modal.setAttribute('aria-hidden', 'false');
    lockScroll(true);
    renderResults('');
    if (searchInput) {
      searchInput.value = '';
      window.setTimeout(function () { searchInput.focus(); }, 20);
    }
  }
  function closeSearch() {
    if (!modal) return;
    modal.setAttribute('data-open', 'false');
    modal.setAttribute('aria-hidden', 'true');
    lockScroll(false);
    if (searchReturnFocus && searchReturnFocus.focus) searchReturnFocus.focus();
  }
  document.addEventListener('click', function (event) {
    if (closest(event.target, '[data-search-open]')) { event.preventDefault(); openSearch(); return; }
    if (closest(event.target, '[data-search-close]') || event.target === modal) { closeSearch(); }
  });
  if (searchInput) {
    searchInput.addEventListener('input', function () { renderResults(searchInput.value); });
    searchInput.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowDown') { event.preventDefault(); setActiveResult(activeResult + 1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); setActiveResult(activeResult - 1); }
      else if (event.key === 'Enter') {
        var items = searchItems();
        if (items[activeResult]) { event.preventDefault(); window.location.href = items[activeResult].getAttribute('href'); }
      }
    });
  }
  if (resultsBox) {
    resultsBox.addEventListener('mousemove', function (event) {
      var item = closest(event.target, '.search-result');
      if (!item) return;
      setActiveResult(Number(item.getAttribute('data-search-index')));
    });
  }
  document.addEventListener('keydown', function (event) {
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((event.target && event.target.tagName) || '') || (event.target && event.target.isContentEditable);
    if (modal && modal.getAttribute('data-open') === 'true' && event.key === 'Tab') {
      var focusables = Array.prototype.slice.call(modal.querySelectorAll('input, button, a[href]'));
      if (focusables.length) {
        var first = focusables[0];
        var last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
    if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey)) {
      event.preventDefault(); openSearch(); return;
    }
    if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault(); openSearch(); return;
    }
    if (event.key === 'Escape' && modal && modal.getAttribute('data-open') === 'true') closeSearch();
  });
  var kbds = document.querySelectorAll('[data-search-kbd]');
  for (var k = 0; k < kbds.length; k++) kbds[k].textContent = isMac ? '⌘K' : 'Ctrl K';

  /* ---------- reveal ---------- */
  var revealNodes = document.querySelectorAll('[data-reveal]');
  if (revealNodes.length && 'IntersectionObserver' in window && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    for (var r = 0; r < revealNodes.length; r++) revealNodes[r].classList.add('reveal-ready');
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px' });
    for (var r2 = 0; r2 < revealNodes.length; r2++) observer.observe(revealNodes[r2]);
  }

  /* ---------- scroll ---------- */
  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(function () {
      updateProgress();
      updateToc();
      ticking = false;
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  onScroll();

  /* ---------- latest version ---------- */
  var versionTargets = document.querySelectorAll('[data-latest-version]');
  if (versionTargets.length) {
    fetch('https://api.github.com/repos/wosledon/Hetu/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (release) {
        if (!release || !release.tag_name) return;
        var tag = String(release.tag_name);
        for (var i = 0; i < versionTargets.length; i++) versionTargets[i].textContent = tag;
      })
      .catch(function () { /* keep static fallback */ });
  }

  /* ---------- visit counter ---------- */
  var counter = document.querySelector('[data-visit-counter]');
  if (counter) {
    var host = window.location.hostname;
    var offline = !host || host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || window.location.protocol === 'file:';
    var api = 'https://abacus.jasoncameron.dev/';
    var scope = 'hetu-docs/';
    var visitorFlag = 'hetu.docs.visitor.v1';

    function readCount(key) {
      return fetch(api + 'get/' + scope + key, { cache: 'no-store' })
        .then(function (response) { return response.ok ? response.json() : null; })
        .then(function (data) { return data && typeof data.value === 'number' ? data.value : null; })
        .catch(function () { return null; });
    }
    function bumpCount(key) {
      return fetch(api + 'hit/' + scope + key, { cache: 'no-store' })
        .then(function (response) { return response.ok ? response.json() : null; })
        .then(function (data) { return data && typeof data.value === 'number' ? data.value : null; })
        .catch(function () { return null; });
    }
    if (!offline) {
      var seenVisitor = false;
      try { seenVisitor = window.localStorage.getItem(visitorFlag) === '1'; } catch (e) { /* ignore */ }
      var visitorsJob;
      if (seenVisitor) {
        visitorsJob = readCount('visitors');
      } else {
        visitorsJob = bumpCount('visitors').then(function (value) {
          if (typeof value === 'number') {
            try { window.localStorage.setItem(visitorFlag, '1'); } catch (e) { /* ignore */ }
          }
          return value;
        });
      }
      var viewsJob = bumpCount('views');

      function show(selector, segment, value) {
        var node = counter.querySelector(selector);
        var box = counter.querySelector('[data-visit-segment="' + segment + '"]');
        if (!node || !box || typeof value !== 'number') return false;
        node.textContent = value.toLocaleString();
        box.removeAttribute('hidden');
        return true;
      }
      Promise.all([visitorsJob, viewsJob]).then(function (values) {
        var showedVisitors = show('[data-visit-visitors]', 'visitors', values[0]);
        var showedViews = show('[data-visit-views]', 'views', values[1]);
        if (showedVisitors && showedViews) counter.querySelector('[data-visit-sep]').removeAttribute('hidden');
      });
    }
  }
})();
