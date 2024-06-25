import { BadRequestError, NotAuthenticatedError } from "./error.js";
import { APP_ID, APP_SECRET } from "./env.js";

class Auth {
  constructor() {
    this.token = undefined;
    this.redirect_uri = chrome.identity.getRedirectURL();
  }

  async authenticate() {
    // prompt oauth access from user and get code
    const codeResponse = await chrome.identity.launchWebAuthFlow({
      interactive: true,
      url: `https://www.reddit.com/api/v1/authorize?client_id=${APP_ID}&response_type=code&state=123&redirect_uri=${encodeURI(
        this.redirect_uri
      )}&duration=temporary&scope=submit+edit+history+identity`,
    });

    const codeParams = new URLSearchParams(codeResponse);
    if (codeParams.has("error")) {
      throw new NotAuthenticatedError();
    }

    // use code to retrieve token
    const code = codeParams.get("code").slice(0, -2);
    const tokenResponse = await fetch(
      "https://www.reddit.com/api/v1/access_token",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${APP_ID}:${APP_SECRET}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": `Chrome:reddit-nuker:v${this.version} (by /u/kenny-b-c)`,
        },
        body: `grant_type=authorization_code&code=${encodeURIComponent(
          code
        )}&redirect_uri=${encodeURI(this.redirect_uri)}`,
      }
    );
    const tokenJson = await tokenResponse.json();
    this.token = tokenJson.access_token;
  }

  async request(method, url, body) {
    if (this.token === undefined) {
      throw new NotAuthenticatedError();
    }
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": `Chrome:reddit-nuker:v${this.version} (by /u/kenny-b-c)`,
      },
      body,
    });

    if (!response.ok) {
      throw new BadRequestError(response.status);
    }
    return await response.json();
  }
}

export default Auth;
