/**
 * Lightweight i18n facade.
 *
 * `t(key, params)` looks up the key in the `zh` dictionary and interpolates
 * `{param}` placeholders. Falls back to the key itself when missing.
 *
 * To add a new locale, duplicate `zh` under a new locale code and swap the
 * active dictionary at startup.
 */

const zh: Record<string, string> = {
  // ── App.tsx ──────────────────────────────────────────────────────────────
  'app.pickDir':              '选择磁盘或文件夹',
  'app.scanning':             '扫描中…',
  'app.scan':                 '扫描',
  'app.cancelScan':           '取消',
  'app.cancelScanTitle':      '取消扫描',
  'app.notScanned':           '未扫描',
  'app.files':                '文件',
  'app.settingsBound':        '已绑定 {provider} · 点开管理',
  'app.settingsUnbound':      'AI 还没配置 · 点开设置',
  'app.settingsLabel':        '设置',
  'app.currentProvider':      '当前 AI 提供商',
  'app.preparing':            '准备扫描…',
  'app.scanProgress':         '{files} 个文件 · {size}{total}{eta}',
  'app.remainingMin':         ' · 剩余 {n} 分',
  'app.remainingSec':         ' · 剩余 {n}s',
  'app.version':              'Pinkbin v{version} · {n} 个清理脚本',
  'app.noScan':               '还没扫描',
  'app.emptyTitle':           '还没扫描',
  'app.emptyHint':            '在顶栏选一个文件夹，然后点「扫描」。\n扫完之后，左侧会列出每个文件夹和文件。',
  'app.browserPrompt':        '浏览器预览模式：输入一个路径（任意值都可以）',

  // ── Settings.tsx ─────────────────────────────────────────────────────────
  'settings.title':           'AI 顾问设置',
  'settings.hint':            '填你服务商给你的 Base URL、API Key 和模型名。先选协议再填地址，省得猜错。',
  'settings.protocol':        '协议 · Provider',
  'settings.openai':          'OpenAI',
  'settings.anthropic':       'Anthropic',
  'settings.gemini':          'Gemini',
  'settings.ollama':          'Ollama（本地）',
  'settings.suggested':       '我们猜你是 {provider} — 如果不对，点上面切换。',
  'settings.baseUrl':         'Base URL',
  'settings.apiKey':          'API Key（只存本机，永不上传）',
  'settings.hide':            '隐藏',
  'settings.show':            '显示',
  'settings.model':           'Model · 模型名',
  'settings.advanced':        '高级设置',
  'settings.advanced.open':   '▸ 高级设置',
  'settings.advanced.close':  '▾ 高级设置',
  'settings.temperature':     'Temperature（创造性 0–2）',
  'settings.maxTokens':       'Max Tokens（回复长度上限）',
  'settings.streaming':       'Streaming（逐字输出）',
  'settings.streamOn':        '开启',
  'settings.streamOff':       '关闭（一次性返回）',
  'settings.promptOverride':  'System Prompt Override（留空用默认）',
  'settings.promptPlaceholder': '留空 = 使用内置 prompt',
  'settings.resetDefault':    '恢复默认',
  'settings.clear':           '清除',
  'settings.save':            '保存',
  'settings.close':           '关闭',
  'settings.privacy':         'Pinkbin 只把目录元数据发给 AI（路径、大小、文件数、扩展名分布、抽样路径），{strong}不会{/strong}读取或上传文件内容。',
  'settings.err.baseUrl':     '请填 Base URL',
  'settings.err.model':       '请填 Model 名',
  'settings.err.apiKey':      '请填 API Key',
  'settings.saved':           '已保存 · key 只存在你本机系统钥匙串 (Credential Manager / Keychain / libsecret)',
  'settings.wiped':           '已清除本地保存的配置和钥匙串里的 key',

  // ── ChatPanel.tsx ────────────────────────────────────────────────────────
  'chat.title':               'Pinkbin AI',
  'chat.noConfig':            'AI 还没配置 — 点右上角 {strong}⚙️ 设置{/strong} 填一个 API Key 和模型名，或接本地 Ollama（不用 Key）。',
  'chat.hint':                '选一个磁盘 → 点扫描 → AI 自动给整体解析。\n扫完之后，可以把左边的任意文件 / 文件夹拖进来问。',
  'chat.browserHint':         '浏览器预览模式：扫描数据是模拟的，但 AI 会走真实接口。',
  'chat.generating':          'AI 正在生成整体解析…',
  'chat.typing':              'AI 正在打字…',
  'chat.scrollBottom':        '↓ 新消息',
  'chat.placeholder.scan':    '问 AI：这是什么？能删吗？把文件 / 图片拖进来…（图片粘贴也行）',
  'chat.placeholder.ready':   '先选一个磁盘开始扫描，或贴张图片直接问',
  'chat.placeholder.config':  '先去右上角 ⚙️ 设置配 AI',
  'chat.send':                '发送',
  'chat.recycle':             '回收 {size}',
  'chat.fallback':            '演示数据 / 不可信',
  'chat.risk':                '风险 {risk}',
  'chat.needsInspect':        '需要再看看',
  'chat.clearTitle':          '清空',
  'chat.clearLabel':          '清空对话',
  'chat.dropHint':            '先去设置里配 AI',
  'chat.attachTitle':         '加图片（也可以粘贴/拖进来）',
  'chat.attachLabel':         '添加图片',

  // ── Studio.tsx ───────────────────────────────────────────────────────────
  'studio.hidden':            '已隐藏（pinkbin.hideStudio=1）',
  'studio.scripts':           '{n} 个脚本',
  'studio.undo.recycle':      '打开回收站还原 · {reason}',
  'studio.undo.quarantine':   '文件已移入 quarantine · {reason}',
  'studio.undo.delete':       '文件已永久删除 · {reason}',
  'studio.undo':              '撤销 · {label}',
  'studio.pruneTitle':        '清理超过 7 天的 quarantine 文件',
  'studio.pruneRunning':      '清理中…',
  'studio.pruneIdle':         '清空 quarantine',
  'studio.loading':           '脚本加载中…',
  'studio.featured':          '推荐',
  'studio.more':              '更多',
  'studio.steam.name':        'Steam Inspector',
  'studio.steam.blurb':       '哪些游戏好久没玩 · 一键唤起 Steam 卸载',
  'studio.positions':         '{n} 个位置',
  'studio.notDetected':       '未扫到 · 用脚本默认路径',
  'studio.path':              '路径',
  'studio.size':              '大小',
  'studio.sizeDetail':        '{size} · {files} 文件',
  'studio.sizeCombined':      '（{n} 处合计）',
  'studio.topChildren':       '占用最大的子项',
  'studio.collapse':          '收起',
  'studio.expandAll':         '展开全部（还有 {n}）',
  'studio.configureClean':    '配置清理…',
  'studio.emptyDir':          '空目录',
  'studio.askAI':             '问 AI',
  'studio.defaultPaths':      '脚本默认匹配路径',
  'studio.description':       '说明',
  'studio.askAIHint':         '问 AI：它一般在哪、能不能删',
  'studio.emptyDirTitle':     '目录为空，无需清理',
  'studio.dragHint':          '拖到中间问 AI · 右键查看选项',
  'studio.ctxOpen':           '在文件管理器中打开',
  'studio.ctxCopy':           '复制路径',
  'studio.loadingModal':      '加载中…',
  'studio.cardRenderFail':    '{name} 卡片渲染失败',
  'studio.steamCardFail':     'Steam Inspector 卡片渲染失败',

  // ── TreeView.tsx ─────────────────────────────────────────────────────────
  'tree.folder':              '文件夹',
  'tree.parentPct':           '父级 %',
  'tree.size':                '大小',
  'tree.items':               '项目',
  'tree.truncated':           '… 还有 {hidden} 个未显示（Pinkbin 限制每层 {limit} 项）',
  'tree.ctxOpen':             '在文件管理器中打开',
  'tree.ctxCopy':             '复制路径',
  'tree.ctxHint':             '右键查看选项',

  // ── SteamInspector.tsx ───────────────────────────────────────────────────
  'steam.scanning':           '正在扫描 Steam 库…',
  'steam.teach':              '扫描到 {count} 款游戏，共 {size}。建议从「沉睡分」排序看推荐处理。',
  'steam.close':              '关闭',
  'steam.error':              '扫描出错：{error}',
  'steam.libraryRoot':        '库根',
  'steam.games':              '{n} 款',
  'steam透视':                '透视',
  'steam.sleep':              '推荐顺序',
  'steam.bySize':             '按占用大小',
  'steam.byLibrary':          '按所在硬盘',
  'steam.byLastPlayed':       '按最近玩过',
  'steam.total':              '共 {count} 款 · {size}',
  'steam.rescan':             '重新扫描',
  'steam.rescanTitle':        '重新扫描 (R)',
  'steam.search':             '搜索游戏名… (按 /)',
  'steam.clear':              '清除',
  'steam.noMatch':            '没有匹配的游戏。',
  'steam.ghost':              '检测到鬼魂安装',
  'steam.ghostDesc':          'ACF 元数据存在但安装目录已缺失或不完整。建议在 Steam 中右键卸载，或属性 → 已安装文件 → 验证完整性。Inspector 不替你清 ACF。',
  'steam.appid':              'appid',
  'steam.steamSize':          '大小',
  'steam.lastPlayed':         '上次启动',
  'steam.library':            '库根',
  'steam.status':             '状态',
  'steam.complete':           '完整',
  'steam.incomplete':         '不完整（StateFlags={n}）',
  'steam.recommend':          '建议处理',
  'steam.uninstall':          '在 Steam 中卸载',
  'steam.uninstallTitle':     '唤起 Steam 卸载 (U)',
  'steam.workshop':           '查看创意工坊（{n} 项）',
  'steam.notFound':           '未检测到 Steam',
  'steam.notFoundDesc':       '我们查过了下面这些路径和 Windows 注册表（HKCU\\Software\\Valve\\Steam），都没有找到 Steam 安装：',
  'steam.notFoundHint':       '如果你的 Steam 装在其他位置，手动指定路径功能会在后续版本支持（已登记到设计文档 §11）。先确认 Steam 装好且至少打开过一次（Steam 写注册表是登录后的行为），再点重新扫描。',
  'steam.rescanBtn':          '重新扫描',
  'steam.empty':              'Steam 找到了，但没游戏',
  'steam.emptyDesc':          'Steam 安装在 {root}，但 steamapps/ 下没有 appmanifest_*.acf 文件。可能 Steam 是裸装、没装游戏，或者库都迁到了别的盘但 libraryfolders.vdf 没更新。',
  'steam.toast.openFail':     '打不开：{error}',
  'steam.toast.uninstalling': '正在唤起 Steam 卸载对话框…',
  'steam.toast.steamHint':    '如果 Steam 没弹出来，请确认 Steam 客户端正在运行',
  'steam.toast.uninstallFail':'唤起 Steam 失败：{error}',
  'steam.sources':            'Sources',
  'steam.manifestTitle':      '在 Explorer 中定位 ACF 文件',

  // ── SteamWorkshopModal.tsx ───────────────────────────────────────────────
  'workshop.title':           '创意工坊 · {name}',
  'workshop.stats':           '共 {count} 项 · {size}',
  'workshop.statsLoading':    '正在统计每个项目的大小和修改时间…',
  'workshop.close':           '关闭 (Esc)',
  'workshop.sort':            '排序',
  'workshop.sortOldest':      '按最久没更新',
  'workshop.sortSize':        '按占用大小',
  'workshop.scanning':        '正在扫描 {n} 项创意工坊…',
  'workshop.error':           '扫描失败：{error}',
  'workshop.empty':           '没有找到创意工坊内容。可能 Steam 把它们放在别的地方，或者订阅都已经取消。',
  'workshop.caveat':          'ⓘ "上次更新"是 Steam 上次同步这个内容的时间——Steam 没有记录每个工坊项的实际启动次数，但更新时间通常能近似判断"在不在用"。',
  'workshop.fetchingTitles':  '正在从 Steam 获取游戏名称…',
  'workshop.titleError':      '未能从 Steam 获取游戏名称（如果在国内可挂代理后重试）',
  'workshop.retryTitle':      '重新请求 Steam Web API',
  'workshop.openInSteam':     '在 Steam 中打开',
  'workshop.openTitle':       '在 Steam 客户端中打开这个工坊页面',

  // ── CleanupModal/index.tsx ───────────────────────────────────────────────
  'cleanup.title':            '清理 · {name}',
  'cleanup.folderTotal':      '📦 文件夹总计',
  'cleanup.inScope':          '🧹 清理脚本覆盖',
  'cleanup.redLine':          '🔒 红线保护（聊天记录·收藏·账号·加密物料 — 永远不动）',
  'cleanup.media':            '接收的媒体',
  'cleanup.cache':            '缓存与临时数据',
  'cleanup.backup':           '聊天备份',
  'cleanup.summary':          '共 {count} 项 · {size} · 进系统回收站可还原',
  'cleanup.selectHint':       '勾选要清理的项目',
  'cleanup.stop':             '停止清理',
  'cleanup.cancel':           '取消',
  'cleanup.previewing':       '预览中…',
  'cleanup.cleaning':         '清理中…',
  'cleanup.armHint':          '⚠ 再点一次开预览 ({n}s)',
  'cleanup.previewBtn':       '预览将清理的文件',
  'cleanup.armTitle':         '点一次确认，再点一次预览实际会删的文件',
  'cleanup.armCountdown':     '{n} 秒内再点一次预览',
  'cleanup.err.noEnvs':       '没有勾选任何 environment',
  'cleanup.err.noScopes':     '没有勾选任何要清理的 scope',
  'cleanup.err.emptyPreview': '预览结果为空 · 没有可清理的文件（可能都在保留期内）',
  'cleanup.err.previewFail':  '预览失败：{error}',
  'cleanup.err.cleanFail':    '清理失败：{error}',
  'cleanup.err.readEnvFail':  '读取 conda env 失败：{error}',
  'cleanup.cleaned':          '已清理 {count} 个文件 · 约 {size} · 进了系统回收站',
  'cleanup.close':            '关闭',

  // ── CleanupModal/ScopeGroup.tsx ──────────────────────────────────────────
  'cleanup.selectAll':        '全选',
  'cleanup.selectNone':       '全不选',
  'cleanup.scanning':         '扫描中…',
  'cleanup.empty':            '空',
  'cleanup.allWithinRetention': '共 {total} · {files} 文件 · 全部在保留期内（不会清）',
  'cleanup.scopeMeta':        '共 {total}{files} · 待清 {bytes}{fileCount}{kept}',
  'cleanup.retain':           '保留最近',
  'cleanup.days':             '天',

  // ── CleanupModal/DryRunPreviewDialog.tsx ─────────────────────────────────
  'preview.title':            '预览：将删除以下文件',
  'preview.summary':          '{count} 个文件 · 共 {size}',
  'preview.recycleHint':      '进系统回收站，可右键还原',
  'preview.more':             '… 还有 {n} 个未列出',
  'preview.disclaimer':       '仔细看一眼上面的路径，确认没有你想留的东西。回收站默认 30 天后自动清空。',
  'preview.armHint':          '⚠ {n} 秒内再点一次真删',
  'preview.armIdle':          '点确认进入预备状态，再点一次才真删',
  'preview.back':             '返回',
  'preview.armBtn':           '⚠ 再点真删 ({n}s)',
  'preview.deleting':         '清理中…',
  'preview.confirm':          '确认删除',

  // ── CleanupModal/WxidFilter.tsx ──────────────────────────────────────────
  'wxid.account':             '账号',
  'wxid.hint':                '只清勾选账号下的文件 · 跨账号目录不受影响',

  // ── CleanupModal/CondaPicker.tsx ─────────────────────────────────────────
  'conda.readFail':           '读取失败',
  'conda.baseNoClean':        'base · 不可清',
  'conda.stale90':            ' · 90 天没动过',
  'conda.noUserEnvs':         '没有用户 environment（envs/ 为空）',

  // ── ProgressButton.tsx ───────────────────────────────────────────────────
  'progress.fail':            '失败',

  // ── DiagnosticsBar.tsx ───────────────────────────────────────────────────
  'diag.label':               '诊断',
  'diag.title':               '扫描各阶段耗时 — localStorage 开关：pinkbin.hideStudio',

  // ── ErrorBoundary.tsx ────────────────────────────────────────────────────
  'error.renderFail':         '组件渲染失败',
  'error.reset':              '重置该面板',

  // ── SteamInspectorModal.tsx ──────────────────────────────────────────────
  'steamModal.desc':          '查看你的 Steam 库 · 哪些游戏占地大、好久没玩',
};

// Active locale — swap this to switch languages at runtime.
let active: Record<string, string> = zh;

/**
 * Look up a translation key. Interpolates `{param}` placeholders from `params`.
 * Returns the key itself when no translation is found.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  let s = active[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return s;
}

/** Expose the raw dictionary for tooling / extraction scripts. */
export const messages = zh;