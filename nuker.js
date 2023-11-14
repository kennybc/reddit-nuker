class Nuker {
  static getProfileURL(username) {
    return "";
  }
  static getNewestComment(profile) {
    return "";
  }
}

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
  var config;
  chrome.tabs.create(
    { url: "https://old.reddit.com/", active: false },
    (tab) => {
      chrome.scripting
        .executeScript({
          target: { tabId: tab.id },
          func: () => {
            return JSON.parse(
              document.getElementById("config").innerText.slice(8, -1)
            );
          },
        })
        .then((result) => {
          config = result[0].result;
          alert(config.logged);
        });
    }
  );
});
