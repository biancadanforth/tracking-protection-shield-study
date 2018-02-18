/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* global blocklists CleanupManager WindowWatcher */
/* eslint no-unused-vars: ["error", { "varsIgnorePattern": "(EXPORTED_SYMBOLS|Feature)" }]*/

/**  What this Feature does: TODO bdanforth: complete
  *
  *  UI:
  *  - during INSTALL only, show an introductory panel with X options
  *    - ((add options))
  *  - ((add other UI features))
  *
  *  This module:
  *  - Implements the 'introduction' to the 'tracking protection messaging' study, via panel.
  *  - ((add other functionality))
  *
  *  Uses `studyUtils` API for:
  *  - `telemetry` to instrument "shown", "accept", and "leave-study" events.
  *  - `endStudy` to send a custom study ending.
  *  - ((add other uses))
  *  - ((get study ending URL(s) from rrayborn))
  **/

// Import Firefox modules
const { interfaces: Ci, utils: Cu } = Components;
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "Services",
  "resource://gre/modules/Services.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "WebRequest",
  "resource://gre/modules/WebRequest.jsm");
XPCOMUtils.defineLazyServiceGetter(this, "styleSheetService",
  "@mozilla.org/content/style-sheet-service;1", "nsIStyleSheetService");
// Import URL Web API into module
Cu.importGlobalProperties(["URL"]);
// Import addon-specific modules
const STUDY = "tracking-protection-messaging-study";
XPCOMUtils.defineLazyModuleGetter(this, "canonicalizeHost",
  `resource://${STUDY}/lib/Canonicalize.jsm`);
XPCOMUtils.defineLazyModuleGetter(this, "blocklists",
  `resource://${STUDY}/lib/BlockLists.jsm`);
XPCOMUtils.defineLazyModuleGetter(this, "CleanupManager",
  `resource://${STUDY}/lib/CleanupManager.jsm`);
XPCOMUtils.defineLazyModuleGetter(this, "WindowWatcher",
  `resource://${STUDY}/lib/WindowWatcher.jsm`);

const EXPORTED_SYMBOLS = ["Feature"];

class Feature {
  /** The study feature.
    *  - variation: study info about particular client study variation
    *  - studyUtils:  the configured studyUtils singleton.
    *  - reasonName: string of bootstrap.js startup/shutdown reason
    *  - logLevel: the log level from Config.jsm ( uses same level as bootstrap.js)
    */
  constructor({variation, studyUtils, reasonName, logLevel}) {
    this.treatment = variation.name;
    this.studyUtils = studyUtils;
    this.reasonName = reasonName;
    this.IsStudyEnding = false;
    // Randomize frame script URL due to bug 1051238.
    this.FRAME_SCRIPT_URL =
    `resource://${STUDY}/content/new-tab-variation.js?${Math.random()}`,
    this.XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
    this.DOORHANGER_ID = "onboarding-trackingprotection-notification";
    this.DOORHANGER_ICON = "chrome://browser/skin/tracking-protection-16.svg#enabled";
    this.STYLESHEET_URL = `resource://${STUDY}/skin/tracking-protection-study.css`;
    this.TP_ENABLED_GLOBALLY = (this.treatment === "pseudo-control");
    this.TP_ENABLED_IN_PRIVATE_WINDOWS = (this.treatment === "control");
    this.PREF_TP_ENABLED_GLOBALLY = "privacy.trackingprotection.enabled";
    this.PREF_TP_ENABLED_IN_PRIVATE_WINDOWS = "privacy.trackingprotection.pbmode.enabled";
    this.PAGE_ACTION_BUTTON_ID = "tracking-protection-study-button";
    this.PANEL_ID = "tracking-protection-study-intro-panel";
    // Estimating # blocked ads as a percentage of # blocked resources
    this.AD_FRACTION = 0.1;
    // Time saved per page will never exceed this fraction of # blocked resources
    this.MAX_TIME_SAVED_FRACTION = 0.075;

    this.onTabChangeRef = this.onTabChange.bind(this);
    this.handlePageActionButtonCommandRef = this.handlePageActionButtonCommand.bind(this);
    this.handleWindowClosingRef = this.handleWindowClosing.bind(this);
    this.handleEmbeddedBrowserLoadRef = this.handleEmbeddedBrowserLoad.bind(this);
    this.handlePopupShownRef = this.handlePopupShown.bind(this);
    this.handlePopupHiddenRef = this.handlePopupHidden.bind(this);
    this.onBeforeRequestRef = this.onBeforeRequest.bind(this);
    this.handleChromeWindowClickRef = this.handleChromeWindowClick.bind(this);

    this.init(logLevel);
  }

