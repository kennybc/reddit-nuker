import Display from "./display.js";
import Auth from "./auth.js";

// todo: make consistent use of async/await vs promises
class Nuker {
  constructor() {
    this.batchSize = 50;
    this.paused = false;
    this.version = chrome.runtime.getManifest().version;
    this.display = new Display();
    this.auth = new Auth();
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

  request(method, url, token, body) {
    return fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": `Chrome:reddit-nuker:v${this.version} (by /u/kenny-b-c)`,
      },
      body,
    })
      .then(async (response) => {
        // 401 = too many requests
        if (!response.ok) {
          this.display.log(
            "<span class='orange'>on cooldown</span>, too many requests"
          );
          this.display.log(response.status);
          this.display.setCooldown(30);
          return response.text();
        }
        return response.json();
      })
      .catch(async (error) => {
        this.display.error(error);
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
        await this.display.log(
          "<span class='red bold'>aborting process</span>"
        );
        if (i > 0) {
          await this.display.log("reset cooldown to 30 seconds");
          this.display.setCooldown(30);
        }
        return deleted;
      }
      // failed due to too many requests, stop recursion
      if (status == 0) {
        await this.display.error(
          `failed to delete 
            ${this.#kind2type[batch[i].kind]}, id: 
            ${batch[i].data.id}`
        );
        return deleted;
      }
      deleted++;
    }
    return deleted;
  }

  // deletes all user items
  async deleteUserItems(itemType) {
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
    let token;
    try {
      token = await this.auth.authenticate();
    } catch (e) {
      this.display.error("user declined auth process");
      this.display.unlock();
      this.display.lock("abort");
      return;
    }

    // next get username
    const username = await this.getUser(token);
    if (!username) {
      this.display.unlock();
      this.display.lock("abort");
      return;
    }

    await this.display.log("<span class='green'>starting</span> deletion");

    const batch = await this.getUserItems(username, itemType, token);
    if (!batch || batch.length == 0) {
      this.display.unlock();
      this.display.lock("abort");
      this.display.log("<span class='blue'>stopping</span>, no items found");
      return;
    }

    const deleted = await this.deleteBatch(username, itemType, token, batch);

    const data = await chrome.storage.local.get("usage");
    if (data.usage) {
      data.usage.uses++;
      data.usage.deleted += deleted;
    } else {
      data.usage = {
        uses: 1,
        deleted: deleted,
      };
    }
    await chrome.storage.local.set({
      usage: data.usage,
    });

    this.display.displayUsage(data.usage);
    this.display.lock("abort");
    this.display.log("<span class='blue'>stopping</span>, deleted: " + deleted);
    this.display.log("reset cooldown to 30 seconds");
    this.display.setCooldown(30);
  }

  // delete all user comments
  deleteUserComments() {
    this.deleteUserItems(this.#ItemType.COMMENT);
  }

  // delete all user posts
  deleteUserPosts() {
    this.deleteUserItems(this.#ItemType.POST);
  }
}

export default Nuker;
