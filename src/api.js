const { DEFAULT_BASE_URL, DEFAULT_LOGIN_PATH } = require("./capture");

class VelaClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || process.env.VELA_BASE_URL || DEFAULT_BASE_URL;
    this.loginPath = options.loginPath || process.env.VELA_LOGIN_PATH || DEFAULT_LOGIN_PATH;
    this.username = options.username || process.env.VELA_USERNAME;
    this.password = options.password || process.env.VELA_PASSWORD;
    this.staticToken = options.token || process.env.VELA_TOKEN || null;
    this.token = this.staticToken;
  }

  async login(options = {}) {
    const { force = false } = options;

    if (this.token && (!force || this.staticToken)) {
      return this.token;
    }

    if (!this.username || !this.password) {
      throw new Error("Missing credentials. Set VELA_USERNAME and VELA_PASSWORD in the environment.");
    }

    const response = await fetch(new URL(this.loginPath, this.baseUrl), {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        username: this.username,
        password: this.password,
      }),
    });

    if (!response.ok) {
      throw new Error(`Login failed with status ${response.status}`);
    }

    const payload = await response.json();
    if (!payload.accessToken) {
      throw new Error("Login succeeded but accessToken was not returned.");
    }

    this.token = payload.accessToken;
    return this.token;
  }

  async requestWithToken(apiPath, options = {}) {
    const { method = "GET", headers = {}, body } = options;
    return fetch(new URL(apiPath, this.baseUrl), {
      method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.token}`,
        ...headers,
      },
      body,
    });
  }

  async request(apiPath, options = {}) {
    await this.login();

    let response = await this.requestWithToken(apiPath, options);

    // Tokens are only cached in-process, so retry once with a fresh login if the server rejects it.
    if ((response.status === 401 || response.status === 403) && !this.staticToken) {
      this.token = null;
      await this.login({ force: true });
      response = await this.requestWithToken(apiPath, options);
    }

    return response;
  }

  async getJson(apiPath) {
    const response = await this.request(apiPath, { method: "GET" });

    if (!response.ok) {
      throw new Error(`GET ${apiPath} failed with status ${response.status}`);
    }

    return response.json();
  }

  async putJson(apiPath, payload) {
    const response = await this.request(apiPath, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`PUT ${apiPath} failed with status ${response.status}`);
    }

    return response.json();
  }

  async postJson(apiPath, payload) {
    const response = await this.request(apiPath, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`POST ${apiPath} failed with status ${response.status}`);
    }

    return response.json();
  }
}

module.exports = {
  VelaClient,
};
