import Nuker from "./lib/nuker.js";

let nuker;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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
      nuker.getCooldown().then((data) => {
        sendResponse({ data: data });
      });
      return true;
    case "get-log":
      nuker.getLog().then((data) => {
        sendResponse({ data: data });
      });
      return true;
    case "get-usage":
      nuker.getUsage().then((data) => {
        sendResponse({ data: data });
      });
      return true;
  }
  sendResponse();
});
