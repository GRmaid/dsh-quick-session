# dsh-quick-session

Start a session in the DSH Web GUI **without picking a workspace** — for small, throwaway tasks.

Each quick session gets its own fresh directory under `%DSH_HOME%\scratch`, and that directory
becomes the session's `cwd`: it is both the `workspace-write` sandbox boundary and the shell's
working directory. No Workspace is registered, so the sidebar files the session under **Ungrouped**.

## Install

    dsh plugin add github:GRmaid/dsh-quick-session

The package declares `dsh.bundle` (`patch: ./cordis.patch.yml`) and, for the browser half,
`dsh.client` (`platform: web`). It is plain ESM JavaScript, so it installs from source with no
build step. The desktop client's install boundary only accepts plugins published to npm, so on
desktop install it as a local `link:` (or wait for an npm release).

在 DSH Web GUI 里**不指定工作区**就开始一个会话，用来处理小任务。

## 使用

- 侧栏底部（设置旁）的**快捷会话**图标打开输入框（Enter 开始，Shift+Enter 换行，Esc 取消）。
- 提交后：宿主在 `%DSH_HOME%\scratch` 下为本会话新建独立目录，以它作为 `cwd` 创建会话，
  并把输入内容作为开场消息发出。
- 该会话**不注册任何 Workspace**，因此侧栏把它归入「未分组」。
- `cwd` 同时是文件沙箱 `workspace-write` 的边界与 shell 的工作目录：Agent 只能写这个临时目录。
  权限沿用现有四档，默认「工作区写入 + 变更前确认」。临时目录里的文件不会自动清理。

## 架构

**宿主半边**（`lib/entry.js`）注册一条路由：

    POST /plugins/dsh-quick-session/prepare  ->  { cwd }

它创建 `scratch/quick-<日期>-<随机>` 并返回绝对路径。请求先过请求栅栏：

    const connection = ctx.get('connection')          // 可选访问，缺服务时为 undefined
    const rejection = connection?.requestRejection(req) // 403 主机/来源不符，401 未通过浏览器会话鉴权

被拒绝时**不写任何东西**。注意必须用 `ctx.get(...)`：在 Cordis 里直接读未注入的服务属性会**抛异常**，
而 web 服务器对路由处理函数的异常统一回 400（这正是早期版本每个请求都 400 的原因）。

**为什么目录创建必须在宿主做**：本部署的目录选择器由 `dsh-host-directory-picker-auto` 解析为
**native** 后端（loopback + win32），capability 只有 `pick`；`list`/`createDirectory` 属于 browse
后端，调用被拒绝（`directory-picker/unavailable`）。浏览器半边既拿不到主目录，也建不了目录。

**浏览器半边**（`lib/client.js`）只负责 UI 与会话：`fetch(prepare)` →
`remote.session.create({ sessionId, cwd })` → `remote.session.prompt(...)` → `uiWorkspace.openSession(...)`。

## 为什么第一句话在插件输入框里发

DSH 核心的判定是：

    const inert = sessionId === undefined || (hero && chipTitle === undefined)

`chipTitle` 只在会话属于某个 Workspace 时才有值，所以**空白且无工作区的会话输入框被禁用**
（占位文案「选择一个工作区开始」）。会话一旦有了第一条消息，`hero` 变 false，原生输入框恢复 ——
之后追问、`@` 文件、权限档切换、模型选择全部走原生实现。

要做到「空白页直接在大输入框打字」只能改核心的 `inert` 判定，那需要重打包 `app.asar`，应用升级即失效。

## 改代码与重新加载

安装位置：`%DSH_HOME%\profiles\desktop\plugins\dsh-quick-session`，
依赖写作 `link:./plugins/dsh-quick-session`。

bundle 行用的是**相对说明符** `./lib/entry.js`（相对**本包目录**解析，不是 profile 目录），
这是为了让运行中的宿主能重新加载，原因有两条：

1. `dsh-hmr` 的 `ignored` 默认含 `**/node_modules`，插件经 node_modules 符号链接进来，文件改动不会触发重载；
2. 即使能触发，Node 会按 URL 永久缓存 ESM 模块，并且**进程内对 package.json 的 `exports` 映射也有缓存**，
   所以改 `main`/`exports`、改入口文件名、换子路径导出（`pkg/host`）都不会被运行中的宿主看到。

于是改宿主半边的正确姿势是：

1. 把 `lib/entry.js` 复制成**新文件名**（例如 `lib/entry2.js`）并改内容；
2. 把 `cordis.patch.yml` 里的 `name` 指向新文件名；
3. 关闭再打开组合包（插件管理页 / `plugin_manager` 的 `set_bundle` 先 false 再 true）。

新文件 URL 从未被导入过，加载器会真正 import 它 —— 无需重启应用。改完记得同步 `package.json`
的 `main`/`exports`，供下次启动时使用。

只改 `lib/client.js` 时无需上面这套：客户端 bundle 会重新下发，刷新页面即可。

## 卸载

    dsh plugin --profile desktop remove dsh-quick-session

## 图标

快捷会话图标处的鲸鱼尾巴来自 https://www.bilibili.com/video/BV1fQaX6FE8b/ 这个视频评论区底下一位同好制作的 GIF。
那张 GIF 的 59 帧逐像素完全相同，内容上是一张静图，所以按静图处理，没有丢动画。

原图是**不透明深色底**（#16181B）加浅色线稿，直接使用会在浅色主题下变成一个深色方块。因此：

1. 按原图自身的亮度直方图定阈值（底色峰值 luma 24），把底色抠成透明、保留线稿抗锯齿；
2. 紧贴图形裁剪并缩放到长边 96 px；
3. 编码为约 3.3 KB 的 PNG，base64 内联在 `lib/client.js` 的 `TAIL_MASK`；
4. 用 `mask-image` + `background-color: currentColor` 渲染 —— **颜色跟随主题**（浅色主题深线条、深色主题浅线条），
   按钮尺寸 20 px。

图标有一层回退阶梯，保证按钮永远不会是空的：
`TAIL_MASK`（同好制作的鲸鱼尾巴 GIF）→ 官方 `FISH_LOGO_PATH` 的尾鳍裁切（viewBox `16.2 0 6.96 8.4`）→ `⚡` 字形。

### 换图或调尺寸

- **复现所装图标**：`DSH_MASK_KEY_HI=191 node tools/make-mask.mjs <图片>` —— 该阈值下输出与 `lib/tail-mask.base64` 逐字节相同，它就是所装遮罩的权威副本。
- **换图**：`node tools/make-mask.mjs <图片>` 会打印一行 `const TAIL_MASK = ...`，替换 `lib/client.js` 里的同名常量即可。
  该脚本用应用内自带的 sharp，需要指向应用模块目录并用应用的 Electron 运行：

      $env:ELECTRON_RUN_AS_NODE = 1
      & "<安装目录>\DeepSeek Harness.exe" tools/make-mask.mjs "C:\path\to\tail.gif"

- **调尺寸**：改 `QuickSessionAction` 里的 `react.createElement(WhaleTailIcon, { size: 20 })`。

