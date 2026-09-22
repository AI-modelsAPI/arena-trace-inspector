# 交接文档（HANDOFF）

> 给下一位协作者（人或 AI）：本文档是你接手本仓库的入口。先读「快速开始」，再按「架构地图」对号入座。
> 姊妹项目（Android 移植版）：https://github.com/AI-modelsAPI/arena-trace-android

---

## 1. 这个项目是什么

Chrome MV3 扩展，运行在 `https://arena.ai/*`。核心能力：

1. **识别模型**： Arena 对战页不告诉你实际调用的模型。扩展通过 会话流 SSE → 运行令牌 → Trigger.dev trace 三层链路，读出服务端真实的模型标签（如 `claude-fable-5.1`、`gpt-6-astra`），以页面浮层（HUD）和弹窗展示，并保存本地历史。
2. **自动化探测**：自动抽卡 / 自动探针——自动新建对话、发送随机算式（`1+1=` 这类）、读回模型名、按目标命中规则改名（`模型名-NNN` 后缀）、清理未命中残留。
3. **额度监控**：读取 `https://arena.ai/api/me/pulse`（返回 `{"pulse":99,"refreshedAt":"…"}`），显示剩余百分比 + 进度条（<20% 黄、<10% 红）+ 重置倒计时（秒级跳动）。

## 2. 快速开始

```bash
# 零依赖：没有 npm 依赖，不需要 install
npm test          # node:test 单测，当前 127 个用例，全部应在 5 秒内通过
node --check hud.js   # 单文件语法检查
```

加载扩展：`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选本目录。
**每次改完代码必须**：① 在 `chrome://extensions` 点「重新加载」；② 刷新 arena.ai 页面（content script 只在页面加载时注入，光重载扩展不刷新页面，浮层还是旧代码）。

没有打包步骤：扩展直接从源码目录加载。

## 3. 架构地图

### 三层 UI

| 层 | 文件 | 说明 |
|---|---|---|
| 页面浮层（HUD） | `hud.js` | content script，closed Shadow DOM 注入，可拖拽/收起；收起时吸附页面右缘、只露 36px 边条、悬停滑出 |
| 共享面板 | `panel.js` + `view-model.js` | HUD 展开区和弹窗详情区共用同一渲染器；**所有外部值用 `textContent`，禁止 innerHTML** |
| 扩展弹窗 | `popup.html` / `popup.css` / `popup.js` | 监听开关、历史会话列表、额度胶囊 |

### 后台（service worker）

| 文件 | 职责 |
|---|---|
| `background.js` | 消息路由（`ATI_*`）、调试器捕获会话流、trace 轮询、额度缓存/退避、状态发布（`ATI_STATE` / `ATI_PULSE` 推送） |
| `core.js` | 纯函数：令牌校验（`validateToken`）、trace 模型提取（`extractModels`）、探针目标匹配（`matchTargets` 系列） |
| `usage.js` / `evidence.js` | Token/费用标签解析与证据保留（只展示捕获到的原始标签，不推算价格） |
| `history.js` / `restore.js` | 本地会话记录存取（`chrome.storage.local`）、历史视图恢复 |
| `hud-preferences.js` / `hud-layout.js` | HUD 位置/收起状态/探针目标/findAll 的持久化（`ati.ui.hud.v1`），含白名单 sanitize |

### 页面层捕获（双通道）

| 文件 | 说明 |
|---|---|
| `snoop.js` | **MAIN world** 注入：劫持 `window.fetch` / `EventSource`，从会话流 SSE 里只抠 `public-access-token`，不碰对话正文 |
| `snoop-bridge.js` | 隔离世界 ↔ 页面世界的 `postMessage` 桥，转发令牌给 background |

主通道是 `chrome.debugger`（CDP Network 域）读 SSE；snoop 是并行备用通道。两条通道产出的令牌都经 `validateToken` 严格校验后才用于拉 trace。

### 自动化

| 文件 | 职责 |
|---|---|
| `auto-draw.js` | 抽卡/探针主流程：开监听 → 新建对话 → 填算式 → 发送 → `ArenaAcquire.waitForModel` → 命中判定 → 改名。含草稿保护（`noDraft`）、页面闪烁宽限 |
| `acquire.js` | 模型名获取轮询；**`isCurrent` 连续 2.5 秒失配才中止**（SPA 路由闪烁宽限），中止信息带原因 |
| `conversation-rename.js` | 通过 Arena 页面 UI 完成改名/归档，全程 isCurrent 守卫 |

探针目标/找齐全部勾选存在 HUD 偏好里（`hud-layout.js` 的 `probeTargets`/`findAll` 字段），没有独立模块。

### 额度

| 文件 | 职责 |
|---|---|
| `pulse.js` | 纯函数解析 `/api/me/pulse`（`parse` 自适应多种字段名；`format` 输出 `剩余额度 99% · 12:04:33 后重置`；`remaining`/`level` 驱动进度条三色） |
| `background.js getPulse()` | 60 秒共享缓存 + 并发去重（`pulseInflight`）+ 429 按 `Retry-After` 退避（默认 2 分钟）；`chrome.cookies.onChanged` 检测切账号 → 立即刷新并推送 `ATI_PULSE` |