  async init(logLevel) {

    this.initLog(logLevel);

    this.addContentMessageListeners();

    // define treatments as STRING: fn(browserWindow, url)
    this.TREATMENTS = {
      "control": this.applyControlTreatment.bind(this),
      "pseudo-control": this.applyPseudoControlTreatment.bind(this),
      // "fast" and "private" treatments are exactly the same except for copy
      "fast": this.applyExperimentalTreatment.bind(this),
      "private": this.applyExperimentalTreatment.bind(this),
    };

    this.newTabMessages = {
      fast: "Firefox blocked <span class='tracking-protection-messaging-study-message-quantity'>${blockedRequests}</span> trackers and saved you ${time}",
      private: "Firefox blocked <span class='tracking-protection-messaging-study-message-quantity'>${blockedRequests}</span> trackers and <span class='tracking-protection-messaging-study-message-quantity'>${blockedAds}</span> advertisements",
    };

    this.introPanelHeaders = {
      fast: "Freedom to browse faster with Tracking Protection",
      private: "Freedom from Ads and Trackers with Tracking Protection",
    };

    this.introPanelMessages = {
      fast: "Firefox is the only major browser with Tracking Protection to speed up page loads by automatically shutting trackers down.",
      private: "Only Firefox's built-in Tracking Protection blocks ads and trackers that can get in the way of your browsing, leaving you free to browse without interruption and without being watched.",
    };

    this.pageActionPanelQuantities = {
      // both branches show one quantity as # blocked resources in addition to one variable quantity
      fast: '<span id="tracking-protection-study-page-action-num-other-quantity" class="tracking-protection-study-page-action-quantity">${timeSaved}</span><span class="tracking-protection-study-page-action-copy">${timeUnit}<br />saved</span>',
      private: '<span id="tracking-protection-study-page-action-num-other-quantity" class="tracking-protection-study-page-action-quantity">${blockedAds}</span><span class="tracking-protection-study-page-action-copy">ads<br />blocked</span>',
    };

    this.pageActionPanelMessages = {
      fast: "Tracking Protection speeds up page loads by automatically shutting down trackers.",
      private: "Tracking Protection blocks trackers automatically, so that you can browse without annoying and invasive ads.",
    };

    // run once now on the most recent window.
    const win = Services.wm.getMostRecentWindow("navigator:browser");

    this.state = {
      totalTimeSaved: 0,
      // a <browser>:counter map for the number of milliseconds saved for a particular browser
      timeSaved: new WeakMap(),
      // a <browser>:counter map for the number of blocked resources for a particular browser
      // Why is this mapped with <browser>?
      // You may have the same site in multiple tabs; should you use the same counter for both?
      // the <browser> element is per tab. Fox News in two different tabs wouldn't share the same counter.
      // if didn't do this, you might get two tabs loading the same page trying to update the same counter.
      blockedResources: new WeakMap(),
      totalBlockedResources: 0,
      blockedAds: new WeakMap(),
      totalBlockedAds: 0,
      // Checked by the pageAction panel's "command" event listener to make sure
      // the pageAction panel never opens when the intro panel is currently open among other times
      introPanelIsShowing: false,
      // Only update the values in the pageAction panel if it's showing
      pageActionPanelIsShowing: false,
    };

    if (this.treatment in this.TREATMENTS) {
      await this.TREATMENTS[this.treatment](win);
    }

    // if user toggles built-in TP on/off, end the study
    // Note: This listener can't be added until after the treatment has been applied,
    // since we are initializing built-in TP based on the treatment.
    this.addBuiltInTrackingProtectionListeners();
  }

  addContentMessageListeners() {
    // content listener
    Services.mm.addMessageListener("TrackingStudy:InitialContent", this);
    CleanupManager.addCleanupHandler(() => Services.mm.removeMessageListener("TrackingStudy:InitialContent", this));
  }

  receiveMessage(msg) {
    switch (msg.name) {
      case "TrackingStudy:InitialContent":
        // msg.target is the <browser> element
        msg.target.messageManager.sendAsyncMessage("TrackingStudy:InitialContent", {
          blockedResources: this.state.totalBlockedResources,
          timeSaved: this.state.totalTimeSaved,
          blockedAds: this.state.totalBlockedAds,
          newTabMessage: this.newTabMessages[this.treatment],
        });
        break;
      default:
        throw new Error(`Message type not recognized, ${ msg.name }`);
    }
  }

  /*
  * Create a new instance of the ConsoleAPI, so we can control
  * the maxLogLevel with Config.jsm.
  */
  initLog(logLevel) {
    XPCOMUtils.defineLazyGetter(this, "log", () => {
      const ConsoleAPI =
        Cu.import("resource://gre/modules/Console.jsm", {}).ConsoleAPI;
      const consoleOptions = {
        maxLogLevel: logLevel,
        prefix: "TPStudy",
      };
      return new ConsoleAPI(consoleOptions);
    });
  }

  addBuiltInTrackingProtectionListeners() {
    Services.prefs.addObserver(this.PREF_TP_ENABLED_GLOBALLY, this);
    CleanupManager.addCleanupHandler(() => Services.prefs.removeObserver(this.PREF_TP_ENABLED_GLOBALLY, this));
    Services.prefs.addObserver(this.PREF_TP_ENABLED_IN_PRIVATE_WINDOWS, this);
    CleanupManager.addCleanupHandler(() => Services.prefs.removeObserver(this.PREF_TP_ENABLED_IN_PRIVATE_WINDOWS, this));
  }

