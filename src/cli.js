#!/usr/bin/env node

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { Command } = require("commander");
const YAML = require("yaml");
const { runCapture, DEFAULT_BASE_URL, DEFAULT_LOGIN_PATH } = require("./capture");
const { VelaClient } = require("./api");
const { RESOURCE_ORDER, runTui } = require("./tui");

const OUTPUT_FORMATS = new Set(["table", "json", "yaml"]);
const AUTH_VALUE_OPTIONS = new Set([
  "--base-url",
  "--login-path",
  "--token",
  "-o",
  "--output",
  "--env",
  "--policy",
  "--workflow",
  "--type",
  "--editor",
  "--resource",
  "-f",
  "--filename",
  "--app",
]);
const EDITABLE_POLICY_API_VERSION = "vela-cli.dev/v1alpha1";
const EDITABLE_POLICY_KIND = "Policy";
const EDITABLE_POLICY_FIELDS = ["alias", "type", "description", "envName", "properties", "workflowPolicyBind"];

const TOP_LEVEL_COMMANDS = [
  "capture",
  "endpoints",
  "get",
  "describe",
  "edit",
  "apply",
  "deploy",
  "config",
  "tui",
  "completion",
  "help",
];
const SUBCOMMANDS = {
  get: [
    "me",
    "projects",
    "apps",
    "app",
    "components",
    "policies",
    "policy",
    "revisions",
    "envs",
    "definitions",
    "addons",
    "system-info",
    "raw",
  ],
  describe: ["app", "policy"],
  deploy: ["app"],
  edit: ["policy"],
  config: ["view"],
};

const COMMAND_OPTIONS = {
  capture: ["--base-url", "--login-path", "--headed"],
  apply: ["--base-url", "--login-path", "--token", "-o", "--output", "--json", "-f", "--filename", "--app"],
  deploy: [],
  endpoints: [],
  tui: ["--base-url", "--login-path", "--token", "--resource"],
  completion: [],
  get: [],
  describe: [],
  edit: [],
  config: [],
  "get me": ["--base-url", "--login-path", "--token", "-o", "--output", "--json"],
  "get projects": ["--base-url", "--login-path", "--token", "-o", "--output", "--json"],
  "get apps": ["--base-url", "--login-path", "--token", "-o", "--output", "--json"],
  "get app": ["--base-url", "--login-path", "--token", "-o", "--output", "--json"],
  "get components": ["--base-url", "--login-path", "--token", "-o", "--output", "--json"],
  "get policies": [
    "--base-url",
    "--login-path",
    "--token",
    "-o",
    "--output",
    "--json",
    "--all",
    "--type",
  ],
  "get policy": ["--base-url", "--login-path", "--token", "-o", "--output", "--json"],
  "get revisions": ["--base-url", "--login-path", "--token", "-o", "--output", "--json"],
  "get envs": ["--base-url", "--login-path", "--token", "-o", "--output", "--json"],
  "get definitions": ["--base-url", "--login-path", "--token", "-o", "--output", "--json"],
  "get addons": ["--base-url", "--login-path", "--token", "-o", "--output", "--json"],
  "get system-info": ["--base-url", "--login-path", "--token", "-o", "--output", "--json"],
  "get raw": ["--base-url", "--login-path", "--token", "-o", "--output", "--json"],
  "describe app": ["--base-url", "--login-path", "--token", "-o", "--output", "--json"],
  "describe policy": ["--base-url", "--login-path", "--token", "-o", "--output", "--json"],
  "deploy app": [
    "--base-url",
    "--login-path",
    "--token",
    "-o",
    "--output",
    "--json",
    "--workflow",
    "--policy",
    "--env",
    "--force",
  ],
  "edit policy": ["--base-url", "--login-path", "--token", "-o", "--output", "--json", "--editor"],
  "config view": [
    "--base-url",
    "--login-path",
    "--token",
    "-o",
    "--output",
    "--json",
    "--env",
    "--policy",
  ],
};

