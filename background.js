import Nuker from "./lib/nuker.js";

let nuker;

chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
  if (typeof nuker === "undefined") {
    nuker = new Nuker();
  }
  switch (request.message) {
    case "delete-comments":
      nuker.deleteUserComments();
      break;
    case "delete-posts":
      nuker.deleteUserPosts();
      break;
    case "abort":
      nuker.abort();
      break;
    case "get-cooldown":
      const cooldown = await nuker.getCooldown();
      sendResponse({ data: cooldown });
      return true;
    case "get-log":
      const log = await nuker.getLog();
      sendResponse({ data: log });
      return true;
    case "get-usage":
      const usage = await nuker.getUsage();
      sendResponse({ data: usage });
      return true;
  }
  sendResponse();
});