  async observe(subject, topic, data) {
    let reason;
    switch (topic) {
      case "nsPref:changed":
        if (this.isStudyEnding) {
          break;
        }
        if (data === this.PREF_TP_ENABLED_GLOBALLY
          || this.PREF_TP_ENABLED_IN_PRIVATE_WINDOWS) {
          const prevState = this.getPreviousTrackingProtectionState();
          const nextState = this.getNextTrackingProtectionState();
          // Rankings -
          // TP ON globally: 3, TP ON private windows only: 2, TP OFF globally: 1
          reason = (nextState > prevState) ? "user-enabled-builtin-tracking-protection"
            : "user-disabled-builtin-tracking-protection";
          this.log.debug("User modified built-in tracking protection settings. Ending study.");
          this.telemetry({ event: reason });
          await this.endStudy(reason, false);
        }
        break;
    }
  }

  getPreviousTrackingProtectionState() {
    // Built-in TP has three possible states:
    //   1) OFF globally, 2) ON for private windows only, 3) ON globally
    let prevState;
    if (this.TP_ENABLED_GLOBALLY) {
      prevState = 3;
    } else if (this.TP_ENABLED_IN_PRIVATE_WINDOWS) {
      prevState = 2;
    } else {
      prevState = 1;
    }
    return prevState;
  }

  getNextTrackingProtectionState() {
    // Built-in TP has three possible states:
    //   1) OFF globally, 2) ON for private windows only, 3) ON globally
    let nextState;
    const enabledGlobally = Services.prefs.getBoolPref(
      this.PREF_TP_ENABLED_GLOBALLY
    );
    const enabledInPrivateWindows = Services.prefs.getBoolPref(
      this.PREF_TP_ENABLED_IN_PRIVATE_WINDOWS
    );
    if (enabledGlobally) {
      nextState = 3;
    } else if (enabledInPrivateWindows) {
      nextState = 2;
    } else {
      nextState = 1;
    }
    return nextState;
  }

  applyControlTreatment() {
    // 1. Initialize built-in Tracking Protection, ON in private windows only
    //    - "control" does not change the default setting
  }

  applyPseudoControlTreatment() {
    // 1. Initialize built-in Tracking Protection, ON globally
    Services.prefs.setBoolPref(this.PREF_TP_ENABLED_GLOBALLY, true);
  }

  // "fast" and "private" treatments differ only in copy
  async applyExperimentalTreatment(win) {
    // 1. Initialize built-in Tracking Protection, OFF globally
    Services.prefs.setBoolPref(this.PREF_TP_ENABLED_IN_PRIVATE_WINDOWS, false);

    // 2. Show intro panel if addon was just installed
    // Note: When testing with `npm run firefox`, ADDON_INSTALL
    // is always the reason code when Firefox starts up.
    // Conversely, when testing with `./mach build` and 
    // `./mach run` in the tree, ADDON_STARTUP is always the
    // reason code when Firefox starts up.
    if (this.reasonName === "ADDON_INSTALL") {
      this.shouldShowIntroPanel = true;
    }

    // 3. Add new tab variation
    this.state.newTabMessage = this.newTabMessages[this.treatment];
    Services.mm.loadFrameScript(this.FRAME_SCRIPT_URL, true);
    // ensure the frame script is not loaded into any new tabs on shutdown,
    // existing frame scripts already loaded are handled by the bootstrap shutdown method
    CleanupManager.addCleanupHandler(() => Services.mm.removeDelayedFrameScript(this.FRAME_SCRIPT_URL));
    // 4. Add pageAction icon and pageAction panel; this is the complicated part
    await this.addPageActionAndPanel(win);
  }

  async addPageActionAndPanel(win) {
    // 4.1 Re-implement Tracking Protection to get number of blocked resources
    await this.reimplementTrackingProtection(win);
    // // 4.2 load stylesheet for pageAction panel
    // const uri = Services.io.newURI(this.STYLESHEET_URL);
    // styleSheetService.loadAndRegisterSheet(uri, styleSheetService.AGENT_SHEET);
    // CleanupManager.addCleanupHandler(() => styleSheetService.unregisterSheet(uri, styleSheetService.AGENT_SHEET));
    // // load content into existing windows and listen for new windows to load content in
    // WindowWatcher.start(this.loadIntoWindow.bind(this), this.unloadFromWindow.bind(this), this.onWindowError.bind(this));
  }

  loadIntoWindow(win) {
    // Add listeners to all open windows to know when to update pageAction
    this.addWindowEventListeners(win);
    // Add listeners to all new windows to know when to update pageAction.
    // Depending on which event happens (ex: onOpenWindow, onLocationChange),
    // it will call that listener method that exists on "this"
    Services.wm.addListener(this);
  }

  unloadFromWindow(win) {
    this.removeWindowEventListeners(win);
    Services.wm.removeListener(this);
    const pageActionButton = win.document.getElementById(`${this.PAGE_ACTION_BUTTON_ID}`);
    if (pageActionButton) {
      pageActionButton.removeEventListener("command", this.handlePageActionButtonCommandRef);
      pageActionButton.parentElement.removeChild(pageActionButton);
    }
  }

  onWindowError(msg) {
    this.log.debug(msg);
  }

  /**
  * Three cases of user looking at diff page:
      - switched windows (onOpenWindow)
      - loading new pages in the same tab (on page load in frame script)
      - switching tabs but not switching windows (tabSelect)
    Each one needs its own separate handler, because each one is detected by its
    own separate event.
  * @param {ChromeWindow} win
  */
  addWindowEventListeners(win) {
    if (win && win.gBrowser) {
      win.gBrowser.addTabsProgressListener(this);
      win.gBrowser.tabContainer.addEventListener(
        "TabSelect",
        this.onTabChangeRef,
      );
      // handle the case where the window closed, but intro or pageAction panel
      // is still open.
      win.addEventListener("SSWindowClosing", this.handleWindowClosingRef);
    }
  }

