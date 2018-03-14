// Modified from https://github.com/rhelmer/tracking-protection-study/

/* global addMessageListener sendAsyncMessage removeMessageListener */

"use strict";

const { utils: Cu } = Components;

const ABOUT_HOME_URL = "about:home";
const ABOUT_NEWTAB_URL = "about:newtab";
const NEW_TAB_CONTAINER_DIV_ID = "tracking-protection-messaging-study-container";
const NEW_TAB_MESSAGE_DIV_ID = "tracking-protection-messaging-study-message";
const SVG_ID = "tracking-protection-messaging-study-svg";

class TrackingProtectionStudy {
  constructor(contentWindow) {
    this.contentWindow = contentWindow;
    this.newTabMessage = "";
    this.sendOpenTimeRef = this.sendOpenTime.bind(this);
    this.RADIX = 10; // numerical base for parseInt
    this.shouldAddNewTabContent = true;
    this.init();
  }

  async init() {
    addMessageListener("TrackingStudy:InitialContent", this);
    addMessageListener("TrackingStudy:UpdateContent", this);
    addMessageListener("TrackingStudy:ShuttingDown", this);
    addMessageListener("TrackingStudy:Uninstalling", this);
    addMessageListener("TrackingStudy:OnLocationChange", this);

    this.initTimer();
  }

  sendOpenTime() {
    sendAsyncMessage("TrackingStudy:NewTabOpenTime",
      Math.round(Date.now() / 1000) - this.openingTime);
  }

  initTimer() {
    this.openingTime = Math.floor(Date.now() / 1000);
    this.contentWindow.addEventListener(
      "beforeunload",
      this.sendOpenTimeRef,
      { once: true }
    );
  }

  receiveMessage(msg) {
    const doc = this.contentWindow.document;
    this.addContentToNewTabRef = () => this.addContentToNewTab(msg.data, doc);
    switch (msg.name) {
      case "TrackingStudy:OnLocationChange":
        if (msg.data.location !== this.ABOUT_HOME_URL || msg.data.location !== this.ABOUT_NEWTAB_URL) {
          this.shouldAddNewTabContent = false;
          return;
        }
        this.shouldAddNewTabContent = true;
        break;
      case "TrackingStudy:ShuttingDown":
        this.onShutdown();
        break;
      case "TrackingStudy:Uninstalling":
        this.onUninstall();
        break;
      case "TrackingStudy:InitialContent":
        // check if document has already loaded
        if (doc.readyState === "complete") {
          this.addContentToNewTab(msg.data, doc);
        } else {
          doc.addEventListener("DOMContentLoaded", this.addContentToNewTabRef);
        }
        break;
      case "TrackingStudy:UpdateContent":
        this.addContentToNewTab(msg.data, doc);
        break;
      default:
        throw new Error(`Message name not recognized: ${msg.name}`);
    }
  }

  addContentToNewTab(state, doc) {
    if (!this.shouldAddNewTabContent) {
      return;
    }

    // if we haven't blocked anything yet, don't modify the page
    if (state.blockedResources) {
      this.newTabMessage = state.newTabMessage;
      // Make a copy of message so we don't mutate the original string, which
      // we need to preserve for updateMessage.
      const message = this.updateMessage(state);

      // Check if the study UI has already been added to this page
      const tpContent = doc.getElementById(`${NEW_TAB_CONTAINER_DIV_ID}`);
      if (tpContent) {
        // if already on the page, just update the message
        const tpContentChildEle = doc.getElementById(`${NEW_TAB_MESSAGE_DIV_ID}`);
        // eslint-disable-next-line no-unsanitized/property
        tpContentChildEle.innerHTML = message;
        return;
      }

      const div = doc.createElement("div");
      div.id = `${NEW_TAB_MESSAGE_DIV_ID}`;
      // eslint-disable-next-line no-unsanitized/property
      div.innerHTML = message;

      const svg = `<svg id=${SVG_ID} viewBox="0 0 26 30" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
        <title>Icon - Tracking Protection</title>
        <defs></defs>
        <g id="Page-1" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">
          <path d="M25.8017891,12.976 C25.2558014,18.757 24.1369008,21.621 21.6074075,24.935 C18.1709265,29.437 13.0002493,29.9985 13.0002493,29.9985 C13.0002493,29.9985 7.82907346,29.437 4.39259251,24.935 C1.86309921,21.621 0.744198561,18.757 0.198210947,12.976 C0.0107302681,10.99 -0.00572415315,6.4745 0.00125651042,3.9455 C0.00424822338,2.9 0.768630884,2.018 1.81024561,1.846 L13.0002493,0 L24.1897544,1.846 C25.2313691,2.018 25.9957518,2.9 25.9987435,3.9455 C26.0057242,6.4745 25.9892697,10.99 25.8017891,12.976 L25.8017891,12.976 Z M23.9928,3.928 C23.9928,3.8635 23.9374533,3.8095 23.8591701,3.796 L13.0002493,2.0005 L2.14132851,3.796 C2.06304536,3.809 2.00769867,3.8635 2.00769867,3.928 C1.99573182,8.1615 2.06404259,11.3885 2.19567796,12.781 C2.7421642,18.58 3.85358556,20.9335 5.9866769,23.735 C8.45733318,26.979 12.0708238,27.826 13.0017452,27.9955 C13.9187052,27.829 17.5391765,26.984 20.0138217,23.735 C22.1469131,20.9335 23.2583344,18.58 23.8053193,12.781 C23.936456,11.386 24.0047668,8.159 23.9928,3.928 L23.9928,3.928 Z M7.34990077,21.9175 C5.29110364,19.2125 4.55264916,17.599 4.02560906,12.001 C3.9049433,10.718 4.02311596,9.344 4.02560906,5.501 L13.0007479,4.001 L13.0007479,26.001 C11.88085,25.7695 9.45506946,24.684 7.34990077,21.9175 L7.34990077,21.9175 Z" id="Icon---Tracking-Protection" fill="#737373"></path>
        </g>
      </svg>`;

      const newContainer = doc.createElement("div");
      newContainer.id = `${NEW_TAB_CONTAINER_DIV_ID}`;
      if (state.OS === "Windows" || state.OS === "Linux") {
        newContainer.classList.add("windows-or-linux-os");
      }
      const span = doc.createElement("span");
      span.innerHTML = svg;
      newContainer.append(span);
      newContainer.append(div);

      // There's only one <main> element on the new tab page
      const mainEle = doc.getElementsByTagName("main")[0];
      // It may be possible that <main> isn't available yet if the user
      // reloads `about:newtab` in the same tab it was originally loaded into,
      // since frame scripts are only loaded once per tab.
      if (!mainEle) {
        return;
      }
      const searchDiv = mainEle.children[0];
      const parentNode = searchDiv.parentElement;
      parentNode.insertBefore(newContainer, searchDiv.nextSibling);
    }
  }

