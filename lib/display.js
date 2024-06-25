class Display {
  // sends a message to the popup interface to update the UI in some way
  async message(message) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["POPUP"],
    });
    if (contexts.length > 0) {
      chrome.runtime.sendMessage(message);
    }
  }

  // "lock" an element (button); grays it out and disables functionality
  lock(elementId = "all") {
    this.message({ message: "lock", what: elementId });
  }

  // "unlocks" and element (button); restores appearance and functionality
  unlock(elementId = "all") {
    this.message({ message: "unlock", what: elementId });
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
    const data = await chrome.storage.local.get("log");
    if (data.log) {
      data.log.push(stamped);
    } else {
      data.log = [stamped];
    }
    await chrome.storage.local.set({
      log: data.log,
    });

    this.print(stamped);
  }

  async error(...message) {
    const errors = message.map((msg) => {
      return "<span class='red'>error</span>, " + msg;
    });
    await this.log(errors);
  }

  // prints a stamped message to the UI
  print(stamped) {
    this.message({ message: "print", what: stamped });
  }

  // fetch and display extension/usage info
  async displayUsage(usage) {
    this.message({ message: "display-usage", what: usage });
  }

  // if a cooldown exists, display it in the UI
  async displayCooldown(cooldown, useLocks = true) {
    this.message({
      message: "display-cooldown",
      what: {
        cooldown,
        useLocks,
      },
    });
  }

  // sets the cooldown to a given number of seconds
  async setCooldown(seconds, useLocks = true) {
    let cooldown = {
      expiry: Date.now() + seconds * 1000,
      duration: seconds,
    };
    await chrome.storage.local.set({
      cooldown: cooldown,
    });
    this.displayCooldown(cooldown, useLocks);
  }

  // gets the cooldown
  async getCooldown() {
    const data = await chrome.storage.local.get("cooldown");
    // if user data already saved to storage, retrieve it
    if (data.cooldown) {
      return data.cooldown;
    }
    return false;
  }

  // gets the log
  async getLog() {
    const data = await chrome.storage.local.get("log");
    if (data.log) {
      return data.log;
    }
    return [];
  }

  // gets the usage info
  async getUsage() {
    const data = await chrome.storage.local.get("usage");
    if (data.usage) {
      return data.usage;
    }
    return {
      uses: 0,
      deleted: 0,
    };
  }

  // gets the difference between current time and cooldown expiry time
  calcCooldown(expiry) {
    return Math.max(Math.round((expiry - Date.now()) / 1000), 0);
  }
}

export default Display;
