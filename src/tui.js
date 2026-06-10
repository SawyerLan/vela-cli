const blessed = require("blessed");
const YAML = require("yaml");
const { VelaClient } = require("./api");
const { deployApplication, isDeployConflictError, resolveDeployWorkflowName } = require("./deploy");
const unicode = blessed.unicode || require("blessed/lib/unicode");

const RESOURCE_ORDER = ["apps", "projects", "envs", "definitions", "addons"];

const ROOT_RESOURCE_DEFINITIONS = {
  apps: {
    label: "Apps",
    columns: [
      { title: "NAME", width: 24, minWidth: 24, maxWidth: 64, growPriority: 4, value: (item) => item.name || "" },
      { title: "PROJECT", width: 16, minWidth: 12, maxWidth: 24, growPriority: 2, value: (item) => item.project?.name || "" },
      { title: "ALIAS", width: 10, minWidth: 6, maxWidth: 14, growPriority: 1, value: (item) => item.alias || "" },
      { title: "UPDATED", width: 12, minWidth: 8, maxWidth: 16, growPriority: 0, value: (item) => item.updateTime || "" },
    ],
    getId: (item) => item.name || "",
    getSearchText: (item) =>
      [item.name, item.alias, item.project?.name, item.description, item.updateTime].filter(Boolean).join(" "),
    loadItems: async (client) => {
      const data = await client.getJson("/api/v1/applications");
      return data.applications || [];
    },
    describeItem: describeApp,
  },
  projects: {
    label: "Projects",
    columns: [
      { title: "NAME", width: 24, value: (item) => item.name || "" },
      { title: "ALIAS", width: 18, value: (item) => item.alias || "" },
      { title: "OWNER", width: 20, value: (item) => item.owner?.name || "" },
      { title: "ROLES", width: 24, value: (item) => (item.roles || []).map((role) => role.name).join(",") },
    ],
    getId: (item) => item.name || "",
    getSearchText: (item) =>
      [item.name, item.alias, item.owner?.name, (item.roles || []).map((role) => role.name).join(" ")]
        .filter(Boolean)
        .join(" "),
    loadItems: async (client) => {
      const data = await client.getJson("/api/v1/auth/user_info");
      return data.projects || [];
    },
    describeItem: async (client, item) => item,
  },
  envs: {
    label: "Envs",
    columns: [
      { title: "NAME", width: 24, value: (item) => item.name || "" },
      { title: "PROJECT", width: 18, value: (item) => item.project?.name || "" },
      { title: "NAMESPACE", width: 22, value: (item) => item.namespace || "" },
      { title: "TARGETS", width: 22, value: (item) => (item.targets || []).map((target) => target.name).join(",") },
    ],
    getId: (item) => item.name || "",
    getSearchText: (item) =>
      [item.name, item.project?.name, item.namespace, (item.targets || []).map((item) => item.name).join(" ")]
        .filter(Boolean)
        .join(" "),
    loadItems: async (client) => {
      const data = await client.getJson("/api/v1/envs");
      return data.envs || [];
    },
    describeItem: async (client, item) => item,
  },
  definitions: {
    label: "Definitions",
    columns: [
      { title: "NAME", width: 26, value: (item) => item.name || "" },
      { title: "TYPE", width: 18, value: (item) => item.workloadType || "" },
      { title: "STATUS", width: 16, value: (item) => item.status || "" },
      { title: "ADDON", width: 20, value: (item) => item.ownerAddon || "" },
    ],
    getId: (item) => item.name || "",
    getSearchText: (item) => [item.name, item.workloadType, item.status, item.ownerAddon].filter(Boolean).join(" "),
    loadItems: async (client) => {
      const data = await client.getJson("/api/v1/definitions");
      return data.definitions || [];
    },
    describeItem: async (client, item) => item,
  },
  addons: {
    label: "Addons",
    columns: [
      { title: "NAME", width: 28, value: (item) => item.name || "" },
      { title: "PHASE", width: 16, value: (item) => item.phase || "" },
      { title: "DESCRIPTION", width: 34, value: (item) => item.description || "" },
    ],
    getId: (item) => item.name || "",
    getSearchText: (item) => [item.name, item.phase, item.description].filter(Boolean).join(" "),
    loadItems: async (client) => {
      const data = await client.getJson("/api/v1/enabled_addon");
      return data.enabledAddons || [];
    },
    describeItem: async (client, item) => item,
  },
};

const POLICY_COLUMNS = [
  { title: "NAME", width: 26, value: (item) => item.name || "" },
  { title: "TYPE", width: 18, value: (item) => item.type || "" },
  { title: "ENV", width: 18, value: (item) => item.envName || "" },
  { title: "UPDATED", width: 19, value: (item) => item.updateTime || "" },
];

const RESOURCE_COMMAND_ALIASES = {
  apps: ["apps", "app", "a"],
  projects: ["projects", "project", "proj", "prj"],
  envs: ["envs", "env", "e"],
  definitions: ["definitions", "definition", "defs", "def"],
  addons: ["addons", "addon", "add", "ao"],
  policies: ["policies", "policy", "po"],
};

const RESOURCE_COMMAND_LOOKUP = Object.entries(RESOURCE_COMMAND_ALIASES).reduce((lookup, [resourceKey, aliases]) => {
  for (const alias of aliases) {
    lookup[alias] = resourceKey;
  }
  return lookup;
}, Object.create(null));

function summarizeError(error) {
  if (!error) {
    return "Unknown error";
  }

  if (typeof error === "string") {
    return error;
  }

  return error.message || String(error);
}

function truncateCell(value, width) {
  const text = value == null ? "" : String(value);
  if (!width || unicode.strWidth(text) <= width) {
    return text;
  }

  if (width <= 3) {
    return sliceByDisplayWidth(text, width);
  }

  return `${sliceByDisplayWidth(text, width - 3)}...`;
}

function sliceByDisplayWidth(text, maxWidth) {
  if (!text || maxWidth <= 0) {
    return "";
  }

  let output = "";
  let width = 0;

  for (let index = 0; index < text.length; index += 1) {
    const charWidth = unicode.charWidth(text, index);
    const nextChar = unicode.isSurrogate(text, index) ? text.slice(index, index + 2) : text[index];

    if (width + charWidth > maxWidth) {
      break;
    }

    output += nextChar;
    width += charWidth;

    if (unicode.isSurrogate(text, index)) {
      index += 1;
    }
  }

  return output;
}

function padDisplayWidth(value, width) {
  const text = value == null ? "" : String(value);
  const visibleText = text.replace(/\{\/?[^}]+\}/g, "");
  const displayWidth = unicode.strWidth(visibleText);
  if (displayWidth >= width) {
    return text;
  }

  return `${text}${" ".repeat(width - displayWidth)}`;
}