  removeWindowEventListeners(win) {
    if (win && win.gBrowser) {
      win.gBrowser.removeTabsProgressListener(this);
      win.gBrowser.tabContainer.removeEventListener(
        "TabSelect",
        this.onTabChangeRef,
      );
      win.removeEventListener("SSWindowClosing", this.handleWindowClosingRef);
    }
  }

  handleWindowClosing(evt) {
    const win = evt.target;
    if (this.state.introPanelIsShowing && win === this.weakIntroPanelChromeWindow.get()) {
      this.log.debug("about to hide introPanel");
      this.hidePanel("window-close", true);
    }
    if (this.state.pageActionPanelIsShowing && win === this.weakPageActionPanelChromeWindow.get()) {
      this.hidePanel("window-close", false);
    }
  }

  // This method is called when opening a new tab among many other times.
  // This is a listener for the addTabsProgressListener
  // Not appropriate for modifying the page itself because the page hasn't
  // finished loading yet. More info: https://tinyurl.com/lpzfbpj
  onLocationChange(browser, progress, request, uri, flags) {
    // only show pageAction icon and panels on http(s) pages
    if (uri.scheme !== "http" && uri.scheme !== "https") {
      return;
    }

    const LOCATION_CHANGE_SAME_DOCUMENT = 1;
    // ensure the location change event is occuring in the top frame (not an
    // iframe for example) and also that a different page is being loaded
    if (progress.isTopLevel && flags !== LOCATION_CHANGE_SAME_DOCUMENT) {
      this.showPageAction(browser.getRootNode());
      this.setPageActionCounter(browser.getRootNode(), 0);
      this.state.blockedResources.set(browser, 0);
      this.state.blockedAds.set(browser, 0);
      this.state.timeSaved.set(browser, 0);

      // Hide intro panel on location change in the same tab if showing
      if (this.state.introPanelIsShowing && this.weakIntroPanelBrowser.get() === browser) {
        this.hidePanel("location-change-same-tab", true);
      }
      if (this.state.pageActionPanelIsShowing) {
        this.hidePanel("location-change-same-tab", false);
      }
    }

    if (this.shouldShowIntroPanel) {
      this.weakIntroPanelBrowser = Cu.getWeakReference(browser);
    }
  }

  /**
  * Called when a non-focused tab is selected.
  * If have CNN in one tab (with blocked elements) and Fox in another, go to 
  * Fox tab and back to CNN, you want counter to change back to CNN count.
  * Only one icon in URL across all tabs, have to update it per page.
  */
  onTabChange(evt) {
    // Hide intro panel on tab change if showing
    if (this.state.introPanelIsShowing) {
      this.hidePanel("tab-change", true);
    }

    if (this.state.pageActionPanelIsShowing) {
      this.hidePanel("tab-change", false);
    }

    const win = evt.target.ownerGlobal;
    const currentURI = win.gBrowser.currentURI;

    // Only show pageAction on http(s) pages
    if (currentURI.scheme !== "http" && currentURI.scheme !== "https") {
      this.hidePageAction(win.document);
      return;
    }

    const currentWin = Services.wm.getMostRecentWindow("navigator:browser");

    // If user changes tabs but stays within current window we want to update
    // the status of the pageAction, then reshow it if the new page has had any
    // resources blocked.
    if (win === currentWin) {
      // depending on the treatment branch, we want the count of timeSaved
      // ("fast") or blockedResources ("private")
      let counter = this.treatment === "private" ?
        this.state.blockedResources.get(win.gBrowser.selectedBrowser) :
        this.state.timeSaved.get(win.gBrowser.selectedBrowser);
      if (!counter) {
        counter = 0;
      }
      this.showPageAction(win.document);
      this.setPageActionCounter(win.document, counter);
    }
  }

  /**
  * Display instrumented 'introductory panel' explaining the feature to the user
  * Telemetry Probes:
  *   - {event: introduction-shown}
  *   - {event: introduction-accept}
  *   - {event: introduction-leave-study}
  * Note:  TODO bdanforth: Panel WILL NOT SHOW if the only window open is a private window.
  *
  * @param {ChromeWindow} win
  * @param {String} message
  * @param {String} url
  */
  showPanel(win, message, isIntroPanel) {
    // don't show the pageAction panel before the intro panel has been shown
    if (this.shouldShowIntroPanel && !this.introPanelIsShowing && !isIntroPanel) {
      return;
    }
    if (isIntroPanel) {
      // Needed to determine if panel should be dismissed due to window close
      this.weakIntroPanelChromeWindow = Cu.getWeakReference(win);
    } else {
      this.weakPageActionPanelChromeWindow = Cu.getWeakReference(win);
    }
    const doc = win.document;
    const pageActionButton = doc.getElementById(this.PAGE_ACTION_BUTTON_ID);

    const weakIntroPanel = this.weakIntroPanel ? this.weakIntroPanel.get() : null;
    const weakPageActionPanel = this.weakPageActionPanel ? this.weakPageActionPanel.get() : null;
    let panel = isIntroPanel ? weakIntroPanel : weakPageActionPanel;
    if (!panel) {
      panel = this.getPanel(win, isIntroPanel);
    }
    pageActionButton.append(panel);

    panel.openPopup(pageActionButton);

    // if the user clicks off the panel, hide it
    if (!isIntroPanel) {
      this.weakPageActionPanelChromeWindow.get().addEventListener("click", this.handleChromeWindowClickRef);
      CleanupManager.addCleanupHandler(() => this.weakPageActionPanelChromeWindow.get().removeEventListener("click", this.handleChromeWindowClickRef));
    }
  }

