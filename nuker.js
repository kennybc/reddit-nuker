class Nuker {
    #rateLimit = 60; // 60 requests/min
    #username;
    #modhash;

    // enum for item types
    #ItemType = Object.freeze({
        COMMENT: "comments",
        POST: "submitted",
    });

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
                            document
                                .getElementById("config")
                                .innerText.slice(8, -1)
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
                    alert("deleted comment id " + id);
                }
            })
            .catch((error) => {
                console.error(error);
            });
    }

    // delete an item of ID from a given array; sleep between each call
    #deleteBatch(array, index) {
        return new Promise((resolve) => {
            if (index < array.length) {
                this.#deleteById(array[index].data.name);
                setTimeout(() => {
                    resolve(this.#deleteBatch(array, index + 1));
                }, 1000);
            } else {
                resolve();
            }
        });
    }

    // submit a GET request to Reddit to retrieve comment or post history json
    #getUserItems(itemType) {
        return fetch(
            new Request(
                `https://www.reddit.com/user/${
                    this.#username
                }/${itemType}.json`,
                {
                    method: "GET",
                    headers: new Headers({
                        "Content-Type": "application/json",
                    }),
                }
            )
        ).then((response) => response.json());
    }

    // delete all user comments
    deleteUserComments() {
        this.#getUserData().then(() => {
            this.#getUserItems(this.#ItemType.COMMENT).then((comments) => {
                if (comments.data.children.length > 0) {
                    this.#deleteBatch(comments.data.children, 0).then(() => {
                        this.deleteUserComments();
                    });
                }
            });
        });
    }
    deleteUserPosts() {
        this.#getUserItems(this.#ItemType.POST).then((posts) => {});
    }
}

document.getElementById("nuke").addEventListener("click", () => {
    let nuker = new Nuker();
    nuker.deleteUserComments();
});
