const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const DEFAULT_BASE_URL = "https://vela.lbxdrugs.com";
const DEFAULT_LOGIN_PATH = "/api/v1/auth/login";
const NAV_ITEMS = ["应用", "环境", "项目", "集群", "配置", "工作流", "运维"];

function timestamp() {
  const now = new Date();
  const parts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ];
  return parts.join("");
}

function redactHeaders(headers = {}) {
  const redacted = { ...headers };
  for (const key of Object.keys(redacted)) {
    const lower = key.toLowerCase();
    if (["authorization", "cookie", "set-cookie", "x-csrf-token"].includes(lower)) {
      redacted[key] = "<redacted>";
    }
  }
  return redacted;
}

function redactPostData(raw) {
  if (!raw) {
    return raw;
  }

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed) {
      for (const key of Object.keys(parsed)) {
        if (["password", "token", "authorization"].includes(key.toLowerCase())) {
          parsed[key] = "<redacted>";
        }
      }
      return JSON.stringify(parsed);
    }
  } catch {
    return raw.replace(/"password"\s*:\s*"[^"]+"/gi, '"password":"<redacted>"');
  }

  return raw;
}

function redactJsonSecrets(value) {
  if (!value || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactJsonSecrets(item));
  }

  const clone = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (["password", "token", "accesstoken", "refreshtoken", "authorization"].includes(key.toLowerCase())) {
      clone[key] = "<redacted>";
      continue;
    }
    clone[key] = redactJsonSecrets(nestedValue);
  }
  return clone;
}

function sanitizeUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    for (const key of parsed.searchParams.keys()) {
      if (["token", "password", "access_token"].includes(key.toLowerCase())) {
        parsed.searchParams.set(key, "<redacted>");
      }
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function normalizePath(rawUrl) {
  const parsed = new URL(rawUrl);
  return parsed.pathname;
}

function isAllowedRequest(request, loginUrl) {
  const method = request.method().toUpperCase();
  const url = request.url();

  if (SAFE_METHODS.has(method)) {
    return true;
  }

  if (method === "POST" && url === loginUrl) {
    return true;
  }

  return false;
}

async function locatorIsUsable(locator) {
  try {
    return (await locator.count()) > 0 && (await locator.first().isVisible());
  } catch {
    return false;
  }
}

async function fillFirst(page, selectors, value) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locatorIsUsable(locator)) {
      await locator.fill(value);
      return selector;
    }
  }
  throw new Error(`Unable to find input for selectors: ${selectors.join(", ")}`);
}

async function clickFirst(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locatorIsUsable(locator)) {
      await locator.click();
      return selector;
    }
  }
  throw new Error(`Unable to find clickable element for selectors: ${selectors.join(", ")}`);
}

async function tryExploreReadOnlyNav(page) {
  const explored = [];

  for (const item of NAV_ITEMS) {
    const locator = page.getByText(item, { exact: false }).first();
    if (!(await locatorIsUsable(locator))) {
      continue;
    }

    try {
      await locator.click({ timeout: 3000 });
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      explored.push(item);
    } catch {
      // Best effort only.
    }
  }

  return explored;
}

async function safeResponsePreview(response) {
  const headers = response.headers();
  const contentType = headers["content-type"] || "";

  if (!contentType.includes("application/json")) {
    return null;
  }

  try {
    const text = await response.text();
    try {
      const parsed = JSON.parse(text);
      return JSON.stringify(redactJsonSecrets(parsed), null, 1).slice(0, 4000);
    } catch {
      return text.slice(0, 4000);
    }
  } catch {
    return null;
  }
}

function summarizeRecords(records, blocked) {
  const allowedMap = new Map();
  for (const record of records) {
    const key = `${record.method} ${record.path}`;
    if (!allowedMap.has(key)) {
      allowedMap.set(key, {
        method: record.method,
        path: record.path,
        count: 0,
        statuses: new Set(),
        resourceTypes: new Set(),
      });
    }

    const bucket = allowedMap.get(key);
    bucket.count += 1;
    if (record.status) {
      bucket.statuses.add(record.status);
    }
    if (record.resourceType) {
      bucket.resourceTypes.add(record.resourceType);
    }
  }

  const blockedMap = new Map();
  for (const item of blocked) {
    const key = `${item.method} ${item.path}`;
    if (!blockedMap.has(key)) {
      blockedMap.set(key, {
        method: item.method,
        path: item.path,
        count: 0,
      });
    }
    blockedMap.get(key).count += 1;
  }

  return {
    allowed: Array.from(allowedMap.values())
      .map((item) => ({
        ...item,
        statuses: Array.from(item.statuses).sort((a, b) => a - b),
        resourceTypes: Array.from(item.resourceTypes).sort(),
      }))
      .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)),
    blocked: Array.from(blockedMap.values()).sort(
      (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
    ),
  };
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function sanitizeStorageState(storageState) {
  const nextState = {
    cookies: [],
    origins: [],
  };

  for (const cookie of storageState.cookies || []) {
    nextState.cookies.push({
      ...cookie,
      value: "<redacted>",
    });
  }

  for (const origin of storageState.origins || []) {
    nextState.origins.push({
      origin: origin.origin,
      localStorage: (origin.localStorage || []).map((entry) => ({
        name: entry.name,
        value: "<redacted>",
      })),
    });
  }

  return nextState;
}

