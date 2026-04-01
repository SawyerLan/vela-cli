const blessed = require("blessed");
const YAML = require("yaml");
const { VelaClient } = require("./api");

const RESOURCE_ORDER = ["apps", "projects", "envs", "definitions", "addons"];

const ROOT_RESOURCE_DEFINITIONS = {
  apps: {
    label: "Apps",
    columns: [
      { title: "NAME", width: 24, value: (item) => item.name || "" },
      { title: "PROJECT", width: 18, value: (item) => item.project?.name || "" },
      { title: "ALIAS", width: 18, value: (item) => item.alias || "" },
      { title: "UPDATED", width: 19, value: (item) => item.updateTime || "" },
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
  if (!width || text.length <= width) {
    return text;
  }

  if (width <= 3) {
    return text.slice(0, width);
  }

  return `${text.slice(0, width - 3)}...`;
}

function stringifyDetail(value, format) {
  if (format === "json") {
    return JSON.stringify(value, null, 2);
  }

  return YAML.stringify(value, { indent: 2 }).trimEnd();
}

function buildRows(view, items) {
  const header = view.columns.map((column) => column.title);
  const rows = items.map((item) => view.columns.map((column) => truncateCell(column.value(item), column.width)));
  return [header, ...rows];
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
    loadItems: async (client) => fetchPolicies(client, app.name),
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

function buildPreview(view, item, items) {
  const lines = [`Scope: ${view.breadcrumb}`, `Items: ${items.length}`];

  if (!item) {
    lines.push("", "No row selected.");
    return lines.join("\n");
  }

  if (view.kind === "root" && view.rootResource === "projects") {
    lines.push(`Selected: ${item.name || ""}`);
    lines.push(`Alias: ${item.alias || ""}`);
    lines.push(`Owner: ${item.owner?.name || ""}`);
    lines.push(`Roles: ${(item.roles || []).map((role) => role.name).join(", ")}`);
    lines.push("");
    lines.push("Enter: open apps in this project");
    lines.push("d: describe project");
    return lines.join("\n");
  }

  if (view.kind === "root" && view.rootResource === "apps") {
    lines.push(`Selected: ${item.name || ""}`);
    lines.push(`Project: ${item.project?.name || ""}`);
    lines.push(`Alias: ${item.alias || ""}`);
    lines.push(`Updated: ${item.updateTime || ""}`);
    lines.push("");
    lines.push("Enter: open policies for this app");
    lines.push("d: describe app");
    return lines.join("\n");
  }

  if (view.kind === "project-apps") {
    lines.push(`Project: ${view.scope.projectName}`);
    lines.push(`Selected app: ${item.name || ""}`);
    lines.push(`Alias: ${item.alias || ""}`);
    lines.push(`Updated: ${item.updateTime || ""}`);
    lines.push("");
    lines.push("Enter: open policies for this app");
    lines.push("d: describe app");
    lines.push("esc: back to project list");
    return lines.join("\n");
  }

  if (view.kind === "app-policies") {
    lines.push(`App: ${view.scope.appName}`);
    lines.push(`Selected policy: ${item.name || ""}`);
    lines.push(`Type: ${item.type || ""}`);
    lines.push(`Env: ${item.envName || ""}`);
    lines.push(`Updated: ${item.updateTime || ""}`);
    lines.push("");
    lines.push("d: describe policy");
    lines.push("esc: back to app list");
    return lines.join("\n");
  }

  if (view.rootResource === "envs") {
    lines.push(`Selected: ${item.name || ""}`);
    lines.push(`Project: ${item.project?.name || ""}`);
    lines.push(`Namespace: ${item.namespace || ""}`);
    lines.push(`Targets: ${(item.targets || []).map((target) => target.name).join(", ")}`);
    lines.push("");
    lines.push("d: describe env");
    return lines.join("\n");
  }

  if (view.rootResource === "definitions") {
    lines.push(`Selected: ${item.name || ""}`);
    lines.push(`Type: ${item.workloadType || ""}`);
    lines.push(`Status: ${item.status || ""}`);
    lines.push(`Addon: ${item.ownerAddon || ""}`);
    lines.push("");
    lines.push("d: describe definition");
    return lines.join("\n");
  }

  if (view.rootResource === "addons") {
    lines.push(`Selected: ${item.name || ""}`);
    lines.push(`Phase: ${item.phase || ""}`);
    lines.push(`Description: ${item.description || ""}`);
    lines.push("");
    lines.push("d: describe addon");
    return lines.join("\n");
  }

  lines.push(`Selected: ${view.getId(item)}`);
  lines.push("");
  lines.push("d: describe selection");
  return lines.join("\n");
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

  const screen = blessed.screen({
    smartCSR: true,
    fullUnicode: false,
    title: "vela-cli tui",
  });

  const state = {
    viewStack: [createRootView(initialResource)],
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
  };

  const header = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: "100%",
    height: 4,
    tags: true,
    border: "line",
    style: {
      border: { fg: "cyan" },
    },
  });

  const tabs = blessed.box({
    parent: screen,
    top: 4,
    left: 0,
    width: "100%",
    height: 3,
    tags: true,
    border: "line",
    style: {
      border: { fg: "blue" },
    },
  });

  const resourceTable = blessed.listtable({
    parent: screen,
    top: 7,
    left: 0,
    width: "48%",
    height: "100%-10",
    keys: true,
    vi: true,
    mouse: true,
    border: "line",
    align: "left",
    noCellBorders: true,
    style: {
      border: { fg: "green" },
      header: { fg: "black", bg: "cyan", bold: true },
      cell: {
        fg: "white",
        selected: { fg: "black", bg: "green", bold: true },
      },
    },
  });

  const detail = blessed.box({
    parent: screen,
    top: 7,
    left: "48%",
    width: "52%",
    height: "100%-10",
    border: "line",
    mouse: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: " ",
      inverse: true,
    },
    style: {
      border: { fg: "yellow" },
    },
  });

  const footer = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: "100%",
    height: 3,
    tags: true,
    border: "line",
    style: {
      border: { fg: "magenta" },
    },
  });

  const prompt = blessed.prompt({
    parent: screen,
    top: "center",
    left: "center",
    width: "60%",
    height: 8,
    label: " Filter ",
    border: "line",
    style: {
      border: { fg: "cyan" },
    },
  });

  const help = blessed.box({
    parent: screen,
    top: "center",
    left: "center",
    width: "72%",
    height: 16,
    hidden: true,
    border: "line",
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    vi: true,
    mouse: true,
    label: " Help ",
    content: [
      "{bold}vela-cli tui{/bold}",
      "",
      "[1-5] switch top-level resources",
      "[tab] / [shift-tab] next or previous resource",
      "[up/down] or [j/k] move selection",
      "[enter] drill down into the selected row",
      "[d] describe the selected row",
      "[esc] / [left] / [backspace] go back one level",
      "[/] set or clear a substring filter for the current view",
      "[y] toggle describe format between YAML and JSON",
      "[r] refresh the current view",
      "[?] toggle this help dialog",
      "[q] quit",
      "",
      "Projects -> Apps -> Policies is the main k9s-style navigation path.",
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
    keys: true,
    vi: true,
    mouse: true,
    scrollbar: {
      ch: " ",
      inverse: true,
    },
    style: {
      border: { fg: "yellow" },
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
    renderFooter();
  }

  function hasOpenOverlay() {
    return !prompt.hidden || !help.hidden || !modal.hidden;
  }

  function getVisibleItems(view = getCurrentView()) {
    const filter = getViewFilter(view).trim().toLowerCase();
    const items = getViewItems(view);

    if (!filter) {
      return items;
    }

    return items.filter((item) => view.getSearchText(item).toLowerCase().includes(filter));
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
    const currentView = getCurrentView();
    const baseUrl = truncateCell(client.baseUrl, 54);
    const userLabel = state.headerUser ? ` | user: ${truncateCell(state.headerUser, 24)}` : "";
    const updatedLabel = state.lastUpdated ? ` | updated: ${state.lastUpdated}` : "";
    header.setContent(
      `{bold}vela-cli tui{/bold}  k9s-inspired read-only explorer\nbase: ${baseUrl}${userLabel}${updatedLabel}\nscope: ${currentView.breadcrumb}`,
    );
  }

  function renderTabs() {
    const currentRoot = getCurrentView().rootResource;
    const tabText = RESOURCE_ORDER.map((resourceKey, index) => {
      const label = ROOT_RESOURCE_DEFINITIONS[resourceKey].label;
      const count = (state.itemsByViewId[`root:${resourceKey}`] || []).length;
      if (resourceKey === currentRoot) {
        return `{black-bg}{white-fg} ${index + 1}:${label} (${count}) {/white-fg}{/black-bg}`;
      }
      return ` ${index + 1}:${label} (${count}) `;
    }).join(" ");

    tabs.setContent(tabText);
  }

  function renderFooter() {
    const currentView = getCurrentView();
    const filter = getViewFilter(currentView);
    const filterText = filter ? ` filter:${truncateCell(filter, 20)}` : "";
    const canDrill = Boolean(currentView.canEnter);
    const canGoBack = state.viewStack.length > 1;
    footer.setContent(
      `[1-5] resource  [tab] next  [enter] ${canDrill ? "drill" : "-"}  [d] describe  [esc] ${canGoBack ? "back" : "-"}  [/] filter  [y] ${state.describeFormat.toUpperCase()}  [r] refresh  [q] quit${filterText}\n${state.statusText}`,
    );
  }

  function renderPreview() {
    const currentView = getCurrentView();
    const selectedItem = getCurrentSelection();
    detail.setLabel(" Preview ");
    detail.setContent(buildPreview(currentView, selectedItem, state.currentVisibleItems));
    detail.setScroll(0);
  }

  function renderTable() {
    const currentView = getCurrentView();
    state.currentVisibleItems = getVisibleItems(currentView);
    ensureSelectedId(currentView);

    resourceTable.setLabel(` ${currentView.label} `);
    state.suppressSelectionEvent = true;
    resourceTable.setData(buildRows(currentView, state.currentVisibleItems));

    const selectedId = getSelectedId(currentView);
    const selectedIndex = state.currentVisibleItems.findIndex((item) => currentView.getId(item) === selectedId);
    resourceTable.select(selectedIndex >= 0 ? selectedIndex + 1 : 1);
    state.suppressSelectionEvent = false;

    if (state.currentVisibleItems.length === 0) {
      detail.setLabel(" Preview ");
      detail.setContent(`Scope: ${currentView.breadcrumb}\n\nNo rows match the current filter.`);
      detail.setScroll(0);
      return;
    }

    renderPreview();
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
    detail.setLabel(" Preview ");
    detail.setContent("Loading list...");
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
      resourceTable.setData([["ERROR"], [truncateCell(summarizeError(error), 60)]]);
      resourceTable.select(1);
      state.suppressSelectionEvent = false;
      detail.setLabel(" Preview ");
      detail.setContent(`Scope: ${currentView.breadcrumb}\n\nLoad failed:\n${summarizeError(error)}`);
      detail.setScroll(0);
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
    modal.setLabel(` Describe: ${currentView.getId(selectedItem)} (${state.describeFormat.toUpperCase()}) `);
    modal.show();
    modal.focus();
    modal.setContent("Loading describe output...");
    modal.setScroll(0);
    screen.render();

    if (!force && state.describeCache.has(cacheKey)) {
      modal.setContent(state.describeCache.get(cacheKey));
      screen.render();
      return;
    }

    try {
      const described = await currentView.describeItem(client, selectedItem, currentView);
      const rendered = stringifyDetail(described, state.describeFormat);
      state.describeCache.set(cacheKey, rendered);
      modal.setContent(rendered);
      setStatus(`Described ${currentView.getId(selectedItem)}`);
      screen.render();
    } catch (error) {
      modal.setContent(`Describe failed:\n${summarizeError(error)}`);
      setStatus(`Describe failed: ${summarizeError(error)}`);
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

  function setFilter() {
    const currentView = getCurrentView();
    prompt.input("Substring filter (blank clears)", getViewFilter(currentView), (error, value) => {
      if (error) {
        setStatus(`Filter aborted: ${summarizeError(error)}`);
        screen.render();
        return;
      }

      state.filterByViewId[currentView.id] = (value || "").trim();
      renderTable();
      renderFooter();
      setStatus(`Updated filter for ${currentView.label.toLowerCase()}`);
      screen.render();
    });
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
    renderPreview();
    renderFooter();
    screen.render();
  });

  [help, modal].forEach((widget) => {
    widget.key(["escape", "q"], () => {
      if (widget === modal) {
        closeModal();
        return;
      }
      help.hide();
      resourceTable.focus();
      screen.render();
    });
  });

  screen.key(["C-c"], () => {
    screen.destroy();
    process.exit(0);
  });

  screen.key(["q"], () => {
    if (!prompt.hidden) {
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
    screen.destroy();
    process.exit(0);
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

  screen.key(["/"], () => {
    if (hasOpenOverlay()) {
      return;
    }
    setFilter();
  });

  screen.key(["?"], () => {
    if (!prompt.hidden || !modal.hidden) {
      return;
    }
    toggleHelp();
  });

  screen.key(["escape", "left", "backspace"], async () => {
    if (!prompt.hidden) {
      return;
    }
    if (!modal.hidden) {
      closeModal();
      return;
    }
    if (!help.hidden) {
      toggleHelp();
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
    if (!prompt.hidden || !help.hidden) {
      return;
    }
    state.describeFormat = state.describeFormat === "yaml" ? "json" : "yaml";
    renderFooter();
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

  screen.key(["enter"], async () => {
    if (hasOpenOverlay()) {
      return;
    }
    await drillDown();
  });

  renderHeader();
  renderTabs();
  renderFooter();
  resourceTable.focus();
  screen.render();

  refreshHeaderIdentity().catch(() => {});
  await loadCurrentView({ force: true });
}

module.exports = {
  RESOURCE_ORDER,
  runTui,
};
