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

  async getUser() {
    try {
      const response = await this.auth.request(
        "GET",
        "https://oauth.reddit.com/api/v1/me"
      );
      return response.name;
    } catch (e) {
      this.display.error(e.message);
      this.display.setCooldown(30);
    }
  }

  // submit a GET request to Reddit to retrieve comment or post history json
  async getUserItems(username, itemType) {
    try {
      const response = await this.auth.request(
        "GET",
        `https://oauth.reddit.com/user/${username}/${itemType}.json?limit=${this.batchSize}`
      );
      return response.data.children;
    } catch (e) {
      this.display.error(e.message);
      this.display.setCooldown(30);
    }
  }

  // submit a POST request to Reddit API to delete an item of given ID
  async deleteById(id) {
    // process has been aborted; quit now
    if (this.paused) {
      return -1;
    }
    try {
      const response = await this.auth.request(
        "POST",
        `https://oauth.reddit.com/api/del?id=${id}`
      );
      return 1;
    } catch (e) {
      this.display.error(e.message);
      this.display.setCooldown(30);
      return 0;
    }
  }

  // deletes a batch of items
  async deleteBatch(batch = []) {
    // 1 if successful, 0 if unsuccessful, -1 if process aborted
    let deleted = 0;
    for (let i = 0; i < batch.length; i++) {
      let status = await this.deleteById(batch[i].data.name);

      // process aborted, stop recursion
      if (status == -1) {
        this.display.log("<span class='red bold'>aborting process</span>");
        if (i > 0) {
          await this.display.log("reset cooldown to 30 seconds");
          this.display.setCooldown(30);
        }
        return deleted;
      }
      // failed due to too many requests, stop recursion
      if (status == 0) {
        this.display.error(
          `failed to delete 
            ${this.#kind2type[batch[i].kind]}, id: 
            ${batch[i].data.id}`
        );
        return deleted;
      }

      await this.display.log(
        `deleted 
            ${this.#kind2type[batch[i].kind]}, id: 
            ${batch[i].data.id}`
      );
      deleted++;
    }
    return deleted;
  }

  // deletes #batchSize user items
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

    // first login with oauth
    try {
      await this.auth.authenticate();
    } catch (e) {
      this.display.error("user declined auth process");
      this.display.unlock();
      this.display.lock("abort");
      return;
    }

    // next get username
    const username = await this.getUser();
    if (!username) {
      this.display.unlock();
      this.display.lock("abort");
      return;
    }

    await this.display.log("<span class='green'>starting</span> deletion");

    const batch = await this.getUserItems(username, itemType);
    if (!batch || batch.length == 0) {
      this.display.unlock();
      this.display.lock("abort");
      this.display.log("<span class='blue'>stopping</span>, no items found");
      return;
    }

    const deleted = await this.deleteBatch(batch);

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
