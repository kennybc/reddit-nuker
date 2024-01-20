// todo: convert mixed use of await/.then to consistent form
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
  abort() {
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
  #lock(elementId) {
    this.#message({ message: "lock", what: elementId });
  }

  // "unlocks" and element (button); restores appearance and functionality
  #unlock(elementId) {
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
  async #displayCooldown(cooldown) {
    this.#message({ message: "display-cooldown", what: cooldown });
  }

  // sets the cooldown to a given number of seconds
  async #setCooldown(seconds) {
    let cooldown = {
      expiry: Date.now() + seconds * 1000,
      duration: seconds,
    };
    chrome.storage.local
      .set({
        cooldown: cooldown,
      })
      .then(() => this.#displayCooldown(cooldown));
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

  // get user data if not already set
  async #getUserData() {
    /*return chrome.storage.local.get("config").then(async (data) => {
      // if user data already saved to storage, retrieve it
      if (typeof data.config !== "undefined") {
        return {
          username: data.config.username,
          modhash: data.config.modhash,
        };
      }*/
    // don't store data locally in case user logs out, modhash will be invalid
    await this.log("scraping user data...");
    return chrome.tabs
      .create({ url: "https://old.reddit.com/", active: false }) // config easier to read in old site
      .then((tab) => this.#scrapeUserData(tab)) // scrapes user config
      .then(async (config) => {
        // not logged in
        if (!config.logged) {
          await this.log(
            "<span class='red'>error</span>, please login to Reddit first"
          );
          return false;
        }
        /*return chrome.storage.local
          .set({
            config: {
              username: config.logged,
              modhash: config.modhash,
            },
          })
          .then(() => {*/
        return {
          username: config.logged,
          modhash: config.modhash,
        };
      });
  }

  // scrapes user data from a given tab
  async #scrapeUserData(tab) {
    return (
      chrome.scripting
        // inject script in the given tab
        .executeScript({
          target: { tabId: tab.id },
          // the script: find and parse user config
          func: () => {
            return JSON.parse(
              document.getElementById("config").innerText.slice(8, -1)
            );
          },
        })
        // close tab and return scraped config
        .then((result) => {
          chrome.tabs.remove(tab.id);
          return result[0].result;
        })
    );
  }

  // submit a GET request to Reddit to retrieve comment or post history json
  async #getUserItems(username, itemType) {
    return fetch(
      new Request(
        `https://www.reddit.com/user/${username}/${itemType}.json?limit=${
          this.#batchSize
        }`,
        {
          method: "GET",
          headers: new Headers({
            "Content-Type": "application/json",
            "User-Agent":
              "Chrome:reddit-nuker:v" + this.#version + " (by /u/Skabop)",
          }),
        }
      )
    )
      .then(async (response) => {
        // see README for info on request limits
        if (!response.ok) {
          await this.log(
            "<span class='orange'>on cooldown</span>, too many requests"
          );
          this.#setCooldown(600);
          return false;
        }
        return response.json();
      })
      .then((json) => {
        if (!json) {
          return false;
        }
        return json.data.children;
      })
      .catch(async (error) => {
        await this.log("<span class='red'>error</span>, " + error);
      });
  }

  // submit a POST request to Reddit API to delete an item of given ID
  async #deleteById(modhash, id) {
    // process has been aborted; quit now
    if (this.#paused) {
      return new Promise((resolve) => {
        resolve(-1);
      });
    }
    return fetch(
      new Request(`https://www.reddit.com/api/del?id=${id}`, {
        method: "POST",
        headers: new Headers({
          "X-Modhash": modhash,
          "Content-Type": "application/json",
          "User-Agent":
            "Chrome:reddit-nuker:v" + this.#version + " (by /u/Skabop)",
        }),
      })
    )
      .then(async (response) => {
        if (!response.ok) {
          await this.log(
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

  // delete a number of items from a given array
  async #deleteBatch(username, modhash, itemType, array = [], index = 0) {
    // check if batch needs to be repopulated, quit if no more left
    if (index == array.length) {
      const items = await this.#getUserItems(username, itemType);
      if (items && items.length > 0) {
        array = items;
        index = 0;
      } else {
        return 0;
      }
    }

    // 1 if successful, 0 if unsuccessful, -1 if process aborted
    let status = await this.#deleteById(modhash, array[index].data.name).then(
      async (response) => {
        if (typeof response == "boolean" && !response) {
          return 0;
        } else if (response == 200) {
          await this.log(
            `deleted 
                ${this.#kind2type[array[index].kind]}, id: 
                ${array[index].data.id}`
          );
          return 1;
        }
        return response;
      }
    );
    // process aborted, stop recursion
    if (status == -1) {
      await this.log("<span class='red bold'>aborting process</span>");
      return status;
    }
    // failed due to too many requests, stop recursion
    if (status == 0) {
      await this.log(
        `failed to delete 
            ${this.#kind2type[array[index].kind]}, id: 
            ${array[index].data.id}`
      );
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
    return (
      status +
      (await this.#deleteBatch(username, modhash, itemType, array, index + 1))
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
    this.#lock(itemType);
    // first get user data
    this.#getUserData().then(async (data) => {
      if (typeof data == "boolean" && !data) {
        this.#unlock(itemType);
        return;
      }
      this.log("<span class='green'>starting</span> deletion...");

      // begin recursive delete sequence
      this.#deleteBatch(data.username, data.modhash, itemType).then(
        async (deleted) => {
          // finished deleting, unlock button, update usage stats
          this.#unlock(itemType);
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
            chrome.storage.local.set({
              usage: data.usage,
            });
          });
          await this.log(
            "<span class='blue'>stopping</span>, no more left to delete",
            "total deleted: " + deleted
          );
        }
      );
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
