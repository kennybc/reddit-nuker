import { NotAuthenticatedError } from "./error.js";
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
      )}&duration=permanent&scope=submit+edit+history+identity`,
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
    return tokenJson.access_token;
  }

  async request(method, url, body) {
    if (this.token === undefined) {
      throw new NotAuthenticatedError();
    }
    try {
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

      // 401 = too many requests
      if (!response.ok) {
        this.display.log(
          `<span class='orange'>error</span>, ${response.status} ${response.statusText}`
        );
        return response.text();
      }
      return response.json();
    } catch (error) {
      await this.display.log("<span class='red'>error</span>, " + error);
    }
  }
}

export default Auth;
