/**
 * Namespace wrapping client-side functions to
 * update UI/process UI interactions
 */
var funcs = {
  addClickEvent: (elementId, message, callback = () => {}) => {
    if (!window.navigator.onLine) {
      return chrome.runtime.sendMessage(
        {
          message: "log",
          what: "<span class='red'>error</span>, no internet connection",
        },
        (response) => {
          funcs.print(response);
        }
      );
    }
    let element = document.getElementById(elementId);
    callback = callback.bind(this);
    element.addEventListener("click", () => {
      if (element.classList.contains("active")) {
        chrome.runtime.sendMessage(message, callback);
      }
    });
  },

  lock: (elementId) => {
    if (elementId == "all") {
      document.getElementById("comments").classList.remove("active");
      document.getElementById("submitted").classList.remove("active");
    } else {
      document.getElementById(elementId).classList.remove("active");
    }
  },

  unlock: (elementId) => {
    if (elementId == "all") {
      document.getElementById("comments").classList.add("active");
      document.getElementById("submitted").classList.add("active");
    } else {
      document.getElementById(elementId).classList.add("active");
    }
  },

  print: (stamped) => {
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
  },

  displayUsage: async (usage = false) => {
    document.getElementById("version").innerHTML =
      chrome.runtime.getManifest().version;

    if (!usage) {
      response = await chrome.runtime.sendMessage({ message: "get-usage" });
    }
    const data = response.data;
    document.getElementById("times-used").innerHTML = data.uses;
    document.getElementById("total-deleted").innerHTML = data.deleted;
  },

  calcCooldown: (expiry) => {
    return Math.max(Math.round((expiry - Date.now()) / 1000), 0);
  },
  displayCooldown: async (cooldown = false, useLocks = true) => {
    if (!cooldown) {
      cooldown = (await chrome.runtime.sendMessage({ message: "get-cooldown" }))
        .data;
    }

    const data = cooldown;
    if (data && Date.now() < data.expiry) {
      // lock actions and display cooldown panel
      if (useLocks) {
        funcs.lock("comments");
        funcs.lock("submitted");
      }
      funcs.unlock("cooldown");
      const cooldown = funcs.calcCooldown(data.expiry);

      // every second, recalculate the remaining cooldown and update UI
      let tick = window.setInterval(() => {
        document.getElementById("timer").innerHTML = funcs.calcCooldown(
          data.expiry
        );
      }, 1000);
      document.getElementById("timer").innerHTML = cooldown;

      // set animation of cooldown clock
      let clockLeft = document.getElementById("clock-left");
      let clockRight = document.getElementById("clock-right");
      const skip = data.duration - cooldown;
      clockLeft.style.animation = "none";
      clockRight.style.animation = "none";
      clockLeft.offsetHeight;
      clockRight.offsetHeight;
      clockLeft.style.animation =
        "mask " + data.duration + "s -" + skip + "s steps(1, end) forwards";
      clockRight.style.animation =
        "tick " + data.duration + "s -" + skip + "s linear forwards";

      // after cooldown expires, unlock actions and hide cooldown panel
      window.setTimeout(() => {
        if (useLocks) {
          funcs.unlock("comments");
          funcs.unlock("submitted");
        }
        funcs.lock("cooldown");
        document.getElementById("timer").innerHTML = "";
        window.clearInterval(tick);
      }, data.expiry - Date.now());
    }
  },

  displayLog: () => {
    chrome.runtime.sendMessage({ message: "get-log" }, (response) => {
      const data = response.data;
      if (data) {
        data.forEach((stamped) => {
          funcs.print(stamped);
        });
      }
    });
  },
};

/**
 * Setup UI/bind functions to elements
 */
funcs.displayLog();
funcs.displayUsage();
funcs.displayCooldown();

funcs.addClickEvent("comments", { message: "delete-comments" });
funcs.addClickEvent("submitted", { message: "delete-posts" });
funcs.addClickEvent("abort", { message: "abort" });

/**
 * Listen for messages from background script
 * requesting UI updates
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.message) {
    case "display-usage":
      funcs.displayUsage();
      break;
    case "display-cooldown":
      funcs.displayCooldown(request.what.cooldown, request.what.useLocks);
      break;
    case "print":
      funcs.print(request.what);
      break;
    case "lock":
      funcs.lock(request.what);
      break;
    case "unlock":
      funcs.unlock(request.what);
      break;
  }
  sendResponse();
});
