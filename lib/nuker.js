import Display from "./display.js";

// todo: make consistent use of async/await vs promises
class Nuker {
  constructor() {
    this.batchSize = 2;
    this.paused = false;
    this.version = chrome.runtime.getManifest().version;
    this.redirect_uri = chrome.identity.getRedirectURL();
    this.display = new Display();
  }

  // enum for item types
  #ItemType = {
    COMMENT: "comments",
    POST: "submitted",
  };

  // conversion table for reddit object kind to readable item type
  #kind2type = {
    t1: "comment",
    t3: "post",
  };

  getLog() {
    return this.display.getLog();
  }

  getCooldown() {
    return this.display.getCooldown();
  }

  getUsage() {
    return this.display.getUsage();
  }

  // abort any running recurring processes
  async abort() {
    await this.display.log("<span class='red bold'>abort signal sent</span>");
    this.paused = true;
  }

  // get oauth token
  async authenticate() {
    // prompt oauth access from user and get code
    return (
      chrome.identity
        .launchWebAuthFlow({
          interactive: true,
          url: `https://www.reddit.com/api/v1/authorize?client_id=2uzE9BzrjCHLKcwzGjjh8w&response_type=code&state=123&redirect_uri=${chrome.identity.getRedirectURL()}&duration=temporary&scope=submit+edit+history+identity`,
        })
        // use code to retrieve token
        .then((response) => {
          const code = new URLSearchParams(response).get("code").slice(0, -2);
          return fetch("https://www.reddit.com/api/v1/access_token", {
            method: "POST",
            headers: {
              Authorization: `Basic ${btoa(
                "2uzE9BzrjCHLKcwzGjjh8w:Dim5Hmy9Ye3HrU5om610dBruN4Z3yg"
              )}`,
              "Content-Type": "application/x-www-form-urlencoded",
              "User-Agent": `Chrome:reddit-nuker:v${this.version} (by /u/Skabop)`,
            },
            body: `grant_type=authorization_code&code=${encodeURIComponent(
              code
            )}&redirect_uri=${encodeURI(this.redirect_uri)}`,
          })
            .then((response) => response.json())
            .then((response) => {
              return response.access_token;
            });
        })
    );
  }

  request(method, url, token, body) {
    return fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": `Chrome:reddit-nuker:v${this.version} (by /u/Skabop)`,
      },
      body,
    })
      .then((response) => {
        // 401 = too many requests
        if (!response.ok) {
          this.display.log(
            "<span class='orange'>on cooldown</span>, too many requests"
          );
          //this.#setCooldown(600);
          return response.text();
        }
        return response.json();
      })
      .catch(async (error) => {
        await this.display.log("<span class='red'>error</span>, " + error);
      });
  }

  getUser(token) {
    return this.request(
      "GET",
      "https://oauth.reddit.com/api/v1/me",
      token
    ).then((response) => {
      if (!response) {
        return false;
      }
      return response.name;
    });
  }

  // submit a GET request to Reddit to retrieve comment or post history json
  getUserItems(username, itemType, token) {
    return this.request(
      "GET",
      `https://oauth.reddit.com/user/${username}/${itemType}.json?limit=${this.batchSize}`,
      token
    ).then((response) => {
      if (!response) {
        return false;
      }
      return response.data.children;
    });
  }

  // submit a POST request to Reddit API to delete an item of given ID
  async deleteById(id, token) {
    // process has been aborted; quit now
    if (this.paused) {
      return new Promise((resolve) => {
        resolve(-1);
      });
    }
    return this.request(
      "POST",
      `https://oauth.reddit.com/api/del?id=${id}`,
      token
    ).then(() => {
      return true;
    });
  }

  // gets a batch of items and then deletes them
  // recurses until none left or aborted
  async deleteBatch(username, itemType, token, batch = []) {
    // 1 if successful, 0 if unsuccessful, -1 if process aborted
    let deleted = 0;
    for (let i = 0; i < batch.length; i++) {
      let status = await this.deleteById(batch[i].data.name, token).then(
        async (response) => {
          if (response == -1 || response == false) {
            return response;
          }
          await this.display.log(
            `deleted 
                ${this.#kind2type[batch[i].kind]}, id: 
                ${batch[i].data.id}`
          );
          return 1;
        }
      );
      // process aborted, stop recursion
      if (status == -1) {
        if (i == 0) {
          await this.display.log(
            "<span class='red bold'>aborting process</span>"
          );
        } else {
          await this.display.log(
            "<span class='red bold'>aborting process</span>",
            "reset cooldown to 30 seconds"
          );
          this.display.setCooldown(30);
        }
        return deleted;
      }
      // failed due to too many requests, stop recursion
      if (status == 0) {
        await this.display.log(
          `failed to delete 
            ${this.#kind2type[batch[i].kind]}, id: 
            ${batch[i].data.id}`
        );
        return deleted;
      }
      deleted++;
    }

    // repopulate batch array
    /*batch = await this.getUserItems(username, itemType, token);
    if (!batch || batch.length == 0) {
      return deleted;
    }

    // sleep 60 seconds
    if (deleted > 0) {
      this.display.log("sleeping for 30 seconds...");
      this.display.setCooldown(30, false);
      await new Promise((resolve) => setTimeout(resolve, 30000));
    }
    return deleted + (await this.deleteBatch(username, itemType, token, batch));*/
    return deleted;
  }

  // deletes all user items
  async deleteAllUserItems(itemType) {
    // if cooldown active, warn and quit
    const cooldown = await chrome.storage.local.get("cooldown").cooldown;
    if (cooldown && Date.now() < cooldown.expiry) {
      const remaining = this.display.calcCooldown(cooldown.expiry);
      if (remaining > 0) {
        return await this.display.log(
          "<span class='orange'>on cooldown</span>, please try again in " +
            remaining +
            " seconds"
        );
      }
    }

    this.paused = false;
    this.display.lock();
    this.display.unlock("abort");
    // first get oauth token
    let token = await this.authenticate();

    // next get username
    const username = await this.getUser(token);
    if (!username) {
      this.display.unlock();
      this.display.lock("abort");
      return;
    }

    /*let i = 0;
    const postComment = async () => {
      const response = await this.request(
        "POST",
        `https://oauth.reddit.com/api/comment`,
        token,
        "parent=t3_19btar4&text=test"
      );
      console.log(response);
      setTimeout(function () {
        i++;
        if (i < 1000) {
          postComment();
        }
      }, 5000);
    };
    postComment();
    return;*/

    await this.display.log("<span class='green'>starting</span> deletion");

    let totalDeleted = 0;
    while (!this.paused) {
      // get batch of items
      const batch = await this.getUserItems(username, itemType, token);
      if (!batch) {
        this.display.unlock();
        this.display.lock("abort");
        break;
      }

      // begin recursive delete sequence
      const deleted = await this.deleteBatch(username, itemType, token, batch);
      if (deleted > 0) {
        totalDeleted += deleted;
        chrome.storage.local.get("usage").then((data) => {
          if (data.usage) {
            data.usage.uses++;
            data.usage.deleted += deleted;
          } else {
            data.usage = {
              uses: 1,
              deleted: deleted,
            };
          }
          chrome.storage.local
            .set({
              usage: data.usage,
            })
            .then(() => {
              this.display.displayUsage(data.usage);
            });
        });
      } else {
        break;
      }
      this.display.log("sleeping for 30 seconds...");
      this.display.setCooldown(30, false);
      await new Promise((resolve) => setTimeout(resolve, 30000));
    }

    // loop ended, unlock and log
    this.display.unlock();
    this.display.lock("abort");
    await this.display.log(
      "<span class='blue'>stopping</span>, deleted: " + totalDeleted
    );
  }

  // delete all user comments
  deleteUserComments() {
    this.deleteAllUserItems(this.#ItemType.COMMENT);
  }

  // delete all user posts
  deleteUserPosts() {
    this.deleteAllUserItems(this.#ItemType.POST);
  }
}

export default Nuker;