function wrapLineByDisplayWidth(text, maxWidth) {
  const input = String(text == null ? "" : text).replace(/\t/g, "  ");
  if (!input || maxWidth <= 0) {
    return [""];
  }

  const output = [];
  let current = "";
  let currentWidth = 0;

  for (let index = 0; index < input.length; index += 1) {
    const charWidth = unicode.charWidth(input, index);
    const nextChar = unicode.isSurrogate(input, index) ? input.slice(index, index + 2) : input[index];

    if (currentWidth > 0 && currentWidth + charWidth > maxWidth) {
      output.push(current);
      current = "";
      currentWidth = 0;
    }

    current += nextChar;
    currentWidth += charWidth;

    if (unicode.isSurrogate(input, index)) {
      index += 1;
    }
  }

  if (current || output.length === 0) {
    output.push(current);
  }

  return output;
}

function wrapTextByDisplayWidth(text, maxWidth) {
  return String(text == null ? "" : text)
    .split("\n")
    .flatMap((line) => wrapLineByDisplayWidth(line, maxWidth))
    .join("\n");
}

function getColumnRenderWidth(column) {
  return column.renderWidth || column.width || unicode.strWidth(column.title || "");
}

function getColumnMinWidth(column) {
  const titleWidth = unicode.strWidth(column.title || "");
  const configuredMinWidth = column.minWidth == null ? 0 : column.minWidth;
  const preferredWidth = column.width == null ? 0 : column.width;
  return Math.max(configuredMinWidth, Math.min(titleWidth, preferredWidth) || titleWidth || 1);
}

function getColumnContentWidth(column, items) {
  const titleWidth = unicode.strWidth(column.title || "");
  const valueWidth = items.reduce((maxWidth, item) => {
    const cellValue = typeof column.value === "function" ? column.value(item) : "";
    return Math.max(maxWidth, unicode.strWidth(String(cellValue == null ? "" : cellValue)));
  }, titleWidth);
  const maxWidth = column.maxWidth == null ? valueWidth : column.maxWidth;
  return Math.max(getColumnMinWidth(column), Math.min(valueWidth, maxWidth));
}

function resolveColumnWidths(columns, items, tableWidth) {
  if (!Array.isArray(columns) || columns.length === 0) {
    return [];
  }

  const safeTableWidth = Number.isFinite(tableWidth) ? tableWidth : 0;
  const availableContentWidth = Math.max(
    safeTableWidth - columns.length - 3,
    columns.reduce((sum, column) => sum + getColumnMinWidth(column), 0),
  );
  const desiredWidths = columns.map((column) => getColumnContentWidth(column, items));
  const widths = columns.map((column) => getColumnMinWidth(column));
  let remainingWidth = availableContentWidth - widths.reduce((sum, width) => sum + width, 0);

  const growthOrder = columns
    .map((column, index) => ({
      index,
      growPriority: column.growPriority == null ? 1 : column.growPriority,
    }))
    .sort((left, right) => right.growPriority - left.growPriority || left.index - right.index);

  for (const entry of growthOrder) {
    if (remainingWidth <= 0) {
      break;
    }

    const desiredGrowth = desiredWidths[entry.index] - widths[entry.index];
    if (desiredGrowth <= 0) {
      continue;
    }

    const grantedGrowth = Math.min(desiredGrowth, remainingWidth);
    widths[entry.index] += grantedGrowth;
    remainingWidth -= grantedGrowth;
  }

  if (remainingWidth > 0) {
    widths[0] += remainingWidth;
  }

  return columns.map((column, index) => ({
    ...column,
    renderWidth: widths[index],
  }));
}

function buildHeaderStatusLine(text, width) {
  const lineWidth = Math.max(width || 0, 1);
  const label = "{yellow-fg}State:{/yellow-fg} ";
  const visibleLabelWidth = unicode.strWidth("State: ");
  const messageWidth = Math.max(lineWidth - visibleLabelWidth, 1);
  const message = truncateCell(text || "Ready", messageWidth);
  const baseLine = `${label}${message}`;
  const visibleBaseWidth = unicode.strWidth(`State: ${message}`);

  if (visibleBaseWidth >= lineWidth) {
    return baseLine;
  }

  return `${baseLine}{cyan-fg}${"-".repeat(lineWidth - visibleBaseWidth)}{/cyan-fg}`;
}

function stringifyDetail(value, format) {
  if (format === "json") {
    return JSON.stringify(value, null, 2);
  }

  return YAML.stringify(value, { indent: 2 }).trimEnd();
}

function buildRows(columns, items) {
  const header = columns.map((column) =>
    padDisplayWidth(truncateCell(column.title, getColumnRenderWidth(column)), getColumnRenderWidth(column)),
  );
  const rows = items.map((item) =>
    columns.map((column) =>
      padDisplayWidth(truncateCell(column.value(item), getColumnRenderWidth(column)), getColumnRenderWidth(column)),
    ),
  );
  return [header, ...rows];
}

function buildPlaceholderRow(columns, message) {
  return columns.map((column, index) =>
    index === 0
      ? padDisplayWidth(truncateCell(message, getColumnRenderWidth(column)), getColumnRenderWidth(column))
      : padDisplayWidth("", getColumnRenderWidth(column)),
  );
}

function extractContextLabel(baseUrl) {
  try {
    return new URL(baseUrl).host;
  } catch (error) {
    return baseUrl;
  }
}

function normalizeLabelEntries(item) {
  if (!item || !item.labels || typeof item.labels !== "object" || Array.isArray(item.labels)) {
    return [];
  }

  return Object.entries(item.labels).map(([key, value]) => [String(key), value == null ? "" : String(value)]);
}

function getItemSearchText(view, item) {
  const labelText = normalizeLabelEntries(item)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");

  return [view.getSearchText(item), labelText].filter(Boolean).join(" ");
}

function isFuzzySubsequence(needle, haystack) {
  let searchIndex = 0;
  for (const character of needle) {
    searchIndex = haystack.indexOf(character, searchIndex);
    if (searchIndex === -1) {
      return false;
    }
    searchIndex += 1;
  }
  return true;
}

function fuzzyIncludes(needle, haystack) {
  const normalizedNeedle = String(needle || "")
    .toLowerCase()
    .replace(/\s+/g, "");
  const normalizedHaystack = String(haystack || "")
    .toLowerCase()
    .replace(/\s+/g, "");

  if (!normalizedNeedle) {
    return true;
  }

  return isFuzzySubsequence(normalizedNeedle, normalizedHaystack);
}

