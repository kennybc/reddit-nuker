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
    this.#unlock(this.#ItemType.POST);
    this.#addClickEvent("comments", this.deleteUserComments);
    this.#addClickEvent("submitted", this.deleteUserPosts);
    this.#addClickEvent("abort", this.abort);
  }

  #addClickEvent(elementId, callback) {
    let element = document.getElementById(elementId);
    callback = callback.bind(this);
    element.addEventListener("click", () => {
      if (element.classList.contains("active")) {
        callback();
      }
    });
  }

  abort() {
    this.#paused = true;
  }

  #lock(elementId) {
    document.getElementById(elementId).classList.remove("active");
  }

  #unlock(elementId) {
    document.getElementById(elementId).classList.add("active");
  }

  async #log(...message) {
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
      if (data.cooldown && Date.now() < data.cooldown.expiry) {
        this.#lock(this.#ItemType.COMMENT);
        this.#lock(this.#ItemType.POST);
        this.#unlock("cooldown");
        let tick = window.setInterval(() => {
          document.getElementById("timer").innerHTML = this.#getCooldown(
            data.cooldown.expiry
          );
        }, 1000);
        document.getElementById("timer").innerHTML = this.#getCooldown(
          data.cooldown.expiry
        );
        this.#setClock(data.cooldown.expiry, data.cooldown.duration);
        window.setTimeout(() => {
          this.#unlock(this.#ItemType.COMMENT);
          this.#unlock(this.#ItemType.POST);
          this.#lock("cooldown");
          document.getElementById("timer").innerHTML = "";
          window.clearInterval(tick);
        }, data.cooldown.expiry - Date.now());
      }
    });
  }

  async #displayLog() {
    chrome.storage.local.get("log").then((data) => {
      console.log(data.log);
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
      .set({
        cooldown: {
          expiry: Date.now() + seconds * 1000,
          duration: seconds,
        },
      })
      .then(() => this.#displayCooldown());
  }

  // gets the difference between current time and cooldown expiry time
  #getCooldown(expiry) {
    return Math.max(Math.round((expiry - Date.now()) / 1000), 0);
  }

  #setClock(expiry, duration) {
    let clockLeft = document.getElementById("clock-left");
    let clockRight = document.getElementById("clock-right");
    const skip = duration - this.#getCooldown(expiry);
    clockLeft.style.animation =
      "mask " + duration + "s -" + skip + "s steps(1, end) forwards";
    clockRight.style.animation =
      "tick " + duration + "s -" + skip + "s linear forwards";
  }

  // get user data if not already set
  async #getUserData() {
    return chrome.storage.local.get("config").then(async (data) => {
      if (typeof data.config !== "undefined") {
        return {
          username: data.config.username,
          modhash: data.config.modhash,
        };
      }
      await this.#log(
        "<span class='green'>starting</span> to scrape user data..."
      );
      return chrome.tabs
        .create({ url: "https://old.reddit.com/", active: false })
        .then((tab) => this.#scrapeUserData(tab))
        .then(async (config) => {
          if (!config.logged) {
            await this.#log(
              "<span class='orange'>error</span>, please login to Reddit first"
            );
            return false;
          }
          await this.#log(
            "<span class='blue'>stopping</span>, successfully saved user data"
          );
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
      .then(async (response) => {
        if (!response.ok) {
          await this.#log(
            "<span class='orange'>on cooldown</span>, too many requests"
          );
          this.#setCooldown(600);
          return false;
        }
        return response.json();
      })
      .then((json) => json.data.children)
      .catch(async (error) => {
        await this.#log("<span class='red'>error</span>" + error);
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
      .catch(async (error) => {
        await this.#log("<span class='red'>error</span>" + error);
      });
  }

  // delete a number of items from a given array
  async #deleteBatch(modhash, array) {
    let numDeleted = 0;
    for (let i = 0; i < array.length; i++) {
      // 1 if successful, 0 if unsuccessful, -1 if process aborted
      let status = await this.#deleteById(modhash, array[i].data.name).then(
        async (response) => {
          if (response == 200) {
            await this.#log(
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
        await this.#log("<span class='red bold'>aborting process</span>");
        return numDeleted;
      }
      numDeleted += status;
    }
    return numDeleted;
  }

  // submit a GET request to Reddit to retrieve comment or post history json
  async #deleteUserItems(itemType) {
    if (!window.navigator.onLine)
      return await this.#log(
        "<span class='red'>error</span>, no internet connection"
      );
    chrome.storage.local.get("cooldown").then(async (data) => {
      if (data.cooldown && Date.now() < data.cooldown.expiry) {
        const cooldown = this.#getCooldown(data.cooldown.expiry);
        if (cooldown > 0) {
          return await this.#log(
            "<span class='orange'>on cooldown</span>, please try again in " +
              cooldown +
              " seconds"
          );
        }
      }
      this.#paused = false;
      this.#lock(itemType);
      // first get user data
      this.#getUserData().then((data) => {
        this.#log("<span class='green'>starting</span> deletion...");
        // next get user item (post/comment) history
        this.#getUserItems(data.username, itemType).then(async (response) => {
          let unlock = false;
          if (typeof variable == "boolean" && !response) {
            unlock = true;
          } else if (response.length == 0) {
            await this.#log(
              "<span class='blue'>stopping</span>, no more left to delete"
            );
            unlock = true;
          } else {
            this.#unlock("abort");
            this.#deleteBatch(data.modhash, response).then(
              async (numDeleted) => {
                await this.#log(
                  "<span class='blue'>stopping</span>, total deleted: " +
                    numDeleted,
                  "reset cooldown to 60 seconds"
                );
                this.#setCooldown(60);
                this.#lock("abort");
              }
            );
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
