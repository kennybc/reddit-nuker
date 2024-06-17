// todo: make consistent use of async/await vs promises
class Nuker {
  #batchSize = 100; // max = 100
  #paused = false;
  #version = chrome.runtime.getManifest().version;

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

  // abort any running recurring processes
  async abort() {
    await this.log("<span class='red bold'>abort signal sent</span>");
    this.#paused = true;
  }

  // sends a message to the popup interface to update the UI in some way
  async #message(message) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["POPUP"],
    });
    if (contexts.length > 0) {
      chrome.runtime.sendMessage(message);
    }
  }

  // "lock" an element (button); grays it out and disables functionality
  #lock(elementId = "all") {
    this.#message({ message: "lock", what: elementId });
  }

  // "unlocks" and element (button); restores appearance and functionality
  #unlock(elementId = "all") {
    this.#message({ message: "unlock", what: elementId });
  }

  // timestamps and saves a message or list of messages to local storage
  async log(...message) {
    let stamped = {
      time: new Intl.DateTimeFormat("en-GB", {
        hour: "numeric",
        minute: "numeric",
      }).format(new Date()),
      message: message.join("<br/>"),
    };
    return chrome.storage.local.get("log").then((data) => {
      if (data.log) {
        data.log.push(stamped);
      } else {
        data.log = [stamped];
      }
      chrome.storage.local
        .set({
          log: data.log,
        })
        .then(() => {
          this.#print(stamped);
        });
    });
  }

  // prints a stamped message to the UI
  #print(stamped) {
    this.#message({ message: "print", what: stamped });
  }

  // fetch and display extension/usage info
  async #displayUsage(usage) {
    this.#message({ message: "display-usage", what: usage });
  }

  // if a cooldown exists, display it in the UI
  async #displayCooldown(cooldown, useLocks = true) {
    this.#message({
      message: "display-cooldown",
      what: {
        cooldown,
        useLocks,
      },
    });
  }

  // sets the cooldown to a given number of seconds
  async #setCooldown(seconds, useLocks = true) {
    let cooldown = {
      expiry: Date.now() + seconds * 1000,
      duration: seconds,
    };
    chrome.storage.local
      .set({
        cooldown: cooldown,
      })
      .then(() => this.#displayCooldown(cooldown, useLocks));
  }

  // gets the cooldown
  async getCooldown() {
    return chrome.storage.local.get("cooldown").then((data) => {
      // if user data already saved to storage, retrieve it
      if (data.cooldown) {
        return data.cooldown;
      }
      return false;
    });
  }

  // gets the log
  async getLog() {
    return chrome.storage.local.get("log").then((data) => {
      if (data.log) {
        return data.log;
      }
      return [];
    });
  }

  // gets the usage info
  async getUsage() {
    return chrome.storage.local.get("usage").then((data) => {
      if (data.usage) {
        return data.usage;
      }
      return {
        uses: 0,
        deleted: 0,
      };
    });
  }

  // gets the difference between current time and cooldown expiry time
  #calcCooldown(expiry) {
    return Math.max(Math.round((expiry - Date.now()) / 1000), 0);
  }

  // get oauth token
  async authenticate() {
    // prompt oauth access from user and get code
    return (
      chrome.identity
        .launchWebAuthFlow({
          interactive: true,
          url: `https://www.reddit.com/api/v1/authorize?client_id=2uzE9BzrjCHLKcwzGjjh8w&response_type=code&state=123&redirect_uri=${chrome.identity.getRedirectURL()}&duration=temporary&scope=submit+edit+history`,
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
              "User-Agent": `Chrome:reddit-nuker:v${
                this.#version
              } (by /u/Skabop)`,
            },
            body: `grant_type=authorization_code&code=${encodeURIComponent(
              code
            )}&redirect_uri=${encodeURI(chrome.identity.getRedirectURL())}`,
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
        "User-Agent": `Chrome:reddit-nuker:v${this.#version} (by /u/Skabop)`,
      },
      body,
    });
  }

  // submit a GET request to Reddit to retrieve comment or post history json
  async #getUserItems(username, itemType, token) {
    return this.request(
      "GET",
      `https://oauth.reddit.com/user/${username}/${itemType}.json?limit=${
        this.#batchSize
      }`,
      token
    )
      .then((response) => {
        console.log(response);
        // see README for info on request limits
        if (!response.ok) {
          this.log(
            "<span class='orange'>on cooldown</span>, too many requests"
          );
          //this.#setCooldown(600);
          return false;
        }
        return response.json();
      })
      .then((json) => {
        if (!json) {
          return false;
        }
        console.log(json.data.children);
        return json.data.children;
      })
      .catch(async (error) => {
        await this.log("<span class='red'>error</span>, " + error);
      });
  }

  // submit a POST request to Reddit API to delete an item of given ID
  async #deleteById(id, token) {
    // process has been aborted; quit now
    if (this.#paused) {
      return new Promise((resolve) => {
        resolve(-1);
      });
    }
    return this.request(
      "POST",
      `https://oauth.reddit.com/api/del?id=${id}`,
      token
    )
      .then((response) => {
        console.log(response);
        if (!response.ok) {
          this.log(
            "<span class='orange'>on cooldown</span>, too many requests"
          );
          this.#setCooldown(600);
          return false;
        }
        return response.status;
      })
      .catch(async (error) => {
        await this.log("<span class='red'>error</span>, " + error);
      });
  }

  // gets a batch of items and then deletes them
  // recurses until none left or aborted
  async #deleteBatch(username, token, itemType, array = []) {
    // 1 if successful, 0 if unsuccessful, -1 if process aborted
    let deleted = 0;
    for (let i = 0; i < array.length; i++) {
      let status = await this.#deleteById(array[i].data.name, token).then(
        async (response) => {
          if (typeof response == "boolean" && !response) {
            return 0;
          } else if (response == 200) {
            await this.log(
              `deleted 
                ${this.#kind2type[array[i].kind]}, id: 
                ${array[i].data.id}`
            );
            return 1;
          }
          return response;
        }
      );
      // process aborted, stop recursion
      if (status == -1) {
        if (i == 0) {
          await this.log("<span class='red bold'>aborting process</span>");
        } else {
          await this.log(
            "<span class='red bold'>aborting process</span>",
            "reset cooldown to 60 seconds"
          );
          this.#setCooldown(60);
        }
        return deleted;
      }
      // failed due to too many requests, stop recursion
      if (status == 0) {
        await this.log(
          `failed to delete 
            ${this.#kind2type[array[i].kind]}, id: 
            ${array[i].data.id}`
        );
        return deleted;
      }
      deleted++;
    }

    // repopulate array
    array = await this.#getUserItems(username, itemType, token);
    if (!array || array.length == 0) {
      return deleted;
    }

    // sleep 60 seconds
    if (deleted > 0) {
      this.log("sleeping for 10 seconds...");
      this.#setCooldown(10, false);
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }
    return (
      deleted + (await this.#deleteBatch(username, token, itemType, array))
    );
  }

  // deletes all user items
  async #deleteAllUserItems(itemType) {
    // if cooldown active, warn and quit
    const cooldown = await chrome.storage.local.get("cooldown").cooldown;
    if (cooldown && Date.now() < cooldown.expiry) {
      const remaining = this.#calcCooldown(cooldown.expiry);
      if (remaining > 0) {
        return await this.log(
          "<span class='orange'>on cooldown</span>, please try again in " +
            remaining +
            " seconds"
        );
      }
    }

    this.#paused = false;
    this.#lock();
    this.#unlock("abort");
    // first get user data
    let token = await this.authenticate();
    this.log(token);

    // begin recursive delete sequence
    this.#deleteBatch("Skabop", token, itemType).then(async (deleted) => {
      // finished deleting, unlock buttons, update usage stats
      this.#unlock();
      this.#lock("abort");
      if (deleted > 0) {
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
              this.#displayUsage(data.usage);
            });
        });
      }
      await this.log("<span class='blue'>stopping</span>, deleted: " + deleted);
    });
  }

  // delete all user comments
  deleteUserComments() {
    this.#deleteAllUserItems(this.#ItemType.COMMENT);
  }

  // delete all user posts
  deleteUserPosts() {
    this.#deleteAllUserItems(this.#ItemType.POST);
  }
}

let nuker;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (typeof nuker === "undefined") {
    nuker = new Nuker();
  }
  switch (request.message) {
    case "delete-comments":
      nuker.deleteUserComments();
      break;
    case "delete-posts":
      nuker.deleteUserPosts();
      break;
    case "abort":
      nuker.abort();
      break;
    case "get-cooldown":
      nuker.getCooldown().then((data) => {
        sendResponse({ data: data });
      });
      return true;
    case "get-log":
      nuker.getLog().then((data) => {
        sendResponse({ data: data });
      });
      return true;
    case "get-usage":
      nuker.getUsage().then((data) => {
        sendResponse({ data: data });
      });
      return true;
  }
  sendResponse();
});
