document.getElementById("nuke").addEventListener("click", () => {
  /*function process() {
    function getCommentById(id) {
      var request = new Request(
        "https://www.reddit.com/api/del?id=t1_f94sdmz",
        {
          method: "POST",
          headers: new Headers({
            "X-Modhash": "gv5dtup1vje5cbe6ac56fe2f54c1723d5aab3b6d21c33f7014",
            "Content-Type": "application/json",
          }),
        }
      );
      fetch(request)
        .then((response) => {
          console.log(response);
        })
        .catch((error) => {
          console.error(error);
        });
    }
    alert(document.body);
  }*/
  chrome.tabs
    // first, create a new tab
    .create({ url: "https://old.reddit.com/", active: false })
    // next, inject script in that tab to pull config data
    .then((tab) => {
      return (async () => {
        return await chrome.scripting
          // innject script
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
          });
      })();
    })
    // next, use config data to pull comment history
    .then((config) => {
      /*chrome.tabs.update({
        url: `https://old.reddit.com/user/${config.logged}/comments`,
      });*/
      fetch(
        new Request(
          `https://www.reddit.com/user/${config.logged}/comments.json`,
          {
            method: "GET",
            headers: new Headers({
              "Content-Type": "application/json",
            }),
          }
        )
      )
        .then((response) => response.json())
        .then((response) => {
          console.log(response);
        });
    });
});
