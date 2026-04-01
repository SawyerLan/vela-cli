const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const YAML = require("yaml");

const EDITABLE_POLICY_API_VERSION = "vela-cli.dev/v1alpha1";
const EDITABLE_POLICY_KIND = "Policy";
const EDITABLE_POLICY_FIELDS = ["alias", "type", "description", "envName", "properties", "workflowPolicyBind"];

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

async function editPolicyInteractively(client, appName, policyName, options = {}) {
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
    return updateExistingPolicy(client, desiredState);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  editPolicyInteractively,
  getPolicyApiPath,
  normalizeEditablePolicyState,
  updateExistingPolicy,
};
