# vela-cli

`vela-cli` is a Node.js CLI companion for [KubeVela](https://github.com/kubevela/kubevela), used for inspecting and updating Vela resources. It uses a kubectl-style layout: `vela-cli <verb> <resource>`.

Detailed Linux installation and distribution notes are in [docs/INSTALL.md](docs/INSTALL.md).

中文版本: [README.zh-CN.md](README.zh-CN.md)

Upstream Vela project: [kubevela/kubevela](https://github.com/kubevela/kubevela)

## Install

```bash
npm install
npm link
vela-cli --help
```

If you are working directly from the repository without linking the binary, use `node ./src/cli.js ...` instead.

## Authentication

The CLI reads these environment variables:

```bash
VELA_BASE_URL
VELA_LOGIN_PATH
VELA_TOKEN
VELA_USERNAME
VELA_PASSWORD
VELA_EDITOR
```

Set `VELA_BASE_URL` and `VELA_LOGIN_PATH` to point the CLI at your target Vela environment. If you prefer, you can also pass `--base-url` and `--login-path` on the command line.

If `VELA_TOKEN` is set, the CLI uses that bearer token directly. Otherwise each CLI invocation logs in with `VELA_USERNAME` and `VELA_PASSWORD`. If an authenticated request receives `401` or `403`, the client re-authenticates once and retries automatically when username/password are available.

For a ready-to-fill template, see [.env.example](.env.example).

## Shell Completion

```bash
# bash
eval "$(vela-cli completion bash)"

# zsh
eval "$(vela-cli completion zsh)"

# powershell
Invoke-Expression (vela-cli completion powershell | Out-String)
```

## Common Commands

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

On Windows PowerShell, prefer `vela-cli ...` after `npm link`, or use the wrapper `.\src\cli.cmd ...` if you want to run from the repository without linking. If `.js` is associated with Node on your machine, `node .\src\cli.js ...` also works for development.

## Deploy

`deploy app <app>` sends `POST /api/v1/applications/<app>/deploy` with `triggerType: "web"`.

Choose exactly one selector:

- `--workflow <workflowName>` to deploy a specific workflow directly
- `--policy <policyName>` to resolve the workflow from one bound policy
- `--env <envName>` to resolve the workflow from policies bound to one environment

Optional flags:

- `--force` to send `force: true`
- `-o json` or `-o yaml` to control response rendering

When `--policy` or `--env` is used, `vela-cli` resolves the workflow from full policy detail before sending the deploy request.

## TUI

`vela-cli tui` launches a k9s-inspired terminal UI. It focuses on fast navigation across the most useful Vela resources without changing the existing `vela-cli <verb> <resource>` command shape.

The first version includes:

- resource tabs for `apps`, `projects`, `envs`, `definitions`, and `addons`
- k9s-style drill-down navigation for `projects -> apps -> policies`
- a single full-width resource table with no preview pane
- a single compact top status area for context, commands, and search state
- `enter` for drill-down and `d` for describe
- `p` for deploy from the selected policy with an explicit confirmation step
- `e` for editing the selected policy from the policies view with the same backup-first flow as `edit policy`
- keyboard shortcuts for switching resources, filtering, refreshing, and going back up one level

Useful keys:

- `1-5`: switch resources
- `tab` / `shift-tab`: cycle resources
- `:`: open k9s-style command mode
- `/`: open k9s-style filter mode
- `j` / `k` or arrow keys: move selection
- `enter`: drill down into the selected row
- `d`: describe the selected row
- `p`: deploy the selected policy after showing app, policy, and workflow for confirmation
- `e`: edit the selected policy from the policies view
- `esc` / `left` / `backspace`: go back one level
- `r`: refresh the current resource
- `?`: show help
- `q`: quit

Useful command examples:

- `:a` or `:apps` to switch to apps
- `:prj` or `:projects` to switch to projects
- `:po <app>` to open policies for an app
- `:apps /foo` to switch resource and immediately apply a filter

If you want the TUI to use a specific editor for `e`, launch it with `vela-cli tui --editor <command>` or set `VELA_EDITOR`.

If Vela reports `application deploy conflict`, the TUI shows a second confirmation and can retry the same deploy with `force: true`, matching the browser flow.

Useful filter examples:

- `/foo|bar` for regex filtering
- `/! foo` for inverse regex filtering
- `/-f abc` for fuzzy finding
- `/-l key=value` for label filtering

## Policy Editing

`edit policy` fetches the current policy, writes an editable YAML document whose top-level fields match the real `PUT /api/v1/applications/<app>/policies/<policy>` payload, launches your editor, then converts that YAML back into the JSON payload required by the API.

Editor selection is owned by `vela-cli` itself:

- `--editor <command>`
- `VELA_EDITOR`
- `EDITOR`
- `VISUAL`
- default editor

Default editor behavior:

- Linux: `vim`
- Windows: prefer `vim` when it is available in `PATH`, otherwise fall back to `notepad`

`apply -f` accepts either:

- the same manifest emitted by `edit policy`
- a raw `get policy -o yaml` document, as long as you also provide `--app <app>` and `--policy <policy>` when the file omits them (or add `application` / `metadata.application` and `name` / `metadata.name`)

Only existing policies are updated right now. The CLI keeps the server-owned fields (`creator`, `createTime`, `updateTime`) out of the editable manifest and automatically stringifies `properties` back to JSON for the update request.

When a policy actually changes, `vela-cli` writes a timestamped YAML backup of the pre-change content before sending the `PUT` request. The backup uses the same top-level field shape as `edit policy`, so it stays aligned with the live API payload.

Default backup locations:

- Linux: `${XDG_STATE_HOME:-~/.local/state}/vela-cli/backups/<app>/`
- Windows: `%LOCALAPPDATA%\\vela-cli\\backups\\<app>\\`

## Safety Model

- Allows read-only capture via Playwright as before
- Allows terminal exploration through `vela-cli tui`, plus policy edits from the policies view with the same backup-first flow as `edit policy`
- Allows live `POST` deployments through `deploy app`
- Allows live `PUT` updates only through `edit policy` and `apply -f`
- Stores sanitized capture artifacts under `artifacts/`

## Development Mode

Use these commands when you want to run from the repository without relying on the installed `vela-cli` binary:

```bash
$env:VELA_BASE_URL="https://your-vela-host"
$env:VELA_LOGIN_PATH="/api/v1/auth/login"
$env:VELA_USERNAME="your-user"
$env:VELA_PASSWORD="your-pass"
npm run capture -- --headed
npm run endpoints
node ./src/cli.js get apps
```

## License

This project is licensed under the Apache License 2.0. See [LICENSE](LICENSE) for details.