## 4. 已完成功能清单（截至 1.4.0+）

近期迭代（最新在前）：

1. **探针命中改名加后缀**：`<完整模型名>-NNN`，同模型独立计数（001、002…），计数存 arena.ai 站点的 `localStorage`（`ati.probe.counters`），跨任务累计；抽卡模式不加后缀
2. **额度进度条**：HUD 收起态/展开态 + 弹窗三处；剩余 <20% 黄、<10% 红；重置倒计时 `H:MM:SS` 每秒跳动（1s 定时器只刷显示，接口仍 60s 一次）
3. **429 加固**：后台请求并发去重 + `Retry-After` 冷却；切账号（cookie 变化）即时失效缓存并主动推送
4. **HUD 收起自动隐藏**：贴右缘、露 36px 边条、悬停/聚焦滑出；`host` 设 `pointer-events:none` 防隐形区域挡点击（**这个坑别再踩**：transform 只移视觉，不位移交事件）
5. **清理残留加固**：侧栏是虚拟列表，清理前滚动加载全部对话；失败重试一次；结束后复查并报剩余数
6. **探针误判修复**：空输入框的零宽字符/占位符 DOM/无关栏位不再触发「输入框有未发送内容」；`composer()` 按特征打分选真正的聊天框；报错附现场快照
7. **亮色主题**：全部 UI（HUD/面板/弹窗）浅色化，基础字号 13→15px
8. **findAll（找齐全部）默认勾选**：`hud-layout.js` 默认值改为 true；`loadPrefs` 会把已保存的探针目标/勾选回填到控件

更早的基础能力：模型识别 HUD、本地历史、证据导出、会话改名/归档、自动改名开关、自动抽卡/探针。详见 README.md。

## 5. 设计红线（改动时务必遵守）

- **不猜数据**：只展示捕获到的原始标签（trace 里的模型名/Token/费用），不推算价格、不按文风猜模型、不生成置信度。额度解析识别不了就显示「格式未识别」并列出字段名
- **不动用户数据**：`noDraft` 保护输入框草稿；归档≠删除；清理只碰纯算式标题的对话，且跳过当前打开的对话
- **不泄露**：令牌不进日志/本地记录/通知文本；`sanitize` 白名单过滤持久化字段；证据导出脱敏
- **页面安全**：浮层用 closed Shadow DOM；外部值一律 `textContent`
- **自动化安全**：抽卡/探针需监听开启；发送前多重守卫（页面、模式、草稿、监听状态）；连续失败 3 次自动停止；不重发已发送的对话

## 6. 测试基建

`tests/` 下全是 `node:test` + `node:vm` 的零依赖单测，直接在 Node 里跑：

- `hud-dom-fixture.mjs`：极简 DOM 假人（classList/querySelector/shadowRoot 都是模拟的），把 `hud.js` 跑在 vm sandbox 里。改 HUD 逻辑时大部分测试靠它
- `auto-draw.test.mjs`：整套探针流程的假 DOM 测试（编辑器、发送按钮、模式下拉都是 mock 对象）
- `pulse.test.mjs` / `pulse-backend.test.mjs`：额度解析纯函数 + 后台缓存/429（后者独立 import background.js，用自己的 chrome mock）
- `background.test.mjs`：完整的 chrome API mock + SSE/trace 链路

**加功能时同步加测试**；现有 127 个用例必须全绿。注意两个易错点：① fixture 里 `chrome.runtime.onMessage.addListener` 只存最后一个回调；② 新增 `chrome.runtime.sendMessage` 消息类型要在 fixture 里加桩，否则会打乱测试里的调用计数。

## 7. 已知坑（踩过，别再踩）

1. **SPA 闪烁**：Arena 路由跳转有中间态，任何「页面是否变化」的检查都要带宽限（参照 `acquire.js` 的 2.5s 连续失配才中止）
2. **富文本输入框**：空输入框可能残留零宽字符，placeholder 可能是真实 DOM 文字
3. **侧栏虚拟化**：只有可见对话在 DOM 里，扫描前必须滚动加载
4. **扩展重载后旧 content script 失效**：`chrome.runtime.sendMessage` 会同步抛错，`contextAlive()` 检测并提示刷新页面
5. **额度接口限流**：多标签页轮询 + cookie 连发会触发 429，所有额度请求必须走 background 的缓存/去重/退避

## 8. 待办 / 路线图

- **Android 版二期**（仓库：arena-trace-android）：移植自动探针/抽卡、清理残留、本地历史；一期骨架（WebView + 令牌捕获 + 额度 HUD）已完成待实机验证
- 探针目标的 `/正则/` 写法已有支持，可补充文档示例
- 弹窗版本号硬编码（popup.html 里写的 v1.3.0，manifest 是 1.4.0）——顺手可统一

## 9. 给接手的 AI 的建议开工方式

1. 先跑 `npm test` 确认 127 绿
2. 读本文件 + README.md，然后按任务定位到第 3 节的文件
3. 改逻辑必跑 `npm test`；改 UI（hud/panel/popup 的 CSS 字符串）后 `node --check` 对应文件
4. 不要绕过第 5 节的红线；不确定 Arena 页面结构时，让用户提供 DOM 片段或接口返回，不要猜选择器
