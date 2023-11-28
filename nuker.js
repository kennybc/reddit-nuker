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
  }

  kill() {
    this.#paused = true;
  }

  #log(message) {
    let log = document.getElementById("log");
    let line = document.createElement("p");
    line.innerHTML = message;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  #displayCooldown() {
    chrome.storage.local.get("cooldown").then((data) => {
      if (Date.now() < data.cooldown) {
        document.getElementById("comments").classList.add("disabled");
        document.getElementById("posts").classList.add("disabled");
        document.getElementById("kill").classList.add("disabled");
        let tick = window.setInterval(() => {
          chrome.storage.local.get("cooldown").then((data) => {
            document.getElementById("cooldown").innerHTML = Math.round(
              (data.cooldown - Date.now()) / 1000
            );
          });
        }, 1000);
        window.setTimeout(() => {
          document.getElementById("comments").classList.remove("disabled");
          document.getElementById("posts").classList.remove("disabled");
          document.getElementById("kill").classList.remove("disabled");
          document.getElementById("cooldown").innerHTML = "";
          window.clearInterval(tick);
        }, data.cooldown - Date.now());
      }
    });
  }

  #resetCooldown() {
    chrome.storage.local
      .set({ cooldown: Date.now() + 60000 })
      .then(() => this.#displayCooldown());
  }

  // get user data if not already set
  async #getUserData() {
    chrome.storage.local.get("config").then((data) => {
      if (typeof data.config !== "undefined") {
        return true;
      }
      return chrome.tabs
        .create({ url: "https://old.reddit.com/", active: false })
        .then((tab) => this.#scrapeUserData(tab))
        .then((config) => {
          if (!config.logged) {
            return this.#log("not logged in");
          }
          return chrome.storage.local.set({
            config: {
              username: config.logged,
              modhash: config.modhash,
            },
          });
        });
    });
  }

  // scrapes user data from a given tab,
  // returns a Promise containing that data when resolved
  #scrapeUserData(tab) {
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

  #getUserItems(username, itemType) {
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
          return false;
        }
        return response.json();
      })
      .then((json) => json.data.children);
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
    ).then((response) => {
      return response.status;
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
  #deleteUserItems(itemType) {
    chrome.storage.local.get("cooldown").then((data) => {
      if (Date.now() < data.cooldown) {
        return this.#log(
          "on cooldown, please try again in " +
            Math.round((data.cooldown - Date.now()) / 1000) +
            " seconds"
        );
      }
      this.#paused = false;
      // first get user data
      this.#getUserData().then(() =>
        // next get user item (post/comment) history
        chrome.storage.local.get("config").then((data) => {
          this.#getUserItems(data.config.username, itemType).then(
            (response) => {
              if (response.length == 0) {
                return this.#log("no more left to delete");
              }

              this.#deleteBatch(data.config.modhash, response).then(
                (numDeleted) => {
                  this.#log("total deleted: " + numDeleted);
                  this.#resetCooldown();
                }
              );
            }
          );
        })
      );
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

let nuker = new Nuker();

document.getElementById("comments").addEventListener("click", () => {
  nuker.deleteUserComments();
});
document.getElementById("posts").addEventListener("click", () => {
  nuker.deleteUserPosts();
});
document.getElementById("kill").addEventListener("click", () => {
  nuker.kill();
});
