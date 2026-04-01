# vela-cli

Read-only capture and inspection tool for a Vela web console.

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
VELA_USERNAME
VELA_PASSWORD
```

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
node ./src/cli.js config view <app> --env <env>
node ./src/cli.js config view <app> --env <env> -o json
node ./src/cli.js get revisions <name>
node ./src/cli.js get envs
node ./src/cli.js get definitions
node ./src/cli.js get addons
node ./src/cli.js get system-info
node ./src/cli.js get raw /api/v1/applications
```

## Safety model

- Allows `GET`, `HEAD`, `OPTIONS`
- Allows only the login `POST /api/v1/auth/login`
- Blocks all other `POST`, `PUT`, `PATCH`, `DELETE`
- Stores sanitized request artifacts under `artifacts/`

You can also use environment variables:

```bash
$env:VELA_USERNAME="your-user"
$env:VELA_PASSWORD="your-pass"
node ./src/cli.js get apps
```
