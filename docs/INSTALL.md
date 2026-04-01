# Linux Installation And Distribution

This document explains how to install and distribute `vela-cli` on Linux.

## Prerequisites

- Node.js 20 or later
- `npm`
- Network access to `https://vela.lbxdrugs.com`
- A valid Vela username and password

You can verify the runtime first:

```bash
node -v
npm -v
```

## Option 1: Install For Local Use

Use this when you only want to run the tool on your own machine.

```bash
git clone <your-repo-url>
cd vela-cli
npm install
npm link
```

After `npm link`, the `vela-cli` command is available globally in your shell.

Set credentials in your shell:

```bash
export VELA_USERNAME="your-user"
export VELA_PASSWORD="your-password"
```

Then verify the install:

```bash
vela-cli --help
vela-cli apps
vela-cli app-policies h3-devops
vela-cli config-view h3-devops --env erp-test-hcloud-test-p1
```

## Option 2: Install From A Packed Tarball

Use this when you want to hand the tool to other Linux machines without publishing to npm.

Build the package:

```bash
npm pack
```

This generates a file like:

```bash
vela-cli-1.0.0.tgz
```

Install it globally on the target machine:

```bash
npm install -g vela-cli-1.0.0.tgz
```

Then configure credentials:

```bash
export VELA_USERNAME="your-user"
export VELA_PASSWORD="your-password"
```

## Option 3: Publish To An Internal npm Registry

Use this when the tool will be shared across a team.

Typical flow:

```bash
npm version patch
npm publish --registry <your-internal-npm-registry>
```

Install on Linux:

```bash
npm install -g vela-cli --registry <your-internal-npm-registry>
```

If you later scope the package, the install command would look like:

```bash
npm install -g @your-scope/vela-cli --registry <your-internal-npm-registry>
```

## Do You Need To Package It?

It depends on who will use it.

- Personal use: no special packaging is required. `npm install` plus `npm link` is enough.
- Team distribution: yes, packaging is recommended.
- Best low-cost distribution method: `npm pack` or an internal npm registry.
- Current runtime requirement: the target machine must have Node.js installed.

## Shell Completion On Linux

If you use `bash`:

```bash
eval "$(vela-cli completion bash)"
```

If you use `zsh`:

```bash
eval "$(vela-cli completion zsh)"
```

For a persistent setup, add the matching line to `~/.bashrc` or `~/.zshrc`.

## Common Commands

```bash
vela-cli --help
vela-cli apps
vela-cli app-policies h3-devops
vela-cli app-policies h3-devops --all
vela-cli config-view h3-devops --env erp-test-hcloud-test-p1
vela-cli config-view h3-devops --policy sdd-erp-test-idc-override
```

## Notes

- `app-policies` shows `override` policies by default.
- `config-view` shows YAML by default.
- Use `--json` when you need machine-readable output.
- The CLI is designed to stay read-only. It only logs in and performs `GET` requests for query commands.

