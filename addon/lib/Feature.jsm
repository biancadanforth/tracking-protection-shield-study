"use strict";

// modified from github.com/rhelmer/tracking-protection-study

/**  Example Feature module for a Shield Study.
  *
  *  UI:
  *  - during INSTALL only, show a notification bar with 2 buttons:
  *    - "Thanks".  Accepts the study (optional)
  *    - "I don't want this".  Uninstalls the study.
  *
  *  Firefox code:
  *  - Implements the 'introduction' to the 'button choice' study, via notification bar.
  *
  *  Demonstrates `studyUtils` API:
  *
  *  - `telemetry` to instrument "shown", "accept", and "leave-study" events.
  *  - `endStudy` to send a custom study ending.
  *
  **/

/* eslint no-unused-vars: ["error", { "varsIgnorePattern": "(EXPORTED_SYMBOLS|Feature)" }]*/

const { utils: Cu } = Components;
Cu.import("resource://gre/modules/Console.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

const EXPORTED_SYMBOLS = ["Feature"];

XPCOMUtils.defineLazyModuleGetter(this, "RecentWindow",
  "resource:///modules/RecentWindow.jsm");

/** Return most recent NON-PRIVATE browser window, so that we can
  * maniuplate chrome elements on it.
  */
function getMostRecentBrowserWindow() {
  return RecentWindow.getMostRecentBrowserWindow({
    private: false,
    allowPopups: false,
  });
}

class Feature {
  /** A Demonstration feature.
    *
    *  - variation: study info about particular client study variation
    *  - studyUtils:  the configured studyUtils singleton.
    *  - reasonName: string of bootstrap.js startup/shutdown reason
    *
    */
  constructor({variation, studyUtils, config, reasonName}) {
    // unused.  Some other UI might use the specific variation info for things.
    this.variation = variation;
    this.studyUtils = studyUtils;
    this.config = config;

    this.timeSaved = 0;
    this.blockedRequests = 0;
    this.blockedSites = 0;
    this.blockedEntities = 0;

    // only during INSTALL
    if (reasonName === "ADDON_INSTALL") {
      // add any features here you only want to show on install
    }
  }

  onOpenWindow(xulWindow) {
    let win = xulWindow.QueryInterface(Components.interfaces.nsIInterfaceRequestor)
                       .getInterface(Components.interfaces.nsIDOMWindow);
    win.addEventListener("DOMContentLoaded", this.onPageLoad.bind(this));
  }

  onPageLoad(evt) {
    let doc = evt.originalTarget;
    if (doc.location.href == "about:newtab") {
      let minutes = this.timeSaved / 1000 / 60;

      // if (minutes >= 1 && this.blockedRequests) {
      if (minutes && this.blockedRequests) {
        let message = this.newtab_message;
        message = message.replace("${blockedRequests}", this.blockedRequests);
        message = message.replace("${blockedEntities}", this.blockedEntities);
        message = message.replace("${blockedSites}", this.blockedSites);
        message = message.replace("${minutes}", minutes.toPrecision(3));

        let container = doc.getElementById("newtab-margin-top");
        let logo = doc.createElement("img");
        logo.src = "resource://tracking-protection-study/webextension/img/blok-48.png";
        logo.style.height = 48;
        logo.style.width = 48;
        logo.style.float = "left";
        logo.style.padding = "5px";

        let span = doc.createElement("span");
        span.style.fontSize = "24px";
        span.style.fontWeight = "lighter";
        span.style.float = "right";
        span.style.padding = "5px";
        span.innerHTML = message;

        let newContainer = doc.createElement("div");
        newContainer.style.padding = "24px";
        newContainer.append(logo);
        newContainer.append(span);
        container.append(newContainer);
      }
    }
  }

  /**
   * Open URL in new tab on desired chrome window.
   *
   * @param {ChromeWindow} win
   * @param {String} message
   * @param {String} url
   * @param {bool} foreground - true if this tab should open in the foreground.
   */
  openURL(win, message, url, foreground = true) {
    const tab = win.gBrowser.addTab(url);
    if (foreground) {
      win.gBrowser.selectedTab = tab;
    }
  }

  async init(api) {
    this.api = api;
    const {browser} = api;

    browser.runtime.onMessage.addListener((message, sender, sendReply) => {
      let win = Services.wm.getMostRecentWindow("navigator:browser");
      if (message == "open-prefs") {
        let url = "about:preferences#privacy";
        // FIXME this needs to first find any already-open about:preferences tab
        // there is probably already a function to do this somewhere in the tree...
        const tab = win.gBrowser.addTab(url);
        win.gBrowser.selectedTab = tab;
      } else if (message.timeSaved) {
        this.timeSaved = message.timeSaved;
        this.blockedRequests = message.blockedRequests;
        this.blockedSites = message.blockedSites;
        this.blockedEntities = message.blockedEntities;
      } else {
        console.log(`Unknown message: ${message}`);
      }
    })

    // define treatments as STRING: fn(browserWindow, url)
    this.TREATMENTS = {
      doorhanger: this.openDoorhanger,
      opentab: this.openURL,
    }

    this.treatment = this.studyUtils.getVariation().name;
    this.campaign_id = await this.config.study.getCampaignId();

    let campaigns = this.config.study.campaigns;

    if (this.treatment in campaigns) {
      let campaign = campaigns[this.treatment];
      for (let i = 0; i < campaign.campaign_ids.length; i++) {
        if (this.campaign_id === campaign.campaign_ids[i]) {
          this.message = campaign.messages[i];
          this.newtab_message = campaign.newtab_messages[i];
          this.url = campaign.urls[i];
        }
      }
    }

    if (this.treatment !== "control" && !this.message && !this.url) {
      await this.studyUtils.endStudy({ reason: "invalid config" });
      throw `No config found for campaign ID: ${this.campaign_id} for ${this.treatment}`;
    }

    // run once now on the most recent window.
    let win = Services.wm.getMostRecentWindow("navigator:browser");

    if (this.treatment === "ALL") {
      Object.keys(this.TREATMENTS).forEach((key, index) => {
        if (Object.prototype.hasOwnProperty.call(this.TREATMENTS, key)) {
          this.TREATMENTS[key](win, this.message, this.url);
        }
      });
    } else if (this.treatment in this.TREATMENTS) {
      this.TREATMENTS[this.treatment](win, this.message, this.url);
    }

    // Add listeners to all open windows.
    let enumerator = Services.wm.getEnumerator("navigator:browser");
    while (enumerator.hasMoreElements()) {
      let win = enumerator.getNext();
      if (win === Services.appShell.hiddenDOMWindow) {
        continue;
      }
      win.gBrowser.addEventListener("DOMContentLoaded", this.onPageLoad.bind(this));
    }

    // Add listeners to any future windows.
    Services.wm.addListener(this);
  }

  uninit() {
    // Remove listeners from all open windows.
    let enumerator = Services.wm.getEnumerator("navigator:browser");
    while (enumerator.hasMoreElements()) {
      let win = enumerator.getNext();
      if (win === Services.appShell.hiddenDOMWindow) {
        continue;
      }
      win.gBrowser.removeEventListener("DOMContentLoaded", this.onPageLoad);
      Services.wm.removeListener(this);
    }
  }

  /* good practice to have the literal 'sending' be wrapped up */
  telemetry(stringStringMap) {
    this.studyUtils.telemetry(stringStringMap);
  }
}



// webpack:`libraryTarget: 'this'`
this.EXPORTED_SYMBOLS = EXPORTED_SYMBOLS;
this.Feature = Feature;