  handleChromeWindowClick(evt) {
    if (evt.target.ownerDocument.URL !== `resource://${STUDY}/content/page-action-panel.html`
      && this.state.pageActionPanelIsShowing
      && evt.target.id !== this.PAGE_ACTION_BUTTON_ID) {
      this.hidePanel("user-clicked-off-panel", false);
    }
  }

  getPanel(win, isIntroPanel) {
    const doc = win.document;
    const browserSrc = isIntroPanel ? `resource://${STUDY}/content/intro-panel.html`
      : `resource://${STUDY}/content/page-action-panel.html`;
    const panel = doc.createElementNS(this.XUL_NS, "panel");
    panel.setAttribute("id", `${this.PANEL_ID}`);
    panel.setAttribute("type", "arrow");
    panel.setAttribute("level", "parent");
    panel.setAttribute("noautohide", "true");
    panel.setAttribute("flip", "both");
    panel.setAttribute("position", "bottomcenter topright");
    this.addPanelListeners(panel);
    const embeddedBrowser = doc.createElementNS(this.XUL_NS, "browser");
    embeddedBrowser.setAttribute("id", `${STUDY}-browser`);
    embeddedBrowser.setAttribute("src", `${browserSrc}`);
    embeddedBrowser.setAttribute("disableglobalhistory", "true");
    embeddedBrowser.setAttribute("type", "content");
    embeddedBrowser.setAttribute("flex", "1");
    panel.appendChild(embeddedBrowser);
    this.weakEmbeddedBrowser = Cu.getWeakReference(embeddedBrowser);
    if (isIntroPanel) {
      // Used to hide intro panel when tab change, window close, or location change occur
      this.weakIntroPanel = Cu.getWeakReference(panel);
    } else {
      this.weakPageActionPanel = Cu.getWeakReference(panel);
    }
    // TODO pass strings and values into this method to show up on the panel
    this.addBrowserContent();
    return panel;
  }

  addBrowserContent() {
    this.weakEmbeddedBrowser.get().addEventListener(
      "load",
      this.handleEmbeddedBrowserLoadRef,
      // capture is required: event target is the HTML document <browser> loads
      { capture: true }
    );
    CleanupManager.addCleanupHandler(() => {
      this.weakEmbeddedBrowser.get().removeEventListener(
        "load",
        this.handleEmbeddedBrowserLoadRef,
        // capture is required: event target is the HTML document <browser> loads
        { capture: true }
      );
    });
  }

  handleEmbeddedBrowserLoad() {
    // about:blank loads in a <browser> before the value of its src attribute,
    // so each embeddedBrowser actually loads twice.
    // Make sure we are only accessing our src page
    // accessing about:blank's contentWindow returns a dead object
    if (!this.weakEmbeddedBrowser.get().contentWindow) {
      return;
    }

    // enable messaging from page script to JSM
    Cu.exportFunction(
      this.sendMessageToChrome.bind(this),
      this.weakEmbeddedBrowser.get().contentWindow,
      { defineAs: "sendMessageToChrome"}
    );
    // Get the quantities for the pageAction panel for the current page
    const win = Services.wm.getMostRecentWindow("navigator:browser");
    if (win.gBrowser.selectedBrowser) {
      const browser = win.gBrowser.selectedBrowser;
      this.updateQuantities(browser);
    }
  }

  updateQuantities(browser) {
    const firstQuantity = this.state.blockedResources.get(browser);
    const secondQuantity = this.treatment === "fast"
      ? this.state.timeSaved.get(browser)
      : this.state.blockedAds.get(browser);
    // Let the page script know it can now send messages to JSMs,
    // since sendMessageToChrome has been exported
    this.weakEmbeddedBrowser.get().contentWindow.wrappedJSObject
      .onChromeListening(JSON.stringify({
        introHeader: this.introPanelHeaders[this.treatment],
        introMessage: this.introPanelMessages[this.treatment],
        pageActionQuantities: this.pageActionPanelQuantities[this.treatment],
        pageActionMessage: this.pageActionPanelMessages[this.treatment],
        firstQuantity,
        secondQuantity,
      }));
  }

  // This is a method my page scripts can call to pass messages to the JSM
  sendMessageToChrome(message, data) {
    this.handleUIEvent(message, data);
  }

  // <browser> height must be set explicitly; base it off content dimensions
  resizeBrowser(dimensions) {
    this.weakEmbeddedBrowser.get().style.width = `${ dimensions.width }px`;
    this.weakEmbeddedBrowser.get().style.height = `${ dimensions.height }px`;
  }