function matchLabelSelector(item, selector) {
  const entries = normalizeLabelEntries(item);
  if (entries.length === 0) {
    return false;
  }

  const selectors = String(selector || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (selectors.length === 0) {
    return false;
  }

  return selectors.every((part) => {
    const [rawKey, ...rawValueParts] = part.split("=");
    const key = rawKey.trim().toLowerCase();
    if (!key) {
      return false;
    }

    if (rawValueParts.length === 0) {
      return entries.some(([entryKey]) => entryKey.toLowerCase() === key);
    }

    const expectedValue = rawValueParts.join("=").trim().toLowerCase();
    return entries.some(
      ([entryKey, entryValue]) =>
        entryKey.toLowerCase() === key && String(entryValue || "").toLowerCase() === expectedValue,
    );
  });
}

function buildFilterMatcher(rawFilter) {
  const filter = String(rawFilter || "").trim();
  if (!filter) {
    return null;
  }

  if (filter.startsWith("-f ")) {
    const needle = filter.slice(3).trim();
    if (!needle) {
      throw new Error("Fuzzy filters need text after -f.");
    }

    return {
      mode: "fuzzy",
      matches: (view, item) => fuzzyIncludes(needle, getItemSearchText(view, item)),
    };
  }

  if (filter.startsWith("-l ")) {
    const selector = filter.slice(3).trim();
    if (!selector) {
      throw new Error("Label filters need a selector after -l.");
    }

    return {
      mode: "labels",
      matches: (view, item) => matchLabelSelector(item, selector),
    };
  }

  const inverse = filter.startsWith("!");
  const pattern = inverse ? filter.slice(1).trim() : filter;
  if (!pattern) {
    throw new Error("Regex filters cannot be empty.");
  }

  const regex = new RegExp(pattern, "i");
  return {
    mode: inverse ? "inverse-regex" : "regex",
    matches: (view, item) => {
      const matched = regex.test(getItemSearchText(view, item));
      return inverse ? !matched : matched;
    },
  };
}

function resolveResourceCommand(token) {
  if (!token) {
    return null;
  }

  return RESOURCE_COMMAND_LOOKUP[String(token).toLowerCase()] || null;
}

function normalizeResourceKey(resourceKey) {
  if (!resourceKey) {
    return "apps";
  }

  const key = String(resourceKey).toLowerCase();
  if (!ROOT_RESOURCE_DEFINITIONS[key]) {
    throw new Error(`Unsupported resource '${resourceKey}'. Use one of: ${RESOURCE_ORDER.join(", ")}.`);
  }

  return key;
}

function isDeployableView(view) {
  return view.kind === "app-policies";
}

async function fetchApplications(client) {
  const data = await client.getJson("/api/v1/applications");
  return data.applications || [];
}

async function fetchPolicies(client, appName) {
  const data = await client.getJson(`/api/v1/applications/${encodeURIComponent(appName)}/policies`);
  return data.policies || [];
}

async function describeApp(client, item) {
  const appName = encodeURIComponent(item.name);
  const [application, components, policies, revisions] = await Promise.allSettled([
    client.getJson(`/api/v1/applications/${appName}`),
    client.getJson(`/api/v1/applications/${appName}/components`),
    client.getJson(`/api/v1/applications/${appName}/policies`),
    client.getJson(`/api/v1/applications/${appName}/revisions`),
  ]);

  if (application.status !== "fulfilled") {
    throw application.reason;
  }

  const app = application.value;
  return {
    summary: {
      name: app.name,
      alias: app.alias,
      project: app.project?.name,
      description: app.description,
      updateTime: app.updateTime,
      labels: app.labels,
      envBindings: app.envBindings,
      resourceInfo: app.resourceInfo,
    },
    components:
      components.status === "fulfilled"
        ? (components.value.components || []).map((entry) => ({
            name: entry.name,
            type: entry.componentType,
            workload: entry.workloadType?.type || "",
            main: Boolean(entry.main),
            updateTime: entry.updateTime,
          }))
        : { error: summarizeError(components.reason) },
    policies:
      policies.status === "fulfilled"
        ? (policies.value.policies || []).map((entry) => ({
            name: entry.name,
            type: entry.type,
            envName: entry.envName,
            alias: entry.alias,
            updateTime: entry.updateTime,
          }))
        : { error: summarizeError(policies.reason) },
    revisions:
      revisions.status === "fulfilled"
        ? (revisions.value.revisions || []).slice(0, 15).map((entry) => ({
            version: entry.version,
            envName: entry.envName,
            status: entry.status,
            deployUser: entry.deployUser?.name || "",
            createTime: entry.createTime,
          }))
        : { error: summarizeError(revisions.reason) },
  };
}

function createRootView(resourceKey) {
  const definition = ROOT_RESOURCE_DEFINITIONS[resourceKey];
  return {
    id: `root:${resourceKey}`,
    kind: "root",
    rootResource: resourceKey,
    label: definition.label,
    breadcrumb: definition.label,
    columns: definition.columns,
    getId: definition.getId,
    getSearchText: definition.getSearchText,
    loadItems: definition.loadItems,
    describeItem: definition.describeItem,
    canEnter: resourceKey === "projects" || resourceKey === "apps",
    enterItem: (item) => {
      if (resourceKey === "projects") {
        return createProjectAppsView(item);
      }
      if (resourceKey === "apps") {
        return createAppPoliciesView(item, { rootResource: "apps" });
      }
      return null;
    },
  };
}

function createProjectAppsView(project) {
  return {
    id: `project-apps:${project.name}`,
    kind: "project-apps",
    rootResource: "projects",
    label: `Apps / ${project.name}`,
    breadcrumb: `Projects > ${project.name} > Apps`,
    columns: ROOT_RESOURCE_DEFINITIONS.apps.columns,
    getId: ROOT_RESOURCE_DEFINITIONS.apps.getId,
    getSearchText: ROOT_RESOURCE_DEFINITIONS.apps.getSearchText,
    loadItems: async (client) => {
      const items = await fetchApplications(client);
      return items.filter((item) => item.project?.name === project.name);
    },
    describeItem: describeApp,
    canEnter: true,
    enterItem: (item) =>
      createAppPoliciesView(item, {
        rootResource: "projects",
        breadcrumbPrefix: `Projects > ${project.name}`,
      }),
    scope: {
      projectName: project.name,
      projectAlias: project.alias || "",
      owner: project.owner?.name || "",
      roles: (project.roles || []).map((role) => role.name).join(", "),
    },
  };
}

function createAppPoliciesView(app, options = {}) {
  const projectName = options.projectName || app.project?.name || "";
  const breadcrumbPrefix = options.breadcrumbPrefix || "Apps";

  return {
    id: `app-policies:${options.rootResource || "apps"}:${projectName}:${app.name}`,
    kind: "app-policies",
    rootResource: options.rootResource || "apps",
    label: `Policies / ${app.name}`,
    breadcrumb: `${breadcrumbPrefix} > ${app.name} > Policies`,
    columns: POLICY_COLUMNS,
    getId: (item) => item.name || "",
    getSearchText: (item) => [item.name, item.type, item.envName, item.alias, item.updateTime].filter(Boolean).join(" "),
    loadItems: async (client) => {
      const policies = await fetchPolicies(client, app.name);
      return policies.filter((item) => item.type === "override");
    },
    describeItem: async (client, item) =>
      client.getJson(
        `/api/v1/applications/${encodeURIComponent(app.name)}/policies/${encodeURIComponent(item.name)}`,
      ),
    canEnter: false,
    enterItem: () => null,
    scope: {
      appName: app.name,
      appAlias: app.alias || "",
      projectName,
      updateTime: app.updateTime || "",
    },
  };
}

function buildResumeState(viewStack, filterByViewId, selectedIdByViewId) {
  return {
    stack: viewStack.map((view) => {
      if (view.kind === "root") {
        return {
          kind: "root",
          rootResource: view.rootResource,
        };
      }

      if (view.kind === "project-apps") {
        return {
          kind: "project-apps",
          projectName: view.scope?.projectName || "",
          projectAlias: view.scope?.projectAlias || "",
          owner: view.scope?.owner || "",
          roles: view.scope?.roles || "",
        };
      }

      if (view.kind === "app-policies") {
        return {
          kind: "app-policies",
          rootResource: view.rootResource || "apps",
          appName: view.scope?.appName || "",
          appAlias: view.scope?.appAlias || "",
          projectName: view.scope?.projectName || "",
          updateTime: view.scope?.updateTime || "",
        };
      }

      return null;
    }).filter(Boolean),
    filters: { ...filterByViewId },
    selectedIds: { ...selectedIdByViewId },
  };
}

function restoreViewStackFromResumeState(resumeState, fallbackResource) {
  const stack = Array.isArray(resumeState?.stack) ? resumeState.stack : [];
  if (stack.length === 0) {
    return [createRootView(fallbackResource)];
  }

  return stack.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      return index === 0 ? createRootView(fallbackResource) : null;
    }

    if (entry.kind === "root") {
      return createRootView(normalizeResourceKey(entry.rootResource || fallbackResource));
    }

    if (entry.kind === "project-apps") {
      return createProjectAppsView({
        name: entry.projectName || "",
        alias: entry.projectAlias || "",
        owner: { name: entry.owner || "" },
        roles: String(entry.roles || "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
          .map((name) => ({ name })),
      });
    }

    if (entry.kind === "app-policies") {
      const rootResource = normalizeResourceKey(entry.rootResource || fallbackResource);
      return createAppPoliciesView(
        {
          name: entry.appName || "",
          alias: entry.appAlias || "",
          updateTime: entry.updateTime || "",
          project: { name: entry.projectName || "" },
        },
        {
          rootResource,
          projectName: entry.projectName || "",
          breadcrumbPrefix: rootResource === "projects" ? `Projects > ${entry.projectName || ""}` : "Apps",
        },
      );
    }

    return null;
  }).filter(Boolean);
}

