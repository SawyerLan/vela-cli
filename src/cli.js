#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { Command } = require("commander");
const YAML = require("yaml");
const { runCapture, DEFAULT_BASE_URL, DEFAULT_LOGIN_PATH } = require("./capture");
const { VelaClient } = require("./api");

const OUTPUT_FORMATS = new Set(["table", "json", "yaml"]);
const AUTH_VALUE_OPTIONS = new Set([
  "--base-url",
  "--login-path",
  "-o",
  "--output",
  "--env",
  "--policy",
  "--type",
]);

const TOP_LEVEL_COMMANDS = ["capture", "endpoints", "get", "describe", "config", "completion", "help"];
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
  config: ["view"],
};

const COMMAND_OPTIONS = {
  capture: ["--base-url", "--login-path", "--headed"],
  endpoints: [],
  completion: [],
  get: [],
  describe: [],
  config: [],
  "get me": ["--base-url", "--login-path", "-o", "--output", "--json"],
  "get projects": ["--base-url", "--login-path", "-o", "--output", "--json"],
  "get apps": ["--base-url", "--login-path", "-o", "--output", "--json"],
  "get app": ["--base-url", "--login-path", "-o", "--output", "--json"],
  "get components": ["--base-url", "--login-path", "-o", "--output", "--json"],
  "get policies": [
    "--base-url",
    "--login-path",
    "-o",
    "--output",
    "--json",
    "--all",
    "--type",
  ],
  "get policy": ["--base-url", "--login-path", "-o", "--output", "--json"],
  "get revisions": ["--base-url", "--login-path", "-o", "--output", "--json"],
  "get envs": ["--base-url", "--login-path", "-o", "--output", "--json"],
  "get definitions": ["--base-url", "--login-path", "-o", "--output", "--json"],
  "get addons": ["--base-url", "--login-path", "-o", "--output", "--json"],
  "get system-info": ["--base-url", "--login-path", "-o", "--output", "--json"],
  "get raw": ["--base-url", "--login-path", "-o", "--output", "--json"],
  "describe app": ["--base-url", "--login-path", "-o", "--output", "--json"],
  "describe policy": ["--base-url", "--login-path", "-o", "--output", "--json"],
  "config view": [
    "--base-url",
    "--login-path",
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
    .option("-o, --output <format>", `Output format: ${outputFormats}`)
    .option("--json", "Alias for --output json", false);
}

function buildClient(options) {
  return new VelaClient({
    baseUrl: options.baseUrl,
    loginPath: options.loginPath,
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

async function getDynamicCompletions(context) {
  const client = buildClientFromParsedAuth(context.auth);

  if (!client.username || !client.password) {
    return [];
  }

  if (
    ["get app", "describe app", "get components", "get policies", "get revisions", "config view"].includes(
      context.commandKey,
    )
  ) {
    if (context.positionals.length === 0 && context.previous !== "--env" && context.previous !== "--policy") {
      return getApplicationNames(client);
    }
  }

  if (["get policy", "describe policy"].includes(context.commandKey)) {
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

const program = new Command();

program
  .name("vela-cli")
  .description("Read-only Vela request inspector with kubectl-style subcommands");

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

const getCommand = program.command("get").description("List resources or fetch a single resource");
const describeCommand = program.command("describe").description("Show detailed resource information");
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

program.parseAsync(process.argv).catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
