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
node ./src/cli.js apply -f ./policy.yaml --app <app> --policy <policy>
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

`vela-cli tui` launches a k9s-inspired terminal UI. It focuses on fast navigation across the most useful Vela resources without changing the existing `vela-cli <verb> <resource>` command shape.

The first version includes:

- resource tabs for `apps`, `projects`, `envs`, `definitions`, and `addons`
- k9s-style drill-down navigation for `projects -> apps -> policies`
- a single full-width resource table with no preview pane
- a single compact top status area for context, commands, and search state
- `enter` for drill-down and `d` for describe
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
- `e`: edit the selected policy from the policies view
- `esc` / `left` / `backspace`: go back one level
- `y`: toggle detail format between YAML and JSON
- `r`: refresh the current resource
- `?`: show help
- `q`: quit

Useful command examples:

- `:a` or `:apps` to switch to apps
- `:prj` or `:projects` to switch to projects
- `:po <app>` to open policies for an app
- `:apps /foo` to switch resource and immediately apply a filter

If you want the TUI to use a specific editor for `e`, launch it with `node ./src/cli.js tui --editor <command>` or set `VELA_EDITOR`.

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

## Safety model

- Allows read-only capture via Playwright as before
- Allows terminal exploration through `vela-cli tui`, plus policy edits from the policies view with the same backup-first flow as `edit policy`
- Allows live `POST` deployments through `deploy app`
- Allows live `PUT` updates only through `edit policy` and `apply -f`
- Stores sanitized capture artifacts under `artifacts/`

You can also use environment variables:

```bash
$env:VELA_USERNAME="your-user"
$env:VELA_PASSWORD="your-pass"
node ./src/cli.js get apps
```
