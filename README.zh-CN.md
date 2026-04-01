# vela-cli

`vela-cli` 是一个面向 [KubeVela](https://github.com/kubevela/kubevela) 的 Node.js CLI，主要用于查看和更新 Vela 资源，命令风格采用 kubectl 形式：`vela-cli <verb> <resource>`。

Linux 的安装和分发说明请见 [docs/INSTALL.md](docs/INSTALL.md)。

Vela 上游项目: [kubevela/kubevela](https://github.com/kubevela/kubevela)

## 安装

```bash
npm install
npm link
vela-cli --help
```

如果你是直接在仓库里运行而没有链接二进制命令，可以改用 `node ./src/cli.js ...`。

## 认证

CLI 会读取这些环境变量：

```bash
VELA_BASE_URL
VELA_LOGIN_PATH
VELA_TOKEN
VELA_USERNAME
VELA_PASSWORD
VELA_EDITOR
```

请通过 `VELA_BASE_URL` 和 `VELA_LOGIN_PATH` 把 CLI 指向你的目标 Vela 环境。你也可以直接在命令行里传入 `--base-url` 和 `--login-path`。

如果设置了 `VELA_TOKEN`，CLI 会直接使用该 bearer token。否则每次执行命令时都会使用 `VELA_USERNAME` 和 `VELA_PASSWORD` 登录。如果某个已认证请求返回 `401` 或 `403`，在可用用户名和密码的情况下，客户端会重新认证一次并自动重试。

你可以直接参考 [.env.example](.env.example) 来填一份本地环境变量文件。

## Shell 补全

```bash
# bash
eval "$(vela-cli completion bash)"

# zsh
eval "$(vela-cli completion zsh)"

# powershell
Invoke-Expression (vela-cli completion powershell | Out-String)
```

## 常用命令

```bash
vela-cli get me
vela-cli get projects
vela-cli get apps
vela-cli get app <name>
vela-cli describe app <name> -o yaml
vela-cli get components <name>
vela-cli get policies <name> -o json
vela-cli get policies <name> --all
vela-cli get policies <name> --type topology
vela-cli get policy <app> <policy>
vela-cli deploy app <app> --workflow <workflow>
vela-cli deploy app <app> --policy <policy>
vela-cli deploy app <app> --env <env>
vela-cli tui
vela-cli tui --resource envs
vela-cli edit policy <app> <policy>
vela-cli apply -f ./policy.yaml --app <app> --policy <policy>
vela-cli config view <app> --env <env>
vela-cli config view <app> --env <env> -o json
vela-cli get revisions <name>
vela-cli get envs
vela-cli get definitions
vela-cli get addons
vela-cli get system-info
vela-cli get raw /api/v1/applications
```

在 Windows PowerShell 中，推荐在 `npm link` 之后直接使用 `vela-cli ...`。如果想在仓库目录下不链接直接运行，可以使用包装脚本 `.\src\cli.cmd ...`。如果你的机器已经把 `.js` 关联到 Node，也可以用 `node .\src\cli.js ...` 做开发调试。

## 发布部署

`deploy app <app>` 会发送 `POST /api/v1/applications/<app>/deploy`，并带上 `triggerType: "web"`。

你需要且只需要选择一个参数：

- `--workflow <workflowName>`：直接部署指定 workflow
- `--policy <policyName>`：根据某个已绑定的 policy 解析 workflow
- `--env <envName>`：根据绑定到某个环境的 policies 解析 workflow

可选参数：

- `--force`：发送 `force: true`
- `-o json` 或 `-o yaml`：控制返回结果的渲染格式

当使用 `--policy` 或 `--env` 时，`vela-cli` 会先读取完整的 policy 详情，再发送 deploy 请求。

## TUI

`vela-cli tui` 会启动一个类似 k9s 的终端界面，重点是快速浏览常用的 Vela 资源，同时不改变现有的 `vela-cli <verb> <resource>` 命令形态。

当前版本包含：

- `apps`、`projects`、`envs`、`definitions`、`addons` 的资源页签
- `projects -> apps -> policies` 的 k9s 风格下钻导航
- 一个全宽资源表格，不带预览面板
- 一个紧凑的顶部状态区，用于显示上下文、命令和搜索状态
- `enter` 用于下钻，`d` 用于 describe
- `p` 可对当前选中的 policy 发起 deploy，并带确认步骤
- `e` 可从 policies 视图编辑选中的 policy，流程与 `edit policy` 保持一致，且同样是先备份再修改
- 支持资源切换、过滤、刷新和返回上一级的快捷键

常用按键：

- `1-5`：切换资源
- `tab` / `shift-tab`：循环切换资源
- `:`：打开 k9s 风格命令模式
- `/`：打开 k9s 风格过滤模式
- `j` / `k` 或方向键：移动选中项
- `enter`：进入当前行
- `d`：describe 当前行
- `p`：在确认 app、policy 和 workflow 后部署选中的 policy
- `e`：从 policies 视图编辑选中的 policy
- `esc` / `left` / `backspace`：返回上一级
- `y`：在 YAML 和 JSON 之间切换详情格式
- `r`：刷新当前资源
- `?`：查看帮助
- `q`：退出

常用命令示例：

- `:a` 或 `:apps` 切换到 apps
- `:prj` 或 `:projects` 切换到 projects
- `:po <app>` 打开某个 app 的 policies
- `:apps /foo` 切换资源并立即应用过滤条件

如果你希望 TUI 里的 `e` 使用指定编辑器，可以用 `vela-cli tui --editor <command>` 启动，或者设置 `VELA_EDITOR`。

如果 Vela 返回 `application deploy conflict`，TUI 会显示第二次确认，并可以用 `force: true` 重试同一次 deploy，这与浏览器流程保持一致。

过滤示例：

- `/foo|bar`：正则过滤
- `/! foo`：反向正则过滤
- `/-f abc`：模糊查找
- `/-l key=value`：标签过滤

## Policy 编辑

`edit policy` 会先读取当前 policy，写出一个可编辑的 YAML 文档，其顶层字段会与真实的 `PUT /api/v1/applications/<app>/policies/<policy>` payload 对齐，然后打开编辑器，最后把 YAML 转回 API 需要的 JSON payload。

编辑器优先级如下：

- `--editor <command>`
- `VELA_EDITOR`
- `EDITOR`
- `VISUAL`
- 默认编辑器

默认编辑器行为：

- Linux：`vim`
- Windows：优先使用 `PATH` 中可用的 `vim`，否则回退到 `notepad`

`apply -f` 支持两种输入：

- `edit policy` 输出的同款 manifest
- 直接来自 `get policy -o yaml` 的文档，只要你同时提供 `--app <app>` 和 `--policy <policy>`，或者文件里已经包含 `application` / `metadata.application` 以及 `name` / `metadata.name`

目前只会更新已有 policy。CLI 会把服务器维护的字段 `creator`、`createTime`、`updateTime` 排除在可编辑 manifest 之外，并在更新请求前自动把 `properties` 转回 JSON。

当 policy 真的发生变化时，`vela-cli` 会先写一份带时间戳的 YAML 备份，再发送 `PUT` 请求。备份结构与 `edit policy` 的顶层字段保持一致，方便和线上 API payload 对齐。

默认备份位置：

- Linux：`${XDG_STATE_HOME:-~/.local/state}/vela-cli/backups/<app>/`
- Windows：`%LOCALAPPDATA%\\vela-cli\\backups\\<app>\\`

## 安全模型

- 允许通过 Playwright 进行只读 capture
- 允许通过 `vela-cli tui` 进行终端浏览，并且在 policies 视图中按照 `edit policy` 相同的先备份再修改流程编辑 policy
- 允许通过 `deploy app` 发送 live `POST` 部署
- 仅允许通过 `edit policy` 和 `apply -f` 发送 live `PUT` 更新
- 将清理后的 capture artifacts 存放到 `artifacts/`

## 开发模式

当你不想依赖已安装的 `vela-cli` 二进制，而是直接从仓库里运行时，可以使用下面这些命令：

```bash
$env:VELA_BASE_URL="https://your-vela-host"
$env:VELA_LOGIN_PATH="/api/v1/auth/login"
$env:VELA_USERNAME="your-user"
$env:VELA_PASSWORD="your-pass"
npm run capture -- --headed
npm run endpoints
node ./src/cli.js get apps
```

## 许可证

本项目使用 Apache License 2.0，详情见 [LICENSE](LICENSE)。