async function runTui(options = {}) {
  const initialResource = normalizeResourceKey(options.resource);
  const client = new VelaClient({
    baseUrl: options.baseUrl,
    loginPath: options.loginPath,
    token: options.token,
    username: options.username,
    password: options.password,
  });

  await client.login();

  const screenOptions = {
    smartCSR: true,
    fullUnicode: true,
    forceUnicode: true,
    title: "vela-cli tui",
  };

  const screen = blessed.screen(screenOptions);
  let isFinished = false;
  let finishRun = () => {};
  const completion = new Promise((resolve) => {
    finishRun = resolve;
  });

  const state = {
    viewStack: restoreViewStackFromResumeState(options.resumeState, initialResource),
    itemsByViewId: Object.create(null),
    selectedIdByViewId: Object.create(null),
    filterByViewId: Object.create(null),
    describeCache: new Map(),
    describeFormat: "yaml",
    headerUser: "",
    lastUpdated: "",
    statusText: "Ready",
    currentVisibleItems: [],
    suppressSelectionEvent: false,
    inputMode: null,
    pendingDeploy: null,
  };

  if (options.resumeState?.filters && typeof options.resumeState.filters === "object") {
    Object.assign(state.filterByViewId, options.resumeState.filters);
  }
  if (options.resumeState?.selectedIds && typeof options.resumeState.selectedIds === "object") {
    Object.assign(state.selectedIdByViewId, options.resumeState.selectedIds);
  }

  function finish(action = { type: "quit" }) {
    if (isFinished) {
      return;
    }
    isFinished = true;
    screen.destroy();
    finishRun(action);
  }

  const header = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: "100%",
    height: 8,
    tags: true,
    style: {
      bg: "#1b1625",
      fg: "white",
    },
  });

  const headerLeft = blessed.box({
    parent: header,
    top: 0,
    left: 0,
    width: "30%",
    height: 7,
    tags: true,
    style: {
      bg: "#1b1625",
      fg: "white",
    },
  });

  const headerCenter = blessed.box({
    parent: header,
    top: 0,
    left: "30%",
    width: "50%",
    height: 7,
    tags: true,
    style: {
      bg: "#1b1625",
      fg: "white",
    },
  });

  const headerRight = blessed.box({
    parent: header,
    top: 0,
    right: 0,
    width: "20%",
    height: 7,
    tags: true,
    align: "center",
    valign: "middle",
    style: {
      bg: "#1b1625",
      fg: "yellow",
    },
  });

  const headerDivider = blessed.box({
    parent: header,
    bottom: 0,
    left: 0,
    width: "100%",
    height: 1,
    tags: true,
    style: {
      bg: "#1b1625",
      fg: "cyan",
    },
  });

  const searchInput = blessed.textbox({
    parent: screen,
    top: 5,
    left: 0,
    width: "100%",
    height: 3,
    hidden: true,
    border: "line",
    inputOnFocus: false,
    keys: true,
    tags: true,
    style: {
      border: { fg: "yellow" },
    },
  });

  const resourceTable = blessed.listtable({
    parent: screen,
    top: 8,
    left: 0,
    width: "100%",
    height: "100%-8",
    keys: true,
    vi: true,
    tags: true,
    border: "line",
    align: "left",
    noCellBorders: true,
    style: {
      border: { fg: "green" },
      header: { fg: "brightwhite", bold: true },
      cell: {
        fg: "white",
        selected: { fg: "black", bg: "green", bold: true },
      },
    },
  });

  const help = blessed.box({
    parent: screen,
    top: "center",
    left: "center",
    width: "72%",
    height: 21,
    hidden: true,
    border: "line",
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    vi: true,
    label: " Help ",
    content: [
      "{bold}vela-cli tui{/bold}",
      "",
      "k9s-style command mode:",
      "  :a or :apps                switch to apps",
      "  :prj or :projects          switch to projects",
      "  :e or :envs                switch to envs",
      "  :def or :definitions       switch to definitions",
      "  :ao or :addons             switch to addons",
      "  :po <app>                  open policies for an app",
      "  :apps /query               switch resource and apply a filter",
      "  :q                         quit",
      "",
      "k9s-style filter mode:",
      "  /regex                     regex filter",
      "  /! regex                   inverse regex filter",
      "  /-f text                   fuzzy find",
      "  /-l key=value              label selector",
      "",
      "Other keys:",
      "  [1-5] switch resources",
      "  [tab] / [shift-tab] next or previous resource",
      "  [up/down] or [j/k] move selection",
      "  [enter] drill down into the selected row",
      "  [d] describe the selected row",
      "  [p] deploy the selected policy after confirmation",
      "  [e] edit the selected policy (policies view only)",
      "  [esc] / [left] / [backspace] go back one level",
      "  [y] toggle describe format between YAML and JSON",
      "  [r] refresh the current view",
      "  [?] toggle this help dialog",
      "  [q] quit",
      "",
      "Projects -> Apps -> Policies is the main navigation path.",
    ].join("\n"),
    tags: true,
    style: {
      border: { fg: "cyan" },
    },
  });

  const modal = blessed.box({
    parent: screen,
    top: 1,
    left: 2,
    width: "100%-4",
    height: "100%-2",
    hidden: true,
    border: "line",
    label: " Describe ",
    scrollable: true,
    alwaysScroll: true,
    wrap: false,
    keys: true,
    vi: true,
    scrollbar: {
      ch: " ",
      inverse: true,
    },
    style: {
      border: { fg: "yellow" },
    },
  });

  const confirmBox = blessed.box({
    parent: screen,
    top: "center",
    left: "center",
    width: "64%",
    height: 12,
    hidden: true,
    border: "line",
    label: " Deploy Confirm ",
    tags: true,
    keys: true,
    vi: true,
    style: {
      border: { fg: "red" },
    },
  });

  function getCurrentView() {
    return state.viewStack[state.viewStack.length - 1];
  }

  function getViewItems(view = getCurrentView()) {
    return state.itemsByViewId[view.id] || [];
  }

  function getViewFilter(view = getCurrentView()) {
    return state.filterByViewId[view.id] || "";
  }

  function getSelectedId(view = getCurrentView()) {
    return state.selectedIdByViewId[view.id] || null;
  }

  function setStatus(text) {
    state.statusText = text;
    renderTopBar();
  }

  function isInputActive() {
    return state.inputMode !== null && !searchInput.hidden;
  }

  function hasOpenOverlay() {
    return isInputActive() || !help.hidden || !modal.hidden || !confirmBox.hidden;
  }

  function getVisibleItems(view = getCurrentView()) {
    const filter = getViewFilter(view).trim();
    const items = getViewItems(view);
    const matcher = buildFilterMatcher(filter);

    if (!matcher) {
      return items;
    }

    return items.filter((item) => matcher.matches(view, item));
  }

  function ensureSelectedId(view = getCurrentView()) {
    const visibleItems = getVisibleItems(view);
    const currentId = getSelectedId(view);
    const matched = visibleItems.find((item) => view.getId(item) === currentId);

    if (matched) {
      return currentId;
    }

    const nextId = visibleItems[0] ? view.getId(visibleItems[0]) : null;
    state.selectedIdByViewId[view.id] = nextId;
    return nextId;
  }

  function getCurrentSelection() {
    const view = getCurrentView();
    const selectedId = ensureSelectedId(view);
    return state.currentVisibleItems.find((item) => view.getId(item) === selectedId) || null;
  }

  function renderHeader() {
    renderTopBar();
  }

  function renderTabs() {
    renderTopBar();
  }

  function renderFooter() {
  }

  function renderSearchBar() {
    renderTopBar();
  }

  function openModal(label, content) {
    const modalWidth = modal.width && Number.isFinite(Number(modal.width)) ? Number(modal.width) : (screen.width || 1) - 4;
    const contentWidth = Math.max(modalWidth - 4, 1);
    modal.setLabel(` ${label} `);
    modal.show();
    modal.focus();
    modal.setContent(wrapTextByDisplayWidth(content, contentWidth));
    modal.setScroll(0);
    screen.render();
  }

  function closeConfirmBox() {
    state.pendingDeploy = null;
    confirmBox.hide();
    resourceTable.focus();
    screen.render();
  }

  function openDeployConfirm(pendingDeploy) {
    state.pendingDeploy = pendingDeploy;
    const isForceRestart = Boolean(pendingDeploy.force);
    confirmBox.setLabel(isForceRestart ? " Force Restart Confirm " : " Deploy Confirm ");
    confirmBox.setContent(
      isForceRestart
        ? [
            "{bold}Workflow is executing. Do you want to force a restart?{/bold}",
            "",
            `Application: ${pendingDeploy.appName}`,
            `Policy: ${pendingDeploy.policyName}`,
            `Workflow: ${pendingDeploy.workflowName}`,
            `Env: ${pendingDeploy.envName || "<none>"}`,
            "",
            "Press [enter] or [y] to force restart, [esc] or [n] to cancel.",
          ].join("\n")
        : [
            "{bold}Confirm deployment{/bold}",
            "",
            `Application: ${pendingDeploy.appName}`,
            `Policy: ${pendingDeploy.policyName}`,
            `Workflow: ${pendingDeploy.workflowName}`,
            `Env: ${pendingDeploy.envName || "<none>"}`,
            "",
            "Press [enter] or [y] to deploy, [esc] or [n] to cancel.",
          ].join("\n"),
    );
    confirmBox.show();
    confirmBox.focus();
    screen.render();
  }

  function renderTopBar() {
    if (isInputActive()) {
      return;
    }

    const currentView = getCurrentView();
    const selectedItem = getCurrentSelection();
    const currentRoot = currentView.rootResource;
    const contextLabel = truncateCell(extractContextLabel(client.baseUrl), 28);
    const userLabel = truncateCell(state.headerUser || "<unknown>", 24);
    const selectedLabel = selectedItem ? currentView.getId(selectedItem) : "<none>";
    const filter = getViewFilter(currentView);
    const filterLabel = filter ? `/${filter}` : "<none>";
    const totalCount = getViewItems(currentView).length;
    const dividerWidth = Math.max((screen.width || 1) - 1, 1);
    const rootEntries = RESOURCE_ORDER.map((resourceKey, index) => {
      const shortcut = `{magenta-fg}<${index + 1}>{/magenta-fg}`;
      const count = (state.itemsByViewId[`root:${resourceKey}`] || []).length;
      const label = `${resourceKey}`;
      if (resourceKey === currentRoot) {
        return `${shortcut} {cyan-fg}${label}{/cyan-fg}{white-fg}[${count}]{/white-fg}`;
      }
      return `${shortcut} ${label}`;
    });
    const actionEntries = [
      ["<:>", "Cmd"],
      ["</>", "Filter"],
      ["<enter>", "Open"],
      ["<esc>", "Back"],
      ["<d>", "Describe"],
      ...(isDeployableView(currentView) ? [["<p>", "Deploy"]] : []),
      ...(currentView.kind === "app-policies" ? [["<e>", "Edit"]] : []),
      ["<tab>", "Next"],
      ["<r>", "Refresh"],
      ["<y>", `Fmt ${state.describeFormat.toUpperCase()}`],
      ["<?>", "Help"],
      ["<q>", "Quit"],
      ["<1-5>", "Views"],
      ["<po>", "Policies"],
    ];
    const commandColumns = [[], [], [], []];

    rootEntries.forEach((entry, index) => {
      commandColumns[index % 4].push(entry);
    });
    actionEntries.forEach((entry, index) => {
      const [hotkey, label] = entry;
      commandColumns[index % 4].push(`{blue-fg}${hotkey}{/blue-fg} ${label}`);
    });

    const maxRows = Math.max(...commandColumns.map((column) => column.length));
    const centerLines = [];
    for (let rowIndex = 0; rowIndex < maxRows; rowIndex += 1) {
      const columns = commandColumns.map((column) => padDisplayWidth(column[rowIndex] || "", 18));
      centerLines.push(columns.join("  "));
    }

    headerLeft.setContent(
      [
        `{yellow-fg}Context:{/yellow-fg} ${contextLabel}`,
        `{yellow-fg}View:{/yellow-fg}    ${truncateCell(currentView.label, 24)}`,
        `{yellow-fg}User:{/yellow-fg}    ${userLabel}`,
        `{yellow-fg}Mode:{/yellow-fg}    ${state.describeFormat.toUpperCase()}`,
        `{yellow-fg}Rows:{/yellow-fg}    ${state.currentVisibleItems.length}/${totalCount}`,
        `{yellow-fg}Find:{/yellow-fg}    ${truncateCell(filterLabel, 24)}`,
        `{yellow-fg}Sel:{/yellow-fg}     ${truncateCell(selectedLabel, 24)}`,
      ].join("\n"),
    );

    headerCenter.setContent(centerLines.join("\n"));
    headerRight.setContent(
      [
        "{yellow-fg} _    ______{/yellow-fg}",
        "{yellow-fg}| |  / / __ \\/{/yellow-fg}",
        "{yellow-fg}| | / / /_/ /{/yellow-fg}",
        "{yellow-fg}| |/ / ____/ {/yellow-fg}",
        "{yellow-fg}|___/_/      {/yellow-fg}",
      ].join("\n"),
    );
    headerDivider.setContent(buildHeaderStatusLine(state.statusText, dividerWidth));
  }

  function renderTable() {
    const currentView = getCurrentView();
    state.currentVisibleItems = getVisibleItems(currentView);
    ensureSelectedId(currentView);

    const totalCount = getViewItems(currentView).length;
    const activeFilter = getViewFilter(currentView);
    const filterSuffix = activeFilter ? ` /${truncateCell(activeFilter, 18)}` : "";

    resourceTable.setLabel(` ${currentView.label} [${state.currentVisibleItems.length}/${totalCount}]${filterSuffix} `);
    state.suppressSelectionEvent = true;
    const renderColumns = resolveColumnWidths(currentView.columns, state.currentVisibleItems, resourceTable.width);
    const rows = buildRows(renderColumns, state.currentVisibleItems);
    if (state.currentVisibleItems.length === 0) {
      rows.push(
        buildPlaceholderRow(
          renderColumns,
          totalCount > 0 ? "No rows match the current filter." : "No rows available in this view.",
        ),
      );
    }
    resourceTable.setData(rows);

    const selectedId = getSelectedId(currentView);
    const selectedIndex = state.currentVisibleItems.findIndex((item) => currentView.getId(item) === selectedId);
    resourceTable.select(selectedIndex >= 0 ? selectedIndex + 1 : 1);
    state.suppressSelectionEvent = false;
    renderSearchBar();
  }

  async function refreshHeaderIdentity() {
    try {
      const data = await client.getJson("/api/v1/auth/user_info");
      state.headerUser = data.alias || data.name || data.email || "";
      renderHeader();
      screen.render();
    } catch (error) {
      state.headerUser = "";
    }
  }

  async function loadCurrentView(options = {}) {
    const { force = false } = options;
    const currentView = getCurrentView();
    const previousSelection = getSelectedId(currentView);
    setStatus(`Loading ${currentView.label.toLowerCase()}...`);
    screen.render();

    try {
      const items = await currentView.loadItems(client);
      state.itemsByViewId[currentView.id] = items;
      state.lastUpdated = new Date().toLocaleTimeString();

      if (!previousSelection || !items.some((item) => currentView.getId(item) === previousSelection)) {
        state.selectedIdByViewId[currentView.id] = items[0] ? currentView.getId(items[0]) : null;
      }

      if (force) {
        for (const key of Array.from(state.describeCache.keys())) {
          if (key.startsWith(`${currentView.id}:`)) {
            state.describeCache.delete(key);
          }
        }
      }

      renderHeader();
      renderTabs();
      renderTable();
      setStatus(`Loaded ${items.length} ${currentView.label.toLowerCase()}`);
      screen.render();
    } catch (error) {
      state.suppressSelectionEvent = true;
      resourceTable.setLabel(` ${currentView.label} `);
      resourceTable.setData([
        currentView.columns.map((column) => column.title),
        buildPlaceholderRow(currentView.columns, `Load failed: ${summarizeError(error)}`),
      ]);
      resourceTable.select(1);
      state.suppressSelectionEvent = false;
      state.currentVisibleItems = [];
      renderHeader();
      renderTabs();
      setStatus(`Load failed: ${summarizeError(error)}`);
      screen.render();
    }
  }

  async function switchRootResource(resourceKey) {
    const normalized = normalizeResourceKey(resourceKey);
    state.viewStack = [createRootView(normalized)];
    renderHeader();
    renderTabs();
    renderFooter();
    screen.render();

    if (!state.itemsByViewId[`root:${normalized}`]) {
      await loadCurrentView();
      return;
    }

    renderTable();
    setStatus(`Switched to ${ROOT_RESOURCE_DEFINITIONS[normalized].label.toLowerCase()}`);
    screen.render();
  }

  async function selectByOffset(offset) {
    const currentRoot = getCurrentView().rootResource;
    const currentIndex = RESOURCE_ORDER.indexOf(currentRoot);
    const nextIndex = (currentIndex + offset + RESOURCE_ORDER.length) % RESOURCE_ORDER.length;
    await switchRootResource(RESOURCE_ORDER[nextIndex]);
  }

  async function drillDown() {
    const currentView = getCurrentView();
    const selectedItem = getCurrentSelection();

    if (!selectedItem) {
      setStatus("Nothing selected.");
      screen.render();
      return;
    }

    if (!currentView.canEnter || typeof currentView.enterItem !== "function") {
      setStatus("This view has no deeper navigation.");
      screen.render();
      return;
    }

    const nextView = currentView.enterItem(selectedItem);
    if (!nextView) {
      setStatus("This row has no deeper navigation.");
      screen.render();
      return;
    }

    state.viewStack.push(nextView);
    renderHeader();
    renderTabs();
    renderFooter();
    screen.render();

    if (!state.itemsByViewId[nextView.id]) {
      await loadCurrentView();
      return;
    }

    renderTable();
    setStatus(`Opened ${nextView.label.toLowerCase()}`);
    screen.render();
  }

  async function goBack() {
    if (state.viewStack.length <= 1) {
      return;
    }

    state.viewStack.pop();
    renderHeader();
    renderTabs();
    renderTable();
    setStatus(`Back to ${getCurrentView().label.toLowerCase()}`);
    screen.render();
  }

  async function openDescribe(force = false) {
    const currentView = getCurrentView();
    const selectedItem = getCurrentSelection();
    if (!selectedItem) {
      setStatus("Nothing selected.");
      screen.render();
      return;
    }

    const cacheKey = `${currentView.id}:${state.describeFormat}:${currentView.getId(selectedItem)}`;
    openModal(`Describe: ${currentView.getId(selectedItem)} (${state.describeFormat.toUpperCase()})`, "Loading describe output...");

    if (!force && state.describeCache.has(cacheKey)) {
      openModal(`Describe: ${currentView.getId(selectedItem)} (${state.describeFormat.toUpperCase()})`, state.describeCache.get(cacheKey));
      return;
    }

    try {
      const described = await currentView.describeItem(client, selectedItem, currentView);
      const rendered = stringifyDetail(described, state.describeFormat);
      state.describeCache.set(cacheKey, rendered);
      openModal(`Describe: ${currentView.getId(selectedItem)} (${state.describeFormat.toUpperCase()})`, rendered);
      setStatus(`Described ${currentView.getId(selectedItem)}`);
    } catch (error) {
      openModal(`Describe: ${currentView.getId(selectedItem)} (${state.describeFormat.toUpperCase()})`, `Describe failed:\n${summarizeError(error)}`);
      setStatus(`Describe failed: ${summarizeError(error)}`);
    }
  }

  function getSelectedPolicyDeployContext() {
    const currentView = getCurrentView();
    const selectedItem = getCurrentSelection();

    if (!isDeployableView(currentView)) {
      return {
        error: "Deploy is only available from the policies view.",
      };
    }

    if (!selectedItem) {
      return {
        error: "Nothing selected.",
      };
    }

    const appName = currentView.scope?.appName;
    const policyName = currentView.getId(selectedItem);
    if (!appName || !policyName) {
      return {
        error: "Unable to resolve the selected policy for deployment.",
      };
    }

    return {
      appName,
      policyName,
      envName: selectedItem.envName || "",
    };
  }

  async function performConfirmedDeploy() {
    const pendingDeploy = state.pendingDeploy;
    if (!pendingDeploy) {
      closeConfirmBox();
      return;
    }

    confirmBox.hide();
    setStatus(
      `${pendingDeploy.force ? "Force restarting" : "Deploying"} ${pendingDeploy.appName} with workflow ${pendingDeploy.workflowName}...`,
    );
    screen.render();

    try {
      const result = await deployApplication(client, pendingDeploy.appName, {
        policy: pendingDeploy.policyName,
        force: Boolean(pendingDeploy.force),
      });
      state.describeCache.clear();
      openModal(
        `Deploy: ${result.appName} (${state.describeFormat.toUpperCase()})`,
        stringifyDetail(result.response, state.describeFormat),
      );
      setStatus(
        `${pendingDeploy.force ? "Force restarted" : "Deployed"} ${result.appName} with workflow ${result.workflowName}.`,
      );
      state.pendingDeploy = null;
      screen.render();
    } catch (error) {
      if (!pendingDeploy.force && isDeployConflictError(error)) {
        openDeployConfirm({
          ...pendingDeploy,
          force: true,
        });
        setStatus("Workflow is executing. Confirm to force restart.");
        return;
      }
      state.pendingDeploy = null;
      setStatus(`Deploy failed: ${summarizeError(error)}`);
      screen.render();
    }
  }

  async function prepareDeployForSelectedPolicy() {
    const context = getSelectedPolicyDeployContext();
    if (context.error) {
      setStatus(context.error);
      screen.render();
      return;
    }

    try {
      const workflowName = await resolveDeployWorkflowName(client, context.appName, {
        policy: context.policyName,
      });
      openDeployConfirm({
        appName: context.appName,
        policyName: context.policyName,
        workflowName,
        envName: context.envName,
        force: false,
      });
      setStatus(`Ready to deploy policy ${context.policyName}.`);
    } catch (error) {
      setStatus(`Deploy unavailable: ${summarizeError(error)}`);
    }
    screen.render();
  }

  async function editCurrentPolicy() {
    const currentView = getCurrentView();
    if (currentView.kind !== "app-policies") {
      return;
    }

    const selectedItem = getCurrentSelection();
    if (!selectedItem) {
      setStatus("Nothing selected.");
      screen.render();
      return;
    }

    const appName = currentView.scope?.appName;
    const policyName = currentView.getId(selectedItem);
    if (!appName || !policyName) {
      setStatus("Unable to resolve the selected policy.");
      screen.render();
      return;
    }

    setStatus(`Opening editor for policy ${policyName}...`);
    screen.render();

    try {
      finish({
        type: "edit-policy",
        appName,
        policyName,
        resumeState: buildResumeState(state.viewStack, state.filterByViewId, state.selectedIdByViewId),
      });
    } catch (error) {
      setStatus(`Edit failed: ${summarizeError(error)}`);
      screen.render();
    }
  }

  function closeModal() {
    modal.hide();
    resourceTable.focus();
    screen.render();
  }

  function toggleHelp() {
    if (help.hidden) {
      help.show();
      help.focus();
    } else {
      help.hide();
      resourceTable.focus();
    }
    screen.render();
  }

  async function applyFilterToView(view, normalized) {
    buildFilterMatcher(normalized);
    state.filterByViewId[view.id] = normalized;
    renderTable();
    setStatus(normalized ? `Applied filter to ${view.label.toLowerCase()}` : `Cleared filter for ${view.label.toLowerCase()}`);
    screen.render();
  }

  function openCommandInput() {
    state.inputMode = "command";
    searchInput.setLabel(" Command ");
    searchInput.setValue(":");
    searchInput.show();
    searchInput.focus();
    screen.render();

    searchInput.readInput((error, value) => {
      Promise.resolve()
        .then(async () => {
          searchInput.hide();
          state.inputMode = null;
          resourceTable.focus();
          renderTopBar();

          if (error) {
            setStatus(`Command aborted: ${summarizeError(error)}`);
            screen.render();
            return;
          }

          const normalized = String(value || "").replace(/^:/, "").trim();
          await runCommand(normalized);
        })
        .catch((commandError) => {
          setStatus(`Command failed: ${summarizeError(commandError)}`);
          screen.render();
        });
    });
  }

  function openFilterInput() {
    const currentView = getCurrentView();
    state.inputMode = "filter";
    searchInput.setLabel(" Filter ");
    searchInput.setValue(`/${getViewFilter(currentView)}`);
    searchInput.show();
    searchInput.focus();
    screen.render();

    searchInput.readInput((error, value) => {
      Promise.resolve()
        .then(async () => {
          searchInput.hide();
          state.inputMode = null;
          resourceTable.focus();
          renderTopBar();

          if (error) {
            setStatus(`Filter aborted: ${summarizeError(error)}`);
            screen.render();
            return;
          }

          const normalized = String(value || "").replace(/^\//, "").trim();
          await applyFilterToView(currentView, normalized);
        })
        .catch((inputError) => {
          setStatus(`Filter invalid: ${summarizeError(inputError)}`);
          screen.render();
        });
    });
  }

  function clearCurrentFilter() {
    const currentView = getCurrentView();
    if (!getViewFilter(currentView)) {
      return false;
    }

    state.filterByViewId[currentView.id] = "";
    renderTable();
    setStatus(`Cleared filter for ${currentView.label.toLowerCase()}`);
    screen.render();
    return true;
  }

  async function resolveAppForCommand(appName) {
    if (!appName) {
      const currentView = getCurrentView();
      const selectedItem = getCurrentSelection();

      if ((currentView.kind === "root" && currentView.rootResource === "apps") || currentView.kind === "project-apps") {
        return selectedItem;
      }

      if (currentView.kind === "app-policies") {
        return {
          name: currentView.scope.appName,
          alias: currentView.scope.appAlias,
          project: { name: currentView.scope.projectName },
          updateTime: currentView.scope.updateTime,
        };
      }

      return null;
    }

    let apps = state.itemsByViewId["root:apps"];
    if (!apps) {
      apps = await fetchApplications(client);
      state.itemsByViewId["root:apps"] = apps;
    }

    const normalizedName = appName.toLowerCase();
    return (
      apps.find((item) => String(item.name || "").toLowerCase() === normalizedName) ||
      apps.find((item) => String(item.alias || "").toLowerCase() === normalizedName) ||
      null
    );
  }

  async function openPoliciesFromCommand(app, filterText) {
    const nextView = createAppPoliciesView(app, {
      rootResource: "apps",
    });

    state.viewStack = [createRootView("apps"), nextView];
    renderHeader();
    renderTabs();
    renderSearchBar();
    screen.render();

    if (!state.itemsByViewId[nextView.id]) {
      await loadCurrentView();
    } else {
      renderTable();
    }

    if (filterText) {
      await applyFilterToView(nextView, filterText);
      setStatus(`Opened policies for ${app.name} with filter /${filterText}`);
      screen.render();
      return;
    }

    setStatus(`Opened policies for ${app.name}`);
    screen.render();
  }

  async function runCommand(rawCommand) {
    const command = String(rawCommand || "").trim();
    if (!command) {
      setStatus("Command cancelled");
      screen.render();
      return;
    }

    if (["q", "quit", "exit"].includes(command.toLowerCase())) {
      finish({ type: "quit" });
      return;
    }

    if (["?", "help"].includes(command.toLowerCase())) {
      toggleHelp();
      return;
    }

    const [head, ...rest] = command.split(/\s+/);
    const target = resolveResourceCommand(head);
    if (!target) {
      setStatus(`Unknown command ':${head}'. Try :a, :prj, :e, :def, :ao, :po <app>, or :q.`);
      screen.render();
      return;
    }

    if (target === "policies") {
      let appName = rest[0] || "";
      let filterParts = rest.slice(1);
      if (appName.startsWith("/")) {
        filterParts = rest;
        appName = "";
      }

      const filterText = filterParts.join(" ").trim().replace(/^\//, "").trim();
      const app = await resolveAppForCommand(appName || null);
      if (!app) {
        setStatus(appName ? `App '${appName}' was not found.` : "Select an app first or use :po <app>.");
        screen.render();
        return;
      }

      await openPoliciesFromCommand(app, filterText);
      return;
    }

    const filterText = rest.join(" ").trim().replace(/^\//, "").trim();
    await switchRootResource(target);
    if (filterText) {
      await applyFilterToView(getCurrentView(), filterText);
      setStatus(`Switched to ${ROOT_RESOURCE_DEFINITIONS[target].label.toLowerCase()} with filter /${filterText}`);
      screen.render();
      return;
    }

    setStatus(`Switched to ${ROOT_RESOURCE_DEFINITIONS[target].label.toLowerCase()}`);
    screen.render();
  }

  resourceTable.on("select item", (item, index) => {
    if (state.suppressSelectionEvent) {
      return;
    }

    const visibleIndex = index - 1;
    const visibleItem = state.currentVisibleItems[visibleIndex];
    if (!visibleItem) {
      return;
    }

    const currentView = getCurrentView();
    state.selectedIdByViewId[currentView.id] = currentView.getId(visibleItem);
    renderSearchBar();
    screen.render();
  });

  [help, modal, confirmBox].forEach((widget) => {
    widget.key(["escape", "q"], () => {
      if (widget === modal) {
        closeModal();
        return;
      }
      if (widget === confirmBox) {
        closeConfirmBox();
        setStatus("Deploy cancelled.");
        return;
      }
      help.hide();
      resourceTable.focus();
      screen.render();
    });
  });

  screen.key(["C-c"], () => {
    finish({ type: "quit" });
  });

  screen.key(["q"], () => {
    if (isInputActive()) {
      return;
    }
    if (!help.hidden) {
      toggleHelp();
      return;
    }
    if (!modal.hidden) {
      closeModal();
      return;
    }
    if (!confirmBox.hidden) {
      closeConfirmBox();
      setStatus("Deploy cancelled.");
      return;
    }
    finish({ type: "quit" });
  });

  screen.key(["tab"], async () => {
    if (hasOpenOverlay()) {
      return;
    }
    await selectByOffset(1);
  });

  screen.key(["S-tab", "shift-tab"], async () => {
    if (hasOpenOverlay()) {
      return;
    }
    await selectByOffset(-1);
  });

  RESOURCE_ORDER.forEach((resourceKey, index) => {
    screen.key([String(index + 1)], async () => {
      if (hasOpenOverlay()) {
        return;
      }
      await switchRootResource(resourceKey);
    });
  });

  screen.key([":"], () => {
    if (hasOpenOverlay()) {
      return;
    }
    openCommandInput();
  });

  screen.key(["/"], () => {
    if (hasOpenOverlay()) {
      return;
    }
    openFilterInput();
  });

  screen.key(["?"], () => {
    if (isInputActive() || !modal.hidden || !confirmBox.hidden) {
      return;
    }
    toggleHelp();
  });

  screen.key(["escape", "left", "backspace"], async () => {
    if (isInputActive()) {
      return;
    }
    if (!modal.hidden) {
      closeModal();
      return;
    }
    if (!confirmBox.hidden) {
      closeConfirmBox();
      setStatus("Deploy cancelled.");
      return;
    }
    if (!help.hidden) {
      toggleHelp();
      return;
    }
    if (clearCurrentFilter()) {
      return;
    }
    await goBack();
  });

  screen.key(["r"], async () => {
    if (hasOpenOverlay()) {
      return;
    }
    await loadCurrentView({ force: true });
  });

  screen.key(["y"], async () => {
    if (!confirmBox.hidden) {
      await performConfirmedDeploy();
      return;
    }
    if (isInputActive() || !help.hidden) {
      return;
    }
    state.describeFormat = state.describeFormat === "yaml" ? "json" : "yaml";
    renderHeader();
    renderTabs();
    renderSearchBar();
    if (!modal.hidden) {
      await openDescribe(true);
      return;
    }
    setStatus(`Describe format: ${state.describeFormat.toUpperCase()}`);
    screen.render();
  });

  screen.key(["d"], async () => {
    if (hasOpenOverlay() && modal.hidden) {
      return;
    }
    if (!modal.hidden) {
      return;
    }
    await openDescribe(false);
  });

  screen.key(["p"], async () => {
    if (hasOpenOverlay()) {
      return;
    }
    await prepareDeployForSelectedPolicy();
  });

  screen.key(["e"], async () => {
    if (hasOpenOverlay()) {
      return;
    }
    await editCurrentPolicy();
  });

  screen.key(["enter"], async () => {
    if (!confirmBox.hidden) {
      await performConfirmedDeploy();
      return;
    }
    if (hasOpenOverlay()) {
      return;
    }
    await drillDown();
  });

  screen.key(["n"], () => {
    if (confirmBox.hidden) {
      return;
    }
    closeConfirmBox();
    setStatus("Deploy cancelled.");
  });

  renderHeader();
  renderTabs();
  renderFooter();
  resourceTable.focus();
  screen.render();

  refreshHeaderIdentity().catch(() => {});
  await loadCurrentView({ force: true });
  return completion;
}

module.exports = {
  RESOURCE_ORDER,
  runTui,
};
