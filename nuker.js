class Nuker {
  #username;
  #modhash;
  #paused = false;

  // enum for item types
  #ItemType = Object.freeze({
    COMMENT: "comments",
    POST: "submitted",
  });

  kill() {
    this.#paused = true;
  }

  #log(message) {
    document.getElementById("log").innerHTML += message + "\n";
  }

  async #getUserData() {
    if (
      typeof this.#username !== "undefined" &&
      typeof this.#modhash !== "undefined"
    ) {
      return true;
    }
    return chrome.tabs
      .create({ url: "https://old.reddit.com/", active: false })
      .then((tab) => this.#scrapeUserData(tab))
      .then((config) => {
        if (!config.logged) {
          this.#log("not logged in");
        }
        this.#username = config.logged;
        this.#modhash = config.modhash;
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

  // submit a POST request to Reddit API to delete an item of given ID
  #deleteById(id) {
    var request = new Request(`https://www.reddit.com/api/del?id=${id}`, {
      method: "POST",
      headers: new Headers({
        "X-Modhash": this.#modhash,
        "Content-Type": "application/json",
      }),
    });
    fetch(request)
      .then((response) => {
        if (response.status == 200) {
          this.#log("deleted comment id " + id);
        }
      })
      .catch((error) => {
        console.error(error);
      });
  }

  // delete an item of ID from a given array; sleep between each call
  #deleteBatch(array, index) {
    return new Promise((resolve) => {
      if (index < array.length && !this.#paused) {
        this.#deleteById(array[index].data.name);
        setTimeout(() => {
          resolve(this.#deleteBatch(array, index + 1));
        }, 60000 / this.#rateLimit);
      } else {
        this.#paused = true;
        resolve();
      }
    });
  }

  // submit a GET request to Reddit to retrieve comment or post history json
  #deleteUserItems(itemType) {
    // first get user data
    this.#getUserData()
      .then(() => {
        // next get user item (post/comment) history
        fetch(
          new Request(
            `https://www.reddit.com/user/${
              this.#username
            }/${itemType}.json?limit=100`,
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
            this.#log(response.headers.get("X-Ratelimit-Used"));
            this.#log(response.headers.get("X-Ratelimit-Remaining"));
            this.#log(response.headers.get("X-Ratelimit-Reset"));
            return response.json();
          })
          // batch delete from user history; recurse until none left
          .then((items) => {
            console.log(items);
            /*
          if (items.data.children.length > 0) {
            this.#deleteBatch(items.data.children, 0).then(() => {
              this.#deleteUserItems(itemType);
            });
          }*/
          });
      })
      .then(() => {});
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
