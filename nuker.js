// todo: convert mixed use of await/.then to consistent form
class Nuker {
  #batchSize = 100; // max = 100
  #paused = false;

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

  constructor() {
    this.#displayCooldown();
    this.#displayLog();
    this.#unlock(this.#ItemType.COMMENT);
    this.#unlock(this.#ItemType.POST);
    this.#addClickEvent("comments", this.deleteUserComments);
    this.#addClickEvent("submitted", this.deleteUserPosts);
    this.#addClickEvent("abort", this.abort);
  }

  // add an event handler with given callback function to an element of given ID
  #addClickEvent(elementId, callback) {
    let element = document.getElementById(elementId);
    callback = callback.bind(this);
    element.addEventListener("click", () => {
      if (element.classList.contains("active")) {
        callback();
      }
    });
  }

  // abort any running recurring processes
  abort() {
    this.#paused = true;
  }

  // "lock" an element (button); grays it out and disables functionality
  #lock(elementId) {
    document.getElementById(elementId).classList.remove("active");
  }

  // "unlocks" and element (button); restores appearance and functionality
  #unlock(elementId) {
    document.getElementById(elementId).classList.add("active");
  }

  // timestamps and saves a message or list of messages to local storage
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

  // prints a stamped message to the UI
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

  // if a cooldown exists, display it in the UI
  async #displayCooldown() {
    chrome.storage.local.get("cooldown").then((data) => {
      if (data.cooldown && Date.now() < data.cooldown.expiry) {
        // lock actions and display cooldown panel
        this.#lock(this.#ItemType.COMMENT);
        this.#lock(this.#ItemType.POST);
        this.#unlock("cooldown");
        const cooldown = this.#getCooldown(data.cooldown.expiry);

        // every second, recalculate the remaining cooldown and update UI
        let tick = window.setInterval(() => {
          document.getElementById("timer").innerHTML = this.#getCooldown(
            data.cooldown.expiry
          );
        }, 1000);
        document.getElementById("timer").innerHTML = cooldown;

        // set animation of cooldown clock
        let clockLeft = document.getElementById("clock-left");
        let clockRight = document.getElementById("clock-right");
        const skip = data.cooldown.duration - cooldown;
        clockLeft.style.animation = "none";
        clockRight.style.animation = "none";
        clockLeft.offsetHeight;
        clockRight.offsetHeight;
        clockLeft.style.animation =
          "mask " +
          data.cooldown.duration +
          "s -" +
          skip +
          "s steps(1, end) forwards";
        clockRight.style.animation =
          "tick " + data.cooldown.duration + "s -" + skip + "s linear forwards";

        // after cooldown expires, unlock actions and hide cooldown panel
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

  // display logged messages in the UI
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

  // sets the cooldown to a given number of seconds
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

  // get user data if not already set
  async #getUserData() {
    return chrome.storage.local.get("config").then(async (data) => {
      // if user data already saved to storage, retrieve it
      if (typeof data.config !== "undefined") {
        return {
          username: data.config.username,
          modhash: data.config.modhash,
        };
      }
      // otherwise, scrape data
      await this.#log(
        "<span class='green'>starting</span> to scrape user data..."
      );
      return chrome.tabs
        .create({ url: "https://old.reddit.com/", active: false }) // config easier to read in old site
        .then((tab) => this.#scrapeUserData(tab)) // scrapes user config
        .then(async (config) => {
          // not logged in
          if (!config.logged) {
            await this.#log(
              "<span class='red'>error</span>, please login to Reddit first"
            );
            return false;
          }
          await this.#log(
            "<span class='blue'>stopping</span>, successfully saved user data"
          );
          // store scraped user config to local storage and return it
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
            "User-Agent": "Chrome:reddit-nuker:v1.0 (by /u/Skabop)",
          }),
        }
      )
    )
      .then(async (response) => {
        // see README for info on request limits
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
        await this.#log("<span class='red'>error</span>, " + error);
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
      .then(async (response) => {
        if (!response.ok) {
          await this.#log(
            "<span class='orange'>on cooldown</span>, too many requests"
          );
          this.#setCooldown(600);
          return false;
        }
        return response.status;
      })
      .catch(async (error) => {
        await this.#log("<span class='red'>error</span>, " + error);
      });
  }

  // delete a number of items from a given array
  async #deleteBatch(modhash, array) {
    let numDeleted = 0;
    for (let i = 0; i < array.length; i++) {
      // 1 if successful, 0 if unsuccessful, -1 if process aborted
      let status = await this.#deleteById(modhash, array[i].data.name).then(
        async (response) => {
          if (typeof response == "boolean" && !response) {
            return 0;
          } else if (response == 200) {
            await this.#log(
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
        await this.#log("<span class='red bold'>aborting process</span>");
        break;
      }
      // failed due to too many requests, stop recursion
      if (status == 0) {
        break;
      }
      numDeleted += status;
    }
    return numDeleted;
  }

  // submit a GET request to Reddit to retrieve comment or post history json
  async #deleteUserItems(itemType) {
    if (!window.navigator.onLine) {
      return await this.#log(
        "<span class='red'>error</span>, no internet connection"
      );
    }

    // if cooldown active, warn and quit
    const cooldown = await chrome.storage.local.get("cooldown").cooldown;
    if (cooldown && Date.now() < cooldown.expiry) {
      const remaining = this.#getCooldown(cooldown.expiry);
      if (remaining > 0) {
        return await this.#log(
          "<span class='orange'>on cooldown</span>, please try again in " +
            remaining +
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
        if (typeof response == "boolean" && !response) {
          unlock = true;
        } else if (response.length == 0) {
          await this.#log(
            "<span class='blue'>stopping</span>, no more left to delete"
          );
          unlock = true;
        } else {
          // nothing went wrong and there are items to delete
          this.#unlock("abort");
          this.#deleteBatch(data.modhash, response).then(async (numDeleted) => {
            await this.#log(
              "<span class='blue'>stopping</span>, total deleted: " +
                numDeleted,
              "reset cooldown to 60 seconds"
            );
            this.#setCooldown(60);
            this.#lock("abort");
          });
        }
        if (unlock) {
          this.#unlock(itemType);
        }
      });
    });
  }

  // delete all user comments
  deleteUserComments() {
    this.#deleteUserItems(this.#ItemType.COMMENT);
  }

  // delete all user posts
  deleteUserPosts() {
    this.#deleteUserItems(this.#ItemType.POST);
  }
}

let nuker = new Nuker(document);
