class Nuker {
  #batchSize = 100; // max = 100
  #paused = false;

  // enum for item types
  #ItemType = Object.freeze({
    COMMENT: "comments",
    POST: "submitted",
  });

  #id2kind = {
    t1: "comment",
    t3: "post",
  };

  constructor() {
    this.#displayCooldown();
    this.#displayLog();
    this.#unlock(this.#ItemType.COMMENT);
    //this.#unlock(this.#ItemType.POST);
    this.#addClickEvent("comments", this.deleteUserComments);
    this.#addClickEvent("submitted", this.deleteUserPosts);
    this.#addClickEvent("abort", this.abort);
  }

  #addClickEvent(elementId, callback) {
    let element = document.getElementById(elementId);
    callback = callback.bind(this);
    element.addEventListener("click", () => {
      if (element.classList.contains("unlocked")) {
        callback();
      }
    });
  }

  abort() {
    this.#paused = true;
  }

  #lock(elementId) {
    document.getElementById(elementId).classList.remove("unlocked");
  }

  #unlock(elementId) {
    document.getElementById(elementId).classList.add("unlocked");
  }

  #log(...message) {
    let stamped = {
      time: new Intl.DateTimeFormat("en-GB", {
        hour: "numeric",
        minute: "numeric",
      }).format(new Date()),
      message: message.join("<br/>"),
    };
    chrome.storage.local.get("log").then((data) => {
      if (data.log) {
        data.log.push(stamped);
      } else {
        data.log = [stamped];
      }
      chrome.storage.local.set({
        log: data.log,
      });
    });
    this.#print(stamped);
  }
  #print(stamped) {
    let log = document.getElementById("log");
    let line = document.createElement("div");
    let time = document.createElement("div");
    let msg = document.createElement("div");
    time.innerHTML = stamped.time;
    time.classList.add("log-time");
    msg.innerHTML = stamped.message;
    msg.classList.add("log-message");
    line.appendChild(time);
    line.appendChild(msg);
    line.classList.add("log-line");
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  async #displayCooldown() {
    chrome.storage.local.get("cooldown").then((data) => {
      if (Date.now() < data.cooldown) {
        this.#lock(this.#ItemType.COMMENT);
        this.#lock(this.#ItemType.POST);
        let tick = window.setInterval(() => {
          chrome.storage.local.get("cooldown").then((data) => {
            document.getElementById("cooldown").innerHTML = Math.round(
              (data.cooldown - Date.now()) / 1000
            );
          });
        }, 1000);
        window.setTimeout(() => {
          this.#unlock(this.#ItemType.COMMENT);
          this.#unlock(this.#ItemType.POST);
          document.getElementById("cooldown").innerHTML = "";
          window.clearInterval(tick);
        }, data.cooldown - Date.now());
      }
    });
  }

  async #displayLog() {
    chrome.storage.local.get("log").then((data) => {
      if (data.log) {
        data.log.forEach((stamped) => {
          this.#print(stamped);
        });
      }
    });
  }

  // sets the cooldown in seconds
  async #setCooldown(seconds) {
    chrome.storage.local
      .set({ cooldown: Date.now() + seconds * 1000 })
      .then(() => this.#displayCooldown());
  }

  // gets the difference between current time and cooldown expiry time
  async #getCooldown() {
    chrome.storage.local.get("cooldown").then((data) => {
      return Math.max(Math.round((data.cooldown - Date.now()) / 1000), 0);
    });
  }

  // get user data if not already set
  async #getUserData() {
    return chrome.storage.local.get("config").then((data) => {
      if (typeof data.config !== "undefined") {
        return {
          username: data.config.username,
          modhash: data.config.modhash,
        };
      }
      this.#log("scraping user data...");
      return chrome.tabs
        .create({ url: "https://old.reddit.com/", active: false })
        .then((tab) => this.#scrapeUserData(tab))
        .then((config) => {
          if (!config.logged) {
            this.#log("not logged in");
            return false;
          }
          this.#log("saved user data");
          return chrome.storage.local
            .set({
              config: {
                username: config.logged,
                modhash: config.modhash,
              },
            })
            .then(() => {
              return {
                username: config.logged,
                modhash: config.modhash,
              };
            });
        });
    });
  }

  // scrapes user data from a given tab,
  // returns a Promise containing that data when resolved
  async #scrapeUserData(tab) {
    return (
      chrome.scripting
        // inject script
        .executeScript({
          target: { tabId: tab.id },
          func: () => {
            return JSON.parse(
              document.getElementById("config").innerText.slice(8, -1)
            );
          },
        })
        // close tab and return data
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
            "User-Agent": "Chrome:reddit-nuker:v1.0 (by /u/Skabop)",
          }),
        }
      )
    )
      .then((response) => {
        if (!response.ok) {
          this.#log("too many requests!");
          this.#setCooldown(600);
          return false;
        }
        return response.json();
      })
      .then((json) => json.data.children)
      .catch((error) => {
        this.#log(error);
      });
  }

  // submit a POST request to Reddit API to delete an item of given ID
  async #deleteById(modhash, id) {
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
          "User-Agent": "Chrome:reddit-nuker:v1.0 (by /u/Skabop)",
        }),
      })
    )
      .then((response) => {
        return response.status;
      })
      .catch((error) => {
        this.#log(error);
      });
  }

  // delete a number of items from a given array
  async #deleteBatch(modhash, array) {
    let numDeleted = 0;
    for (let i = 0; i < array.length; i++) {
      // 1 if successful, 0 if unsuccessful, -1 if process killed
      let status = await this.#deleteById(modhash, array[i].data.name).then(
        (response) => {
          if (response == 200) {
            this.#log(
              `deleted 
                ${this.#id2kind[array[i].kind]}, id: 
                ${array[i].data.id}`
            );
            return 1;
          }
          return response;
        }
      );
      if (status == -1) {
        this.#log("process killed");
        return numDeleted;
      }
      numDeleted += status;
    }
    return numDeleted;
  }

  // submit a GET request to Reddit to retrieve comment or post history json
  async #deleteUserItems(itemType) {
    if (!window.navigator.onLine) return this.#log("no internet connection");
    this.#getCooldown().then((cooldown) => {
      if (cooldown > 0) {
        return this.#log(
          "on cooldown, please try again in " + cooldown + " seconds"
        );
      }
      this.#paused = false;
      this.#lock(itemType);
      // first get user data
      this.#getUserData().then((data) => {
        this.#log("deleting...");
        // next get user item (post/comment) history
        this.#getUserItems(data.username, itemType).then((response) => {
          let unlock = false;
          if (typeof variable == "boolean" && !response) {
            unlock = true;
          } else if (response.length == 0) {
            this.#log("no more left to delete");
            unlock = true;
          } else {
            this.#deleteBatch(data.modhash, response).then((numDeleted) => {
              this.#log(
                "total deleted: " + numDeleted,
                "reset cooldown to 60 seconds"
              );
              this.#setCooldown(60);
            });
          }
          if (unlock) {
            this.#unlock(itemType);
          }
        });
      });
    });
  }

  // delete all user comments
  deleteUserComments() {
    this.#deleteUserItems(this.#ItemType.COMMENT);
  }
  deleteUserPosts() {
    this.#deleteUserItems(this.#ItemType.POST);
  }
}

let nuker = new Nuker(document);