  handleUIEvent(message, data) {
    switch (message) {
      case "introduction-accept":
        this.hidePanel(message, true);
        break;
      case "introduction-reject":
        this.log.debug("You clicked 'Disable Protection' on the intro panel.");
        this.telemetry({ event: message });
        break;
      case "introduction-confirmation-cancel":
        this.log.debug("You clicked 'Cancel' on the intro confirmation panel.");
        this.telemetry({ event: message });
        break;
      case "introduction-confirmation-leave-study":
        this.log.debug("You clicked 'Disable' on the intro confirmation panel.");
        this.hidePanel(message, true);
        this.endStudy(message);
        break;
      case "page-action-reject":
        this.log.debug("You clicked 'Disable Protection' on the pageAction panel.");
        this.telemetry({ event: message });
        break;
      case "page-action-confirmation-cancel":
        this.log.debug("You clicked 'Cancel' on the pageAction confirmation panel.");
        this.telemetry({ event: message });
        break;
      case "page-action-confirmation-leave-study":
        this.log.debug("You clicked 'Disable' on the pageAction confirmation panel.");
        this.hidePanel(message, false);
        this.endStudy(message);
        break;
      case "browser-resize":
        this.resizeBrowser(JSON.parse(data));
        break;
      default:
        throw new Error(`UI event is not recognized, ${message}`);
    }
  }

  // These listeners are added to both the intro panel and the pageAction panel
  addPanelListeners(panel) {
    panel.addEventListener("popupshown", this.handlePopupShownRef);
    CleanupManager.addCleanupHandler(() => {
      try {
        panel.removeEventListener("popupshown", this.handlePopupShownRef);
      } catch (error) {
        // The panel has already been removed from the doc via the pageAction button being removed
      }
    });
    panel.addEventListener("popuphidden", this.handlePopupHiddenRef);
    CleanupManager.addCleanupHandler(() => {
      try {
        panel.removeEventListener("popuphidden", this.handlePopupHiddenRef);
      } catch (error) {
        // The panel has already been removed from the doc via the pageAction button being removed
      }
    });
  }

  handlePopupShown() {
    const panelType = (this.weakEmbeddedBrowser.get().src === `resource://${STUDY}/content/intro-panel.html`) ?
      "intro-panel" : "page-action-panel";
    if (panelType === "intro-panel") {
      this.state.introPanelIsShowing = true;
    } else {
      this.state.pageActionPanelIsShowing = true;
    }
    this.log.debug(`${panelType} shown.`);
    this.panelShownTime = Date.now();
    this.telemetry({ event: `${panelType}-shown` });
  }

  handlePopupHidden() {
    const panelType = (this.weakEmbeddedBrowser.get().src === `resource://${STUDY}/content/intro-panel.html`) ?
      "intro-panel" : "page-action-panel";
    if (panelType === "intro-panel") {
      this.state.introPanelIsShowing = false;
    } else {
      this.state.pageActionPanelIsShowing = false;
    }
    this.log.debug(`${panelType} hidden.`);
    const panelHiddenTime = Date.now();
    const panelOpenTime =
      (panelHiddenTime - this.panelShownTime) / 1000;
    this.log.debug(`${panelType} was open for ${Math.round(panelOpenTime)} seconds.`);
    this.telemetry({
      event: `${panelType}-hidden`,
      secondsPanelWasShowing: Math.round(panelOpenTime).toString(),
    });
  }

  // @param {Object} - data, a string:string key:value object
  async telemetry(data) {
    this.studyUtils.telemetry(data);
  }

  async reimplementTrackingProtection(win) {
    // 1. get blocklist and allowlist
    // TODO bdanforth: include a doc block with format/content for each
    // list/map/set in this.lists and this.state
    this.lists = {
      // a map with each key a domain name of a known tracker and each value 
      // the domain name of the owning entity
      // (ex: "facebook.de" -> "facebook.com")
      blocklist: new Map(),
      // An object where top level keys are owning company names; each company
      // key points to an object with a property and resource key.
      entityList: {},
    };

    // populate lists
    await blocklists.loadLists(this.lists);

    const filter = {urls: new win.MatchPatternSet(["*://*/*"])};

    WebRequest.onBeforeRequest.addListener(
      this.onBeforeRequestRef,
      // listener will only be called for requests whose targets match the filter
      filter,
      ["blocking"]
    );
    CleanupManager.addCleanupHandler(() => {
      WebRequest.onBeforeRequest.removeListener(
        this.onBeforeRequestRef,
        // listener will only be called for requests whose targets match the filter
        filter,
        ["blocking"]
      );
    });
  }

  hidePanel(details, isIntroPanel) {
    const panelType = isIntroPanel ? "introduction-panel" : "page-action-panel";
    const weakIntroPanel = this.weakIntroPanel ? this.weakIntroPanel.get() : null;
    const weakPageActionPanel = this.weakPageActionPanel ? this.weakPageActionPanel.get() : null;
    const panel = isIntroPanel ? weakIntroPanel : weakPageActionPanel;
    if (panel) {
      panel.hidePopup();
    }
    if (!isIntroPanel) {
      this.weakPageActionPanelChromeWindow.get().removeEventListener("click", (evt) => this.handleChromeWindowClick(evt));
    }
    this.log.debug(`${panelType} has been dismissed by user due to ${details}.`);
    this.telemetry({
      event: `${panelType}-dismissed`,
      details,
    });
  }

