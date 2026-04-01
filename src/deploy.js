function uniqueNonEmpty(items) {
  return Array.from(new Set(items.filter(Boolean))).sort();
}

function isDeployConflictError(error) {
  return /application deploy conflict/i.test(error?.message || "");
}

async function getApplicationPolicies(client, appName) {
  const data = await client.getJson(`/api/v1/applications/${encodeURIComponent(appName)}/policies`);
  return data.policies || [];
}

function getDeployApiPath(appName) {
  return `/api/v1/applications/${encodeURIComponent(appName)}/deploy`;
}

function getWorkflowNamesFromPolicy(policy) {
  return uniqueNonEmpty((policy.workflowPolicyBind || []).map((item) => item.name));
}

async function getEnvNames(client, appName) {
  const policies = await getApplicationPolicies(client, appName);
  return uniqueNonEmpty(policies.map((policy) => policy.envName));
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
    const policy = await client.getJson(
      `/api/v1/applications/${encodeURIComponent(appName)}/policies/${encodeURIComponent(policySummary.name)}`,
    );
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
    matchedPolicySummaries.map((policy) =>
      client.getJson(`/api/v1/applications/${encodeURIComponent(appName)}/policies/${encodeURIComponent(policy.name)}`),
    ),
  );

  return resolveWorkflowFromCandidates(
    "env",
    options.env,
    uniqueNonEmpty(matchedPolicies.flatMap((policy) => getWorkflowNamesFromPolicy(policy))),
  );
}

async function deployApplication(client, appName, options) {
  const workflowName = await resolveDeployWorkflowName(client, appName, options);
  const force = Boolean(options.force);
  const response = await client.postJson(getDeployApiPath(appName), {
    appName,
    workflowName,
    triggerType: "web",
    force,
  });

  return {
    appName,
    workflowName,
    force,
    response,
  };
}

module.exports = {
  deployApplication,
  getApplicationPolicies,
  getDeployApiPath,
  getEnvNames,
  isDeployConflictError,
  resolveDeployWorkflowName,
};