async function runCapture(options = {}) {
  const {
    baseUrl = DEFAULT_BASE_URL,
    loginPath = DEFAULT_LOGIN_PATH,
    username = process.env.VELA_USERNAME,
    password = process.env.VELA_PASSWORD,
    headless = true,
  } = options;

  if (!username || !password) {
    throw new Error("Missing credentials. Set VELA_USERNAME and VELA_PASSWORD in the environment.");
  }

  const origin = new URL(baseUrl).origin;
  const loginUrl = new URL(loginPath, origin).toString();
  const outputDir = path.join(process.cwd(), "artifacts", timestamp());
  await fs.mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  const records = [];
  const blocked = [];
  const requestIds = new Map();
  let nextId = 1;

  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = request.url();

    if (!url.startsWith(origin)) {
      await route.continue();
      return;
    }

    if (!isAllowedRequest(request, loginUrl)) {
      blocked.push({
        method: request.method(),
        url: sanitizeUrl(url),
        path: normalizePath(url),
        resourceType: request.resourceType(),
      });
      await route.abort("blockedbyclient");
      return;
    }

    await route.continue();
  });

  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith(origin)) {
      return;
    }

    const id = nextId++;
    requestIds.set(request, id);
    records.push({
      id,
      phase: "request",
      method: request.method(),
      url: sanitizeUrl(url),
      path: normalizePath(url),
      resourceType: request.resourceType(),
      headers: redactHeaders(request.headers()),
      postData: redactPostData(request.postData()),
      status: null,
    });
  });

  page.on("response", async (response) => {
    const request = response.request();
    const url = request.url();
    if (!url.startsWith(origin)) {
      return;
    }

    const id = requestIds.get(request);
    const record = records.find((item) => item.id === id);
    if (!record) {
      return;
    }

    record.phase = "response";
    record.status = response.status();
    record.responseHeaders = redactHeaders(response.headers());
    record.responsePreview = await safeResponsePreview(response);
  });

  page.on("requestfailed", (request) => {
    const url = request.url();
    if (!url.startsWith(origin)) {
      return;
    }

    const id = requestIds.get(request);
    const record = records.find((item) => item.id === id);
    if (record) {
      record.failure = request.failure();
    }
  });

  let loginSelectors = null;
  let exploredNav = [];
  let finalUrl = null;
  let screenshotPath = path.join(outputDir, "final-page.png");

  try {
    await page.goto(`${origin}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });

    const usernameSelector = await fillFirst(
      page,
      [
        'input[placeholder*="用户名"]',
        'input[placeholder*="账号"]',
        'input[name="username"]',
        'input[name="userName"]',
        'input[type="text"]',
      ],
      username,
    );

    const passwordSelector = await fillFirst(
      page,
      [
        'input[placeholder*="密码"]',
        'input[name="password"]',
        'input[type="password"]',
      ],
      password,
    );

    const submitSelector = await clickFirst(page, [
      'button:has-text("登录")',
      'button:has-text("登 录")',
      'button[type="submit"]',
      'input[type="submit"]',
    ]);

    loginSelectors = {
      usernameSelector,
      passwordSelector,
      submitSelector,
    };

    await Promise.race([
      page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 }),
      page.waitForLoadState("networkidle", { timeout: 15000 }),
    ]).catch(() => {});

    await page.waitForTimeout(3000);
    exploredNav = await tryExploreReadOnlyNav(page);
    await page.waitForTimeout(1500);
    finalUrl = page.url();
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    const storageState = await context.storageState();
    await writeJson(path.join(outputDir, "storage-state.json"), sanitizeStorageState(storageState));
  } catch (error) {
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }

  const summary = summarizeRecords(records, blocked);
  const meta = {
    baseUrl: origin,
    loginUrl,
    outputDir,
    finalUrl,
    loginSelectors,
    exploredNav,
    capturedAt: new Date().toISOString(),
  };

  await writeJson(path.join(outputDir, "meta.json"), meta);
  await writeJson(path.join(outputDir, "requests.json"), records);
  await writeJson(path.join(outputDir, "summary.json"), summary);

  return {
    outputDir,
    finalUrl,
    exploredNav,
    summary,
  };
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_LOGIN_PATH,
  runCapture,
};