  /**
  * Called when the browser is about to make a network request.
  * @returns {BlockingResponse} object (determines whether or not
  * the request should be cancelled)
  * If this method returns {}, the request will not be blocked;
  * if it returns { cancel: true }, the request will be blocked.
  */
  onBeforeRequest(details) {
    this.log.debug("ON BEFORE REQUEST FIRED!!");
    return {};
    // const DONT_BLOCK_THE_REQUEST = {};
    // const BLOCK_THE_REQUEST = { cancel: true };

    // // If a request has started while the addon is shutting down and
    // // Feature.jsm has unloaded
    // if (!URL || !Services) {
    //   return DONT_BLOCK_THE_REQUEST;
    // }

    // // make sure there is a details object, that the request has a target URL,
    // // and that the resource being requested is going to be loaded into a XUL browser
    // if (details && details.url && details.browser) {
    //   const browser = details.browser;
    //   // the currently loaded URL for the browser
    //   const currentURI = browser.currentURI;

    //   // if no URL is loaded into the browser
    //   if (!currentURI) {
    //     return DONT_BLOCK_THE_REQUEST;
    //   }

    //   // if there's no URL for the resource that triggered the request
    //   if (!details.originUrl) {
    //     return DONT_BLOCK_THE_REQUEST;
    //   }

    //   // if the page loaded into the browser is not a "normal webpage"
    //   if (currentURI.scheme !== "http" && currentURI.scheme !== "https") {
    //     return DONT_BLOCK_THE_REQUEST;
    //   }

    //   // the domain name for the current page (e.g. www.nytimes.com)
    //   const currentHost = currentURI.host;
    //   // the domain name for the entity making the request
    //   const host = new URL(details.originUrl).host;

    //   // Block third-party requests only.
    //   if (currentHost !== host
    //     && blocklists.hostInBlocklist(this.lists.blocklist, host)) {
    //     let counter = 0;
    //     if (this.state.blockedResources.has(details.browser)) {
    //       counter = this.state.blockedResources.get(details.browser);
    //     }

    //     const rootDomainHost = this.getRootDomain(host);
    //     const rootDomainCurrentHost = this.getRootDomain(currentHost);

    //     // check if host entity is in the entity list;
    //     // TODO bdanforth: improve effeciency of this algo
    //     // https://github.com/mozilla/blok/blob/master/src/js/requests.js#L18-L27
    //     // for a much more efficient implementation
    //     for (const entity in this.lists.entityList) {
    //       if (this.lists.entityList[entity].resources.includes(rootDomainHost)) {
    //         const resources = this.lists.entityList[entity].resources;
    //         const properties = this.lists.entityList[entity].properties;
    //         // This just means that this "host" is contained in the entity list
    //         // and owned by "entity" but we have to check and see if the
    //         // "currentHost" is also owned by "entity"
    //         // if it is, don't block the request; if it isn't, block the request
    //         if (resources.includes(rootDomainCurrentHost)
    //           || properties.includes(rootDomainCurrentHost)) {
    //           return DONT_BLOCK_THE_REQUEST;
    //         }
    //       }
    //     }

    //     // If we get this far, we're going to block the request
    //     counter++;
    //     this.state.blockedResources.set(details.browser, counter);
    //     this.state.blockedAds.set(details.browser, Math.floor(this.AD_FRACTION * counter));
    //     const timeSavedThisRequest = Math.min(Math.random() * (counter) * 1000, this.MAX_TIME_SAVED_FRACTION * counter * 1000);
    //     const timeSavedLastRequest = this.state.timeSaved.get(details.browser);
    //     if (timeSavedThisRequest > timeSavedLastRequest) {
    //       this.state.timeSaved.set(details.browser, timeSavedThisRequest);
    //       this.state.totalTimeSaved += (timeSavedThisRequest - timeSavedLastRequest);
    //     }
    //     this.state.totalBlockedResources += 1;
    //     this.state.totalBlockedAds = Math.floor(this.AD_FRACTION * this.state.totalBlockedResources);

    //     Services.mm.broadcastAsyncMessage("TrackingStudy:UpdateContent", {
    //       blockedResources: this.state.totalBlockedResources,
    //       timeSaved: this.state.totalTimeSaved,
    //       blockedAds: this.state.totalBlockedAds,
    //     });
    //     // If the pageAction panel is showing, update the quantities dynamically
    //     if (this.state.pageActionPanelIsShowing) {
    //       const firstQuantity = counter;
    //       const secondQuantity = this.treatment === "fast"
    //         ? this.state.timeSaved.get(details.browser)
    //         : this.state.blockedAds.get(details.browser);
    //       this.weakEmbeddedBrowser.get().contentWindow.wrappedJSObject
    //         .updateTPNumbers(JSON.stringify({
    //           treatment: this.treatment,
    //           firstQuantity,
    //           secondQuantity,
    //         }));
    //     }

    //     const enumerator = Services.wm.getEnumerator("navigator:browser");
    //     while (enumerator.hasMoreElements()) {
    //       const win = enumerator.getNext();
    //       // Mac OS has an application window that keeps running even if all
    //       // normal Firefox windows are closed.
    //       if (win === Services.appShell.hiddenDOMWindow) {
    //         continue;
    //       }

    //       // only update pageAction with new blocked requests if we're in the
    //       // "private" treatment branch, otherwise we want to display timeSaved
    //       // for the "fast" treatment branch
    //       if (details.browser === win.gBrowser.selectedBrowser) {
    //         this.showPageAction(browser.getRootNode());
    //         this.setPageActionCounter(browser.getRootNode(), this.treatment === "private" ? counter : this.state.timeSaved.get(details.browser));
    //       }
    //     }
    //     return BLOCK_THE_REQUEST;
    //   }
    // }
    // return DONT_BLOCK_THE_REQUEST;
  }