async function readLatestSummary(rootDir) {
  const artifactsDir = path.join(rootDir, "artifacts");
  const entries = await fs.readdir(artifactsDir, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();

  if (dirs.length === 0) {
    throw new Error("No capture artifacts found. Run the capture command first.");
  }

  const latestDir = path.join(artifactsDir, dirs[0]);
  const summary = JSON.parse(await fs.readFile(path.join(latestDir, "summary.json"), "utf8"));
  return { latestDir, summary };
}

function addAuthOptions(command, outputFormats = "table, json, yaml") {
  return command
    .option("--base-url <url>", "Vela base URL", DEFAULT_BASE_URL)
    .option("--login-path <path>", "Login API path", DEFAULT_LOGIN_PATH)
    .option("--token <token>", "Vela bearer token (or set VELA_TOKEN)")
    .option("-o, --output <format>", `Output format: ${outputFormats}`)
    .option("--json", "Alias for --output json", false);
}

function buildClient(options) {
  return new VelaClient({
    baseUrl: options.baseUrl,
    loginPath: options.loginPath,
    token: options.token,
    username: options.username,
    password: options.password,
  });
}

function printJson(data) {
  console.log(JSON.stringify(data, null, 2));
}

function printYaml(data) {
  console.log(YAML.stringify(data, { indent: 2 }).trimEnd());
}

function printRows(rows, columns) {
  const normalized = rows.map((row) =>
    columns.map((column) => {
      const value = typeof column.getter === "function" ? column.getter(row) : row[column.key];
      return value == null ? "" : String(value);
    }),
  );

  const widths = columns.map((column, index) =>
    Math.max(column.title.length, ...normalized.map((row) => row[index].length)),
  );

  const format = (cells) => cells.map((cell, index) => cell.padEnd(widths[index])).join("  ");
  console.log(format(columns.map((column) => column.title)));
  console.log(format(columns.map((_, index) => "-".repeat(widths[index]))));
  for (const row of normalized) {
    console.log(format(row));
  }
}

function filterByPrefix(items, prefix) {
  const safePrefix = prefix || "";
  return items.filter((item) => item.startsWith(safePrefix)).sort();
}

function stripOuterQuotes(value) {
  if (!value) {
    return value;
  }

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function resolveOutputFormat(options, defaultFormat) {
  const requested = String(options.output || "").toLowerCase();
  const format = options.json ? "json" : requested || defaultFormat;

  if (!OUTPUT_FORMATS.has(format)) {
    throw new Error(`Unsupported output format '${format}'. Use table, json, or yaml.`);
  }

  return format;
}

function renderRows(rows, columns, options) {
  const format = resolveOutputFormat(options, "table");
  if (format === "json") {
    printJson(rows);
    return;
  }
  if (format === "yaml") {
    printYaml(rows);
    return;
  }
  printRows(rows, columns);
}

function renderObject(data, options, defaultFormat = "json") {
  const format = resolveOutputFormat(options, defaultFormat);
  if (format === "table") {
    throw new Error("table output is not supported for this command.");
  }
  if (format === "json") {
    printJson(data);
    return;
  }
  printYaml(data);
}

function parseCompletionContext(words, currentIndex) {
  const normalizedWords = words.map((word) => stripOuterQuotes(word));
  const topLevel = currentIndex > 1 ? normalizedWords[1] || "" : "";
  const secondLevel =
    topLevel && SUBCOMMANDS[topLevel] && currentIndex > 2 ? normalizedWords[2] || "" : "";
  const commandPath = [];

  if (topLevel) {
    commandPath.push(topLevel);
    if (secondLevel && !secondLevel.startsWith("-")) {
      commandPath.push(secondLevel);
    }
  }

  const commandKey = commandPath.join(" ");
  const current = normalizedWords[currentIndex] || "";
  const previous = normalizedWords[currentIndex - 1] || "";
  const auth = {};
  const positionals = [];
  let expectingValueFor = null;
  const startIndex = 1 + commandPath.length;

  for (let index = startIndex; index < currentIndex; index += 1) {
    const token = normalizedWords[index];

    if (expectingValueFor) {
      if (expectingValueFor === "--base-url") {
        auth.baseUrl = token;
      } else if (expectingValueFor === "--login-path") {
        auth.loginPath = token;
      } else if (expectingValueFor === "--token") {
        auth.token = token;
      }
      expectingValueFor = null;
      continue;
    }

    if (AUTH_VALUE_OPTIONS.has(token)) {
      expectingValueFor = token;
      continue;
    }

    if (token.startsWith("-")) {
      continue;
    }

    positionals.push(token);
  }

  return {
    topLevel,
    commandKey,
    current,
    previous,
    positionals,
    auth,
  };
}

function buildClientFromParsedAuth(auth) {
  return new VelaClient({
    baseUrl: auth.baseUrl,
    loginPath: auth.loginPath,
    token: auth.token,
    username: auth.username,
    password: auth.password,
  });
}

async function getApplicationNames(client) {
  const data = await client.getJson("/api/v1/applications");
  return (data.applications || []).map((item) => item.name).filter(Boolean);
}

async function getApplicationPolicies(client, appName) {
  const data = await client.getJson(`/api/v1/applications/${encodeURIComponent(appName)}/policies`);
  return data.policies || [];
}

async function getPolicyNames(client, appName) {
  const policies = await getApplicationPolicies(client, appName);
  return policies.map((item) => item.name).filter(Boolean);
}

async function getOverrideEnvNames(client, appName) {
  const policies = await getApplicationPolicies(client, appName);
  return policies
    .filter((item) => item.type === "override")
    .map((item) => item.envName)
    .filter(Boolean);
}

function uniqueNonEmpty(items) {
  return Array.from(new Set(items.filter(Boolean))).sort();
}

function getWorkflowNamesFromPolicy(policy) {
  return uniqueNonEmpty((policy.workflowPolicyBind || []).map((item) => item.name));
}

async function getEnvNames(client, appName) {
  const policies = await getApplicationPolicies(client, appName);
  return uniqueNonEmpty(policies.map((policy) => policy.envName));
}

async function getDynamicCompletions(context) {
  const client = buildClientFromParsedAuth(context.auth);

  if (!client.token && (!client.username || !client.password)) {
    return [];
  }

  if (
    ["get app", "describe app", "get components", "get policies", "get revisions", "config view", "deploy app"].includes(
      context.commandKey,
    )
  ) {
    if (context.positionals.length === 0 && context.previous !== "--env" && context.previous !== "--policy") {
      return getApplicationNames(client);
    }
  }

  if (["get policy", "describe policy", "edit policy"].includes(context.commandKey)) {
    if (context.positionals.length === 0) {
      return getApplicationNames(client);
    }
    if (context.positionals.length === 1) {
      return getPolicyNames(client, context.positionals[0]);
    }
  }

  if (context.commandKey === "config view") {
    const appName = context.positionals[0];
    if (!appName) {
      return getApplicationNames(client);
    }
    if (context.previous === "--policy") {
      return getPolicyNames(client, appName);
    }
    if (context.previous === "--env") {
      return getOverrideEnvNames(client, appName);
    }
  }

  if (context.commandKey === "deploy app") {
    const appName = context.positionals[0];
    if (!appName) {
      return getApplicationNames(client);
    }
    if (context.previous === "--policy") {
      return getPolicyNames(client, appName);
    }
    if (context.previous === "--env") {
      return getEnvNames(client, appName);
    }
  }

  if (context.commandKey === "apply" && context.previous === "--app") {
    return getApplicationNames(client);
  }

  return [];
}

function getStaticCompletions(context) {
  if (!context.topLevel) {
    return TOP_LEVEL_COMMANDS;
  }

  if (SUBCOMMANDS[context.topLevel] && !context.commandKey.includes(" ")) {
    return context.current.startsWith("-") ? COMMAND_OPTIONS[context.topLevel] || [] : SUBCOMMANDS[context.topLevel];
  }

  if (context.current.startsWith("-")) {
    return COMMAND_OPTIONS[context.commandKey] || [];
  }

  if (context.topLevel === "tui" && context.previous === "--resource") {
    return RESOURCE_ORDER;
  }

  if (context.topLevel === "completion") {
    return ["bash", "zsh", "powershell"];
  }

  return [];
}

async function resolveCompletions(words, currentIndex) {
  const context = parseCompletionContext(words, currentIndex);
  const currentPrefix = context.current || "";

  const staticSuggestions = getStaticCompletions(context);
  const dynamicSuggestions = await getDynamicCompletions(context).catch(() => []);

  const merged = Array.from(new Set([...staticSuggestions, ...dynamicSuggestions]));
  return filterByPrefix(merged, currentPrefix);
}

function getCompletionScript(shellName) {
  if (shellName === "bash") {
    return [
      "_vela_cli_completion() {",
      "  local IFS=$'\\n'",
      '  COMPREPLY=($(COMP_CWORD="$COMP_CWORD" vela-cli __complete -- "${COMP_WORDS[@]}" 2>/dev/null))',
      "}",
      "",
      "complete -o nosort -F _vela_cli_completion vela-cli",
      "",
    ].join("\n");
  }

  if (shellName === "zsh") {
    return [
      "#compdef vela-cli",
      "",
      "_vela_cli_completion() {",
      "  local -a completions",
      '  completions=("${(@f)$(COMP_CWORD="$((CURRENT-1))" vela-cli __complete -- "${words[@]}" 2>/dev/null)}")',
      "  compadd -a completions",
      "}",
      "",
      "compdef _vela_cli_completion vela-cli",
      "",
    ].join("\n");
  }

  if (shellName === "powershell") {
    return [
      "Register-ArgumentCompleter -CommandName vela-cli -ScriptBlock {",
      "  param($commandName, $wordToComplete, $commandAst, $fakeBoundParameters)",
      "",
      "  $elements = @()",
      "  foreach ($element in $commandAst.CommandElements) {",
      "    $elements += $element.Extent.Text",
      "  }",
      "",
      "  if ($elements.Count -eq 0) {",
      "    $elements = @($commandName)",
      "  }",
      "",
      "  if ($wordToComplete -and ($elements.Count -eq 0 -or $elements[-1] -ne $wordToComplete)) {",
      "    $elements += $wordToComplete",
      "  }",
      "",
      "  $env:COMP_CWORD = [string]($elements.Count - 1)",
      "  vela-cli __complete -- @elements 2>$null | ForEach-Object {",
      "    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)",
      "  }",
      "}",
      "",
    ].join("\n");
  }

  throw new Error(`Unsupported shell '${shellName}'. Use bash, zsh, or powershell.`);
}

function findOverridePolicy(policies, envName) {
  return policies.find((policy) => policy.type === "override" && policy.envName === envName);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function buildEditablePolicyState(appName, policy) {
  return {
    application: appName,
    name: policy.name,
    alias: policy.alias ?? "",
    type: policy.type ?? "",
    description: policy.description ?? "",
    envName: policy.envName ?? "",
    properties: policy.properties ?? {},
    workflowPolicyBind: policy.workflowPolicyBind ?? [],
  };
}

function buildEditablePolicyManifest(appName, policy) {
  const state = buildEditablePolicyState(appName, policy);
  return {
    apiVersion: EDITABLE_POLICY_API_VERSION,
    kind: EDITABLE_POLICY_KIND,
    metadata: {
      application: state.application,
      name: state.name,
    },
    spec: {
      alias: state.alias,
      type: state.type,
      description: state.description,
      envName: state.envName,
      properties: state.properties,
      workflowPolicyBind: state.workflowPolicyBind,
    },
  };
}

function padTimestamp(value) {
  return String(value).padStart(2, "0");
}

function formatTimestampForFilename(date = new Date()) {
  return [
    date.getFullYear(),
    padTimestamp(date.getMonth() + 1),
    padTimestamp(date.getDate()),
    "-",
    padTimestamp(date.getHours()),
    padTimestamp(date.getMinutes()),
    padTimestamp(date.getSeconds()),
  ].join("");
}

function sanitizeFilenameSegment(value) {
  return String(value || "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "unknown";
}

function getBackupRootDir() {
  const homeDir = os.homedir();

  if (process.platform === "win32") {
    const baseDir =
      process.env.LOCALAPPDATA ||
      (homeDir ? path.join(homeDir, "AppData", "Local") : null);
    if (!baseDir) {
      throw new Error("Unable to resolve a local backup directory on Windows.");
    }
    return path.join(baseDir, "vela-cli", "backups");
  }

  if (process.platform === "linux") {
    const baseDir =
      process.env.XDG_STATE_HOME ||
      (homeDir ? path.join(homeDir, ".local", "state") : null);
    if (!baseDir) {
      throw new Error("Unable to resolve a local backup directory on Linux.");
    }
    return path.join(baseDir, "vela-cli", "backups");
  }

  if (!homeDir) {
    throw new Error("Unable to resolve a local backup directory.");
  }

  return path.join(homeDir, ".vela-cli", "backups");
}

async function writePolicyBackup(appName, policy) {
  const backupDir = path.join(getBackupRootDir(), sanitizeFilenameSegment(appName));
  const filename = `${sanitizeFilenameSegment(policy.name)}-${formatTimestampForFilename()}.yaml`;
  const backupPath = path.join(backupDir, filename);
  const manifest = buildEditablePolicyManifest(appName, policy);

  await fs.mkdir(backupDir, { recursive: true });
  await fs.writeFile(backupPath, YAML.stringify(manifest, { indent: 2 }), "utf8");

  return backupPath;
}

function normalizeEditablePolicyState(raw, defaults = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Policy manifest must be a YAML object.");
  }

  const metadata =
    raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata) ? raw.metadata : {};
  const spec = raw.spec && typeof raw.spec === "object" && !Array.isArray(raw.spec) ? raw.spec : raw;
  const state = {
    application:
      defaults.application ??
      raw.application ??
      raw.appName ??
      metadata.application ??
      metadata.appName ??
      metadata.applicationName,
    name: defaults.name ?? raw.name ?? metadata.name,
  };

  for (const field of EDITABLE_POLICY_FIELDS) {
    if (hasOwn(spec, field)) {
      state[field] = spec[field];
    }
  }

  return state;
}

function mergeEditablePolicyState(base, overrides) {
  const merged = { ...base };
  if (overrides.application) {
    merged.application = overrides.application;
  }
  if (overrides.name) {
    merged.name = overrides.name;
  }

  for (const field of EDITABLE_POLICY_FIELDS) {
    if (hasOwn(overrides, field)) {
      merged[field] = overrides[field];
    }
  }

  return merged;
}

function stableJson(value) {
  return JSON.stringify(value);
}

function ensureJsonString(value, fieldName) {
  if (typeof value !== "string") {
    return JSON.stringify(value);
  }

  try {
    JSON.parse(value);
  } catch (error) {
    throw new Error(`${fieldName} must be valid JSON when provided as a string: ${error.message}`);
  }

  return value;
}

function buildPolicyUpdatePayload(state) {
  if (!state.application) {
    throw new Error("Policy manifest is missing application. Set metadata.application or use --app.");
  }
  if (!state.name) {
    throw new Error("Policy manifest is missing name. Set metadata.name or name.");
  }

  return {
    alias: state.alias ?? "",
    type: state.type ?? "",
    description: state.description ?? "",
    envName: state.envName ?? "",
    properties: ensureJsonString(state.properties ?? {}, "properties"),
    workflowPolicyBind: state.workflowPolicyBind ?? [],
  };
}

function getPolicyApiPath(appName, policyName) {
  return `/api/v1/applications/${encodeURIComponent(appName)}/policies/${encodeURIComponent(policyName)}`;
}

function getDeployApiPath(appName) {
  return `/api/v1/applications/${encodeURIComponent(appName)}/deploy`;
}

function renderMutationObject(data, options, defaultFormat = "json") {
  const format = resolveOutputFormat(options, defaultFormat);
  if (format === "table") {
    throw new Error("table output is not supported for this command.");
  }
  if (format === "json") {
    printJson(data);
    return;
  }
  printYaml(data);
}

function resolveWorkflowFromCandidates(sourceLabel, sourceValue, workflowNames) {
  if (workflowNames.length === 0) {
    throw new Error(`No workflow binding found for ${sourceLabel} '${sourceValue}'.`);
  }

  if (workflowNames.length > 1) {
    throw new Error(
      `${sourceLabel} '${sourceValue}' maps to multiple workflows (${workflowNames.join(", ")}). Use --workflow.`,
    );
  }

  return workflowNames[0];
}

async function resolveDeployWorkflowName(client, appName, options) {
  const selected = [options.workflow, options.policy, options.env].filter(Boolean);
  if (selected.length !== 1) {
    throw new Error("deploy app requires exactly one of --workflow, --policy, or --env.");
  }

  if (options.workflow) {
    return options.workflow;
  }

  const policies = await getApplicationPolicies(client, appName);

  if (options.policy) {
    const policySummary = policies.find((item) => item.name === options.policy);
    if (!policySummary) {
      const available = uniqueNonEmpty(policies.map((item) => item.name));
      throw new Error(
        `Policy '${options.policy}' was not found in app '${appName}'. Available policies: ${available.join(", ") || "<none>"}`,
      );
    }
    const policy = await client.getJson(getPolicyApiPath(appName, policySummary.name));
    return resolveWorkflowFromCandidates("policy", options.policy, getWorkflowNamesFromPolicy(policy));
  }

  const matchedPolicySummaries = policies.filter((item) => item.envName === options.env);
  if (matchedPolicySummaries.length === 0) {
    const available = await getEnvNames(client, appName);
    throw new Error(
      `No policy with env '${options.env}' was found in app '${appName}'. Available envs: ${available.join(", ") || "<none>"}`,
    );
  }

  const matchedPolicies = await Promise.all(
    matchedPolicySummaries.map((policy) => client.getJson(getPolicyApiPath(appName, policy.name))),
  );

  return resolveWorkflowFromCandidates(
    "env",
    options.env,
    uniqueNonEmpty(matchedPolicies.flatMap((policy) => getWorkflowNamesFromPolicy(policy))),
  );
}

async function updateExistingPolicy(client, desiredState) {
  const currentPolicy = await client.getJson(getPolicyApiPath(desiredState.application, desiredState.name));
  const currentState = buildEditablePolicyState(desiredState.application, currentPolicy);
  const mergedState = mergeEditablePolicyState(currentState, desiredState);

  if (stableJson(currentState) === stableJson(mergedState)) {
    return {
      changed: false,
      backupPath: null,
      state: currentState,
      response: currentPolicy,
    };
  }

  const backupPath = await writePolicyBackup(desiredState.application, currentPolicy);

  const response = await client.putJson(
    getPolicyApiPath(mergedState.application, mergedState.name),
    buildPolicyUpdatePayload(mergedState),
  );

  return {
    changed: true,
    backupPath,
    state: mergedState,
    response,
  };
}

async function readYamlFile(filename) {
  if (filename === "-") {
    return new Promise((resolve, reject) => {
      let content = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => {
        content += chunk;
      });
      process.stdin.on("end", () => resolve(content));
      process.stdin.on("error", reject);
    });
  }

  return fs.readFile(filename, "utf8");
}

function resolveEditorCommand(editor) {
  if (editor) {
    return editor;
  }
  if (process.env.VELA_EDITOR) {
    return process.env.VELA_EDITOR;
  }
  if (process.env.EDITOR) {
    return process.env.EDITOR;
  }
  if (process.env.VISUAL) {
    return process.env.VISUAL;
  }
  if (process.platform === "win32") {
    const probe = spawnSync("where", ["vim"], {
      stdio: "ignore",
      shell: false,
    });
    return probe.status === 0 ? "vim" : "notepad";
  }
  return "vim";
}

async function openEditor(filePath, editor) {
  const command = resolveEditorCommand(editor);

  await new Promise((resolve, reject) => {
    const child = spawn(command, [filePath], {
      stdio: "inherit",
      shell: true,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Editor exited with code ${code}`));
    });
  });
}

function renderMutationResult(result, options) {
  if (result.changed) {
    console.log(`policy/${result.response.name} configured`);
    console.log(`backup: ${result.backupPath}`);
    return;
  }

  console.log(`policy/${result.response.name} unchanged`);
}

async function handleCapture(options) {
  const result = await runCapture({
    baseUrl: options.baseUrl,
    loginPath: options.loginPath,
    username: options.username,
    password: options.password,
    headless: !options.headed,
  });

  console.log(`Capture completed: ${result.outputDir}`);
  console.log(`Final URL: ${result.finalUrl || "<unknown>"}`);
  console.log(`Allowed endpoints: ${result.summary.allowed.length}`);
  console.log(`Blocked endpoints: ${result.summary.blocked.length}`);
  if (result.exploredNav.length > 0) {
    console.log(`Explored nav: ${result.exploredNav.join(", ")}`);
  }
}

async function handleEndpoints() {
  const { latestDir, summary } = await readLatestSummary(process.cwd());

  console.log(`Latest capture: ${latestDir}`);
  console.log("");
  console.log("Allowed:");
  for (const item of summary.allowed) {
    console.log(
      `${item.method.padEnd(6)} ${item.path}  count=${item.count} statuses=${item.statuses.join(",") || "-"}`,
    );
  }

  console.log("");
  console.log("Blocked:");
  for (const item of summary.blocked) {
    console.log(`${item.method.padEnd(6)} ${item.path}  count=${item.count}`);
  }
}

async function handleGetMe(options) {
  const client = buildClient(options);
  const data = await client.getJson("/api/v1/auth/user_info");
  const format = resolveOutputFormat(options, "table");

  if (format === "json") {
    printJson(data);
    return;
  }
  if (format === "yaml") {
    printYaml(data);
    return;
  }

  console.log(`user: ${data.name}`);
  console.log(`email: ${data.email || ""}`);
  console.log(`alias: ${data.alias || ""}`);
  console.log(`disabled: ${Boolean(data.disabled)}`);
  console.log(`projects: ${(data.projects || []).length}`);
}

async function handleGetProjects(options) {
  const client = buildClient(options);
  const data = await client.getJson("/api/v1/auth/user_info");
  const projects = data.projects || [];

  renderRows(projects, [
    { title: "NAME", key: "name" },
    { title: "ALIAS", key: "alias" },
    { title: "OWNER", getter: (item) => item.owner?.name || "" },
    { title: "ROLES", getter: (item) => (item.roles || []).map((role) => role.name).join(",") },
  ], options);
}

async function handleGetApps(options) {
  const client = buildClient(options);
  const data = await client.getJson("/api/v1/applications");
  const applications = data.applications || [];

  renderRows(applications, [
    { title: "NAME", key: "name" },
    { title: "PROJECT", getter: (item) => item.project?.name || "" },
    { title: "ALIAS", key: "alias" },
    { title: "UPDATED", key: "updateTime" },
  ], options);
}

async function handleGetApp(name, options) {
  const client = buildClient(options);
  const data = await client.getJson(`/api/v1/applications/${encodeURIComponent(name)}`);

  renderObject({
    name: data.name,
    alias: data.alias,
    project: data.project?.name,
    description: data.description,
    updateTime: data.updateTime,
    policies: data.policies,
    envBindings: data.envBindings,
    resourceInfo: data.resourceInfo,
    labels: data.labels,
  }, options, "json");
}

async function handleGetComponents(name, options) {
  const client = buildClient(options);
  const data = await client.getJson(`/api/v1/applications/${encodeURIComponent(name)}/components`);
  const components = data.components || [];

  renderRows(components, [
    { title: "NAME", key: "name" },
    { title: "TYPE", key: "componentType" },
    { title: "WORKLOAD", getter: (item) => item.workloadType?.type || "" },
    { title: "MAIN", getter: (item) => String(Boolean(item.main)) },
    { title: "UPDATED", key: "updateTime" },
  ], options);
}

async function handleGetPolicies(name, options) {
  const client = buildClient(options);
  const policies = await getApplicationPolicies(client, name);
  const policyType = options.type || (options.all ? null : "override");
  const filteredPolicies = policyType ? policies.filter((item) => item.type === policyType) : policies;

  renderRows(filteredPolicies, [
    { title: "NAME", key: "name" },
    { title: "TYPE", key: "type" },
    { title: "ENV", key: "envName" },
    { title: "UPDATED", key: "updateTime" },
  ], options);
}

async function handleGetPolicy(appName, policyName, options) {
  const client = buildClient(options);
  const data = await client.getJson(
    `/api/v1/applications/${encodeURIComponent(appName)}/policies/${encodeURIComponent(policyName)}`,
  );

  renderObject(data, options, "yaml");
}

async function handleConfigView(appName, options) {
  const client = buildClient(options);

  if (options.policy) {
    const data = await client.getJson(
      `/api/v1/applications/${encodeURIComponent(appName)}/policies/${encodeURIComponent(options.policy)}`,
    );
    renderObject(data, options, "yaml");
    return;
  }

  if (!options.env) {
    throw new Error("config view requires --env or --policy.");
  }

  const policies = await getApplicationPolicies(client, appName);
  const policy = findOverridePolicy(policies, options.env);

  if (!policy) {
    const available = policies
      .filter((item) => item.type === "override")
      .map((item) => item.envName)
      .filter(Boolean)
      .sort();
    throw new Error(
      `No override policy found for env '${options.env}'. Available envs: ${available.join(", ") || "<none>"}`,
    );
  }

  const data = await client.getJson(
    `/api/v1/applications/${encodeURIComponent(appName)}/policies/${encodeURIComponent(policy.name)}`,
  );
  renderObject(data, options, "yaml");
}

async function handleGetRevisions(name, options) {
  const client = buildClient(options);
  const data = await client.getJson(`/api/v1/applications/${encodeURIComponent(name)}/revisions`);
  const revisions = data.revisions || [];

  renderRows(revisions, [
    { title: "VERSION", key: "version" },
    { title: "ENV", key: "envName" },
    { title: "STATUS", key: "status" },
    { title: "USER", getter: (item) => item.deployUser?.name || "" },
    { title: "CREATED", key: "createTime" },
  ], options);
}

async function handleGetEnvs(options) {
  const client = buildClient(options);
  const data = await client.getJson("/api/v1/envs");
  const envs = data.envs || [];

  renderRows(envs, [
    { title: "NAME", key: "name" },
    { title: "PROJECT", getter: (item) => item.project?.name || "" },
    { title: "NAMESPACE", key: "namespace" },
    { title: "TARGETS", getter: (item) => (item.targets || []).map((target) => target.name).join(",") },
  ], options);
}

async function handleGetDefinitions(options) {
  const client = buildClient(options);
  const data = await client.getJson("/api/v1/definitions");
  const definitions = data.definitions || [];

  renderRows(definitions, [
    { title: "NAME", key: "name" },
    { title: "TYPE", key: "workloadType" },
    { title: "STATUS", key: "status" },
    { title: "ADDON", key: "ownerAddon" },
  ], options);
}

async function handleGetAddons(options) {
  const client = buildClient(options);
  const data = await client.getJson("/api/v1/enabled_addon");
  const addons = data.enabledAddons || [];

  renderRows(addons, [
    { title: "NAME", key: "name" },
    { title: "PHASE", key: "phase" },
  ], options);
}

async function handleGetSystemInfo(options) {
  const client = buildClient(options);
  const data = await client.getJson("/api/v1/system_info");

  renderObject({
    platformID: data.platformID,
    loginType: data.loginType,
    installTime: data.installTime,
    systemVersion: data.systemVersion,
  }, options, "json");
}

async function handleGetRaw(apiPath, options) {
  if (!apiPath.startsWith("/api/v1/")) {
    throw new Error("Only /api/v1/* paths are allowed.");
  }

  const client = buildClient(options);
  const data = await client.getJson(apiPath);
  renderObject(data, options, "json");
}

async function handleEditPolicy(appName, policyName, options) {
  const client = buildClient(options);
  const currentPolicy = await client.getJson(getPolicyApiPath(appName, policyName));
  const manifest = buildEditablePolicyManifest(appName, currentPolicy);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vela-policy-"));
  const tempFile = path.join(tempDir, `${policyName}.yaml`);

  try {
    await fs.writeFile(tempFile, YAML.stringify(manifest, { indent: 2 }), "utf8");
    await openEditor(tempFile, options.editor);

    const editedRaw = await fs.readFile(tempFile, "utf8");
    const editedManifest = YAML.parse(editedRaw);
    const desiredState = normalizeEditablePolicyState(editedManifest, {
      application: appName,
      name: policyName,
    });
    const result = await updateExistingPolicy(client, desiredState);
    renderMutationResult(result, options);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function handleApply(options) {
  if (!options.filename) {
    throw new Error("apply requires -f or --filename.");
  }

  const input = await readYamlFile(options.filename);
  const manifest = YAML.parse(input);
  const desiredState = normalizeEditablePolicyState(manifest, {
    application: options.app,
  });
  const client = buildClient(options);
  const result = await updateExistingPolicy(client, desiredState);
  renderMutationResult(result, options);
}

async function handleTui(options) {
  await runTui(options);
}

async function handleDeployApp(appName, options) {
  const client = buildClient(options);
  const workflowName = await resolveDeployWorkflowName(client, appName, options);
  const response = await client.postJson(getDeployApiPath(appName), {
    appName,
    workflowName,
    triggerType: "web",
    force: Boolean(options.force),
  });

  renderMutationObject(response, options, "json");
}

const program = new Command();

program
  .name("vela-cli")
  .description("Vela request inspector with kubectl-style get, deploy, edit, and apply subcommands");

program
  .command("completion <shellName>")
  .description("Print shell completion script for bash, zsh, or powershell")
  .action((shellName) => {
    console.log(getCompletionScript(shellName));
  });

program
  .command("__complete [words...]", { hidden: true })
  .allowUnknownOption()
  .action(async (words) => {
    const normalizedWords = words.length > 0 ? words : ["vela-cli"];
    const rawIndex = Number(process.env.COMP_CWORD);
    const currentIndex = Number.isInteger(rawIndex) ? rawIndex : normalizedWords.length - 1;
    const completions = await resolveCompletions(normalizedWords, currentIndex);
    for (const completion of completions) {
      console.log(completion);
    }
  });

program
  .command("capture")
  .description("Log into Vela and capture read-only network activity")
  .option("--base-url <url>", "Vela base URL", DEFAULT_BASE_URL)
  .option("--login-path <path>", "Login API path", DEFAULT_LOGIN_PATH)
  .option("--headed", "Run browser in headed mode", false)
  .action(handleCapture);

program
  .command("endpoints")
  .description("Print the latest captured endpoint summary")
  .action(handleEndpoints);

program
  .command("tui")
  .description("Launch a k9s-inspired read-only terminal UI")
  .option("--base-url <url>", "Vela base URL", DEFAULT_BASE_URL)
  .option("--login-path <path>", "Login API path", DEFAULT_LOGIN_PATH)
  .option("--token <token>", "Vela bearer token (or set VELA_TOKEN)")
  .option("--resource <name>", `Initial resource: ${RESOURCE_ORDER.join(", ")}`, "apps")
  .action(handleTui);

const getCommand = program.command("get").description("List resources or fetch a single resource");
const describeCommand = program.command("describe").description("Show detailed resource information");
const deployCommand = program.command("deploy").description("Start an application deployment");
const editCommand = program.command("edit").description("Edit an existing resource");
const configCommand = program.command("config").description("Inspect application configuration");

addAuthOptions(
  getCommand.command("me").description("Show current user profile and project memberships"),
).action(handleGetMe);

addAuthOptions(
  getCommand.command("projects").description("List projects from the authenticated user profile"),
).action(handleGetProjects);

addAuthOptions(
  getCommand.command("apps").description("List applications"),
).action(handleGetApps);

addAuthOptions(
  getCommand.command("app <name>").description("Show one application summary"),
  "json, yaml"
).action(handleGetApp);

addAuthOptions(
  describeCommand.command("app <name>").description("Describe one application"),
  "json, yaml"
).action(handleGetApp);

addAuthOptions(
  getCommand.command("components <appName>").description("List application components"),
).action(handleGetComponents);

addAuthOptions(
  getCommand.command("policies <appName>").description("List application policies"),
)
  .option("--all", "Include non-override policies", false)
  .option("--type <type>", "Filter by policy type, e.g. override or topology")
  .action(handleGetPolicies);

addAuthOptions(
  getCommand.command("policy <appName> <policyName>").description("Show one application policy detail"),
  "json, yaml"
).action(handleGetPolicy);

addAuthOptions(
  describeCommand.command("policy <appName> <policyName>").description("Describe one application policy"),
  "json, yaml"
).action(handleGetPolicy);

addAuthOptions(
  deployCommand.command("app <appName>").description("Deploy one application workflow"),
  "json, yaml"
)
  .option("--workflow <workflowName>", "Deploy a specific workflow by name")
  .option("--policy <policyName>", "Resolve the workflow from a bound policy")
  .option("--env <envName>", "Resolve the workflow from an environment name")
  .option("--force", "Force a deployment even when the server would normally skip it", false)
  .action(handleDeployApp);

addAuthOptions(
  editCommand.command("policy <appName> <policyName>").description("Edit one existing application policy"),
  "json, yaml"
)
  .option("--editor <command>", "Editor command to launch")
  .action(handleEditPolicy);

addAuthOptions(
  configCommand.command("view <appName>").description("Show override config by environment or policy name"),
  "json, yaml"
)
  .option("--env <envName>", "Resolve the override policy by envName")
  .option("--policy <policyName>", "Fetch a specific policy by name")
  .action(handleConfigView);

addAuthOptions(
  getCommand.command("revisions <appName>").description("List application deployment revisions"),
).action(handleGetRevisions);

addAuthOptions(
  getCommand.command("envs").description("List environments"),
).action(handleGetEnvs);

addAuthOptions(
  getCommand.command("definitions").description("List available definitions"),
).action(handleGetDefinitions);

addAuthOptions(
  getCommand.command("addons").description("List enabled addons"),
).action(handleGetAddons);

addAuthOptions(
  getCommand.command("system-info").description("Show Vela system version info"),
  "json, yaml"
).action(handleGetSystemInfo);

addAuthOptions(
  getCommand.command("raw <apiPath>").description("Run a read-only GET request against a captured API path"),
  "json, yaml"
).action(handleGetRaw);

addAuthOptions(
  program.command("apply").description("Apply one policy manifest from YAML"),
  "json, yaml"
)
  .requiredOption("-f, --filename <path>", "YAML file to apply, or - for stdin")
  .option("--app <appName>", "Application name when the manifest omits metadata.application")
  .action(handleApply);

program.parseAsync(process.argv).catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
