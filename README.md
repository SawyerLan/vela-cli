# vela-cli

Vela web console inspection tool with `kubectl`-style `get`, `deploy`, `edit`, and `apply` commands.

Detailed Linux installation and distribution notes are in [docs/INSTALL.md](D:/new-code/vela-cli/docs/INSTALL.md).

The CLI now follows a `kubectl`-style layout: `vela-cli <verb> <resource>`.

## Install

```bash
npm install
npm link
```

Dynamic completion works best when `VELA_USERNAME` and `VELA_PASSWORD` are already set in your shell environment.

Authentication is environment-variable only. The CLI reads:

```bash
VELA_EDITOR
VELA_TOKEN
VELA_USERNAME
VELA_PASSWORD
```

If `VELA_TOKEN` is set, the CLI uses that bearer token directly. Otherwise each CLI invocation logs in with `VELA_USERNAME` and `VELA_PASSWORD`. If an authenticated request receives `401` or `403`, the client re-authenticates once and retries automatically when username/password are available.

## Shell Completion

```bash
# bash
eval "$(vela-cli completion bash)"

# zsh
eval "$(vela-cli completion zsh)"

# powershell
Invoke-Expression (vela-cli completion powershell | Out-String)
```

## Commands

```bash
$env:VELA_USERNAME="your-user"
$env:VELA_PASSWORD="your-pass"
npm run capture -- --headed
npm run endpoints
node ./src/cli.js get me
node ./src/cli.js get projects
node ./src/cli.js get apps
node ./src/cli.js get app <name>
node ./src/cli.js describe app <name> -o yaml
node ./src/cli.js get components <name>
node ./src/cli.js get policies <name> -o json
node ./src/cli.js get policies <name> --all
node ./src/cli.js get policies <name> --type topology
node ./src/cli.js get policy <app> <policy>
node ./src/cli.js deploy app <app> --workflow <workflow>
node ./src/cli.js deploy app <app> --policy <policy>
node ./src/cli.js deploy app <app> --env <env>
node ./src/cli.js tui
node ./src/cli.js tui --resource envs
node ./src/cli.js edit policy <app> <policy>
node ./src/cli.js apply -f ./policy.yaml --app <app>
node ./src/cli.js config view <app> --env <env>
node ./src/cli.js config view <app> --env <env> -o json
node ./src/cli.js get revisions <name>
node ./src/cli.js get envs
node ./src/cli.js get definitions
node ./src/cli.js get addons
node ./src/cli.js get system-info
node ./src/cli.js get raw /api/v1/applications
```

On Windows PowerShell, do not run `.\src\cli.js` directly unless `.js` is associated with Node on your machine. Use `node .\src\cli.js ...`, the linked `vela-cli ...` command, or the wrapper `.\src\cli.cmd ...`.

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

`vela-cli tui` launches a read-only terminal UI inspired by k9s. It focuses on fast navigation across the most useful Vela resources without changing the existing `vela-cli <verb> <resource>` command shape.

The first version includes:

- resource tabs for `apps`, `projects`, `envs`, `definitions`, and `addons`
- k9s-style drill-down navigation for `projects -> apps -> policies`
- `enter` for drill-down and `d` for describe
- a left-side list and right-side preview pane
- keyboard shortcuts for switching resources, filtering, refreshing, and going back up one level

Useful keys:

- `1-5`: switch resources
- `tab` / `shift-tab`: cycle resources
- `j` / `k` or arrow keys: move selection
- `enter`: drill down into the selected row
- `d`: describe the selected row
- `esc` / `left` / `backspace`: go back one level
- `/`: set a substring filter
- `y`: toggle detail format between YAML and JSON
- `r`: refresh the current resource
- `?`: show help
- `q`: quit

The TUI is intentionally read-only. It does not call `edit policy`, `apply -f`, or any deployment flow.

## Policy Editing

`edit policy` fetches the current policy, writes an editable YAML manifest to a temp file, launches your editor, then converts the YAML back into the JSON payload required by `PUT /api/v1/applications/<app>/policies/<policy>`.

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
- a raw `get policy -o yaml` document, as long as you also provide `--app <app>` (or add `application` / `metadata.application`)

Only existing policies are updated right now. The CLI keeps the server-owned fields (`creator`, `createTime`, `updateTime`) out of the editable manifest and automatically stringifies `properties` back to JSON for the update request.

When a policy actually changes, `vela-cli` writes a timestamped YAML backup of the pre-change content before sending the `PUT` request. The backup uses the same manifest shape as `edit policy`, so it can be applied back directly.

Default backup locations:

- Linux: `${XDG_STATE_HOME:-~/.local/state}/vela-cli/backups/<app>/`
- Windows: `%LOCALAPPDATA%\\vela-cli\\backups\\<app>\\`

## Safety model

- Allows read-only capture via Playwright as before
- Allows read-only terminal exploration through `vela-cli tui`
- Allows live `POST` deployments through `deploy app`
- Allows live `PUT` updates only through `edit policy` and `apply -f`
- Stores sanitized capture artifacts under `artifacts/`

You can also use environment variables:

```bash
$env:VELA_USERNAME="your-user"
$env:VELA_PASSWORD="your-pass"
node ./src/cli.js get apps
```