  // e.g. takes "www.mozilla.com", and turns it into "mozilla.com"
  getRootDomain(host) {
    const domain = host.split(".");
    domain.shift();
    return domain.join(".");
  }

  /**
   * Shows the page action button.
   *
   * @param {document} doc - the browser.xul document for the page action.
   */
  showPageAction(doc) {
    const urlbar = doc.getElementById("page-action-buttons");

    let pageActionButton = doc.getElementById(`${this.PAGE_ACTION_BUTTON_ID}`);

    if (!pageActionButton) {
      pageActionButton = doc.createElementNS(this.XUL_NS, "toolbarbutton");
      pageActionButton.style.backgroundColor = "green";
      pageActionButton.setAttribute("id", `${this.PAGE_ACTION_BUTTON_ID}`);
      pageActionButton.setAttribute(
        "image",
        "chrome://browser/skin/controlcenter/tracking-protection.svg#enabled");
      pageActionButton.addEventListener("command", this.handlePageActionButtonCommandRef);
      // listener gets removed when hidePageAction is called or on uninit

      urlbar.append(pageActionButton);
    }
  }

  handlePageActionButtonCommand(evt) {
    const win = evt.target.ownerGlobal;
    // Make sure the user clicked on the pageAction button, otherwise
    // once the intro panel is closed by the user clicking a button inside
    // of it, it will trigger the pageAction panel to open immediately.
    if (evt.target.id === `${this.PAGE_ACTION_BUTTON_ID}`
      && !this.state.introPanelIsShowing) {
      if (!this.state.pageActionPanelIsShowing) {
        const isIntroPanel = false;
        this.showPanel(
          win,
          this.introPanelMessages[this.treatment],
          isIntroPanel
        );
      } else {
        this.hidePanel("page-action-click", false);
      }
    }
  }

  setPageActionCounter(doc, counter) {
    if (this.shouldShowIntroPanel && counter > 0) {
      const win = Services.wm.getMostRecentWindow("navigator:browser");
      const isIntroPanel = true;
      this.showPanel(
        win,
        this.introPanelMessages[this.treatment],
        isIntroPanel
      );
      this.shouldShowIntroPanel = false;
    }
    const toolbarButton = doc.getElementById(`${this.PAGE_ACTION_BUTTON_ID}`);
    if (toolbarButton) {
      // if "fast" treatment, convert counter from ms to seconds and add unit "s"
      const label = this.treatment === "private" ? counter
        : `${Math.ceil(counter / 1000)}s`;
      toolbarButton.setAttribute("label", label);
    }
  }

  hidePageAction(doc) {
    const pageActionButton = doc.getElementById(`${this.PAGE_ACTION_BUTTON_ID}`);
    if (pageActionButton) {
      pageActionButton.removeEventListener("command", this.handlePageActionButtonCommandRef);
      pageActionButton.parentElement.removeChild(pageActionButton);
    }
  }

  async endStudy(reason, shouldResetTP = true) {
    this.isStudyEnding = true;
    if (shouldResetTP) {
      this.resetBuiltInTrackingProtection();
    }
    await this.studyUtils.endStudy({ reason });
  }

  async uninit() {

    // Shutdown intro panel or pageAction panel, if either is active
    if (this.weakEmbeddedBrowser) {
      try {
        this.weakEmbeddedBrowser.get().contentWindow.wrappedJSObject.onShutdown();
      } catch (error) {
        // the <browser> element must have already been removed from the chrome
      }
    }

    // Remove all listeners from existing windows and stop listening for new windows
    // WindowWatcher.stop();

    // Remove all listeners from other objects like tabs, <panels> and <browser>s
    await CleanupManager.cleanup();

    // Remove all references to DOMWindow objects and their descendants
    delete this.weakIntroPanel;
    delete this.weakIntroPanelBrowser;
    delete this.weakIntroPanelChromeWindow;
    delete this.weakPageActionPanel;
    delete this.weakPageActionPanelChromeWindow;
    delete this.weakEmbeddedBrowser;
    delete this.state.blockedResources;
    delete this.state.blockedAds;
    delete this.state.timeSaved;

    Cu.unload(`resource://${STUDY}/lib/Canonicalize.jsm`);
    Cu.unload(`resource://${STUDY}/lib/BlockLists.jsm`);
    Cu.unload(`resource://${STUDY}/lib/CleanupManager.jsm`);
    Cu.unload(`resource://${STUDY}/lib/WindowWatcher.jsm`);
  }

  resetBuiltInTrackingProtection() {
    if (this.treatment === "pseudo-control") {
      Services.prefs.setBoolPref(this.PREF_TP_ENABLED_GLOBALLY, false);
    }
    Services.prefs.setBoolPref(this.PREF_TP_ENABLED_IN_PRIVATE_WINDOWS, true);
  }
}