  // timeSaved comes in as s
  getHumanReadableTimeVals(timeSaved) {
    let timeStr = "";
    let timeSeconds,
      timeMinutes,
      timeHours;
    timeSeconds = timeSaved;
    if (timeSeconds >= 60) {
      timeMinutes = timeSeconds / 60;
      timeSeconds = (timeMinutes % 1) * 60;
      timeMinutes = Math.floor(timeMinutes);
      if (timeMinutes >= 60) {
        timeHours = timeMinutes / 60;
        timeMinutes = (timeHours % 1) * 60;
        timeHours = Math.floor(timeHours);
      }
    }
    if (timeHours > 0) {
      timeStr += `<span class='tracking-protection-messaging-study-message-quantity'>${ Math.round(timeHours) }</span> hour`;
      if (Math.round(timeHours) > 1) {
        timeStr += "s";
      }
    }
    if (timeMinutes > 0) {
      // eslint-disable-next-line no-nested-ternary
      timeStr += `${timeHours > 0 ? (timeSeconds > 0 ? "," : " and") : ""} <span class='tracking-protection-messaging-study-message-quantity'>${ Math.round(timeMinutes) }</span> minute`;
      if (Math.round(timeMinutes) > 1) {
        timeStr += "s";
      }
    }
    if (timeSeconds > 0) {
      timeStr += `${timeMinutes > 0 ? " and" : ""} <span class='tracking-protection-messaging-study-message-quantity'>${ Math.round(timeSeconds) }</span> second`;
      if (Math.round(timeSeconds) > 1) {
        timeStr += "s";
      }
    }
    return timeStr;
  }

  updateMessage(state) {
    let message = this.newTabMessage;

    // Update first quantity: blocked resources/trackers
    const blockedResources = parseInt(state.blockedResources, this.RADIX);
    // toLocaleString adds ',' for large number values; ex: 1000 will become 1,000.
    message = message.replace(
      "${blockedRequests}",
      blockedResources.toLocaleString()
    );
    const trackerUnit = blockedResources === 1 ? "tracker" : "trackers";
    message = message.replace(
      "${trackerUnit}",
      trackerUnit,
    );

    // Update second quantity: blocked ads or time saved
    const blockedAds = parseInt(state.blockedAds, this.RADIX);
    message = message.replace(
      "${blockedAds}",
      blockedAds.toLocaleString()
    );
    const adUnit = blockedAds === 1 ? "advertisement" : "advertisements";
    message = message.replace(
      "${adUnit}",
      adUnit
    );
    const parsedTime = this.getHumanReadableTimeVals(
      parseInt(state.timeSaved, this.RADIX)
    );
    message = message.replace("${time}", parsedTime);
    return message;
  }

  onShutdown() {
    const doc = this.contentWindow.document;
    this.contentWindow.removeEventListener("beforeunload", this.sendOpenTimeRef);
    removeMessageListener("TrackingStudy:InitialContent", this);
    removeMessageListener("TrackingStudy:UpdateContent", this);
    removeMessageListener("TrackingStudy:ShuttingDown", this);
    removeMessageListener("TrackingStudy:Uninstalling", this);
    removeEventListener("load", handleLoad, true);
    doc.removeEventListener("DOMContentLoaded", this.addContentToNewTabRef);
  }

  onUninstall() {
    const doc = this.contentWindow.document;
    const tpContent = doc.getElementById(`${NEW_TAB_CONTAINER_DIV_ID}`);
    if (tpContent) {
      tpContent.remove();
    }
  }
}

addEventListener("load", handleLoad, true);

function handleLoad(evt) {
  const win = evt.target.defaultView;
  const location = win.location.href;
  if (location === ABOUT_NEWTAB_URL || location === ABOUT_HOME_URL) {
    Cu.import("resource://gre/modules/PrivateBrowsingUtils.jsm");
    // Don't show new tab page variation in a Private Browsing window
    if (PrivateBrowsingUtils.isContentWindowPrivate(win)) {
      return;
    }

    // queues a function to be called during a browser's idle periods
    win.requestIdleCallback(() => {
      new TrackingProtectionStudy(win);
      sendAsyncMessage("TrackingStudy:InitialContent");
    });
  }
}
