/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* global blocklists CleanupManager WindowWatcher */
/* eslint no-unused-vars: ["error", { "varsIgnorePattern": "(EXPORTED_SYMBOLS|Feature)" }] */

/**
 * What this Feature does: TODO bdanforth: complete
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
 */

// Import Firefox modules
const { utils: Cu } = Components;
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "Services",
  "resource://gre/modules/Services.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "ProfileAge",
  "resource://gre/modules/ProfileAge.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "AddonManager",
 "resource://gre/modules/AddonManager.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "WebRequest",
  "resource://gre/modules/WebRequest.jsm");
XPCOMUtils.defineLazyServiceGetter(this, "styleSheetService",
  "@mozilla.org/content/style-sheet-service;1", "nsIStyleSheetService");
XPCOMUtils.defineLazyModuleGetter(this, "PrivateBrowsingUtils",
  "resource://gre/modules/PrivateBrowsingUtils.jsm");
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
XPCOMUtils.defineLazyModuleGetter(this, "Storage",
  `resource://${STUDY}/lib/Storage.jsm`);

const EXPORTED_SYMBOLS = ["Feature"];

class Feature {
  /**
   * The study feature.
   *
   * @param {Object} options            Options object
   * @param {Object} options.variation  Study info about particular client study variation.
   * @param {Object} options.studyUtils The configured studyUtils singleton.
   * @param {string} options.reasonName String of bootstrap.js startup/shutdown reason.
   * @param {string} options.logLevel   The log level from Config.jsm (uses same level as bootstrap.js).
   * @returns {void}
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
    this.handleEmbeddedBrowserLoadRef = this.handleEmbeddedBrowserLoad.bind(this);
    this.handlePopupShownRef = this.handlePopupShown.bind(this);
    this.handlePopupHiddenRef = this.handlePopupHidden.bind(this);
    this.onBeforeRequestRef = this.onBeforeRequest.bind(this);
    this.handleChromeWindowClickRef = this.handleChromeWindowClick.bind(this);
    this.onWindowDeactivateRef = this.onWindowDeactivate.bind(this);

    this.init(logLevel);

    // Because `about:newtab` is very complex (Activity Stream), it is by default
    // preloaded after the first visit. Since our frame script measures time `about:newtab`
    // is open based on the lifetime of the script, we need to turn off preloading to get an
    // accurate measurement.
    // We also need this to add the new tab mod as soon as at least 1 resource is blocked for
    // the session; otherwise the mod wouldn't show until the following newtab page was visited.
    Services.prefs.setBoolPref("browser.newtab.preload", false);
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
      // Only show the intro panel on install
      shouldShowIntroPanel: false,
    };

    if (this.treatment in this.TREATMENTS) {
      await this.TREATMENTS[this.treatment](win);
    }

    // if user toggles built-in TP on/off, end the study
    // Note: This listener can't be added until after the treatment has been applied,
    // since we are initializing built-in TP based on the treatment.
    this.addBuiltInTrackingProtectionListeners();

    await this.initBehaviorSummary();
  }

  addContentMessageListeners() {
    // content listener
    Services.mm.addMessageListener("TrackingStudy:InitialContent", this);
    Services.mm.addMessageListener("TrackingStudy:NewTabOpenTime", this);

    CleanupManager.addCleanupHandler(() => Services.mm.removeMessageListener("TrackingStudy:InitialContent", this));
    CleanupManager.addCleanupHandler(() => Services.mm.removeMessageListener("TrackingStudy:NewTabOpenTime", this));
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
      case "TrackingStudy:NewTabOpenTime":
        this.log.debug(`You opened a new tab page for ${msg.data} seconds.`);
        this.telemetry({
          message_type: "event",
          event: "new-tab-closed",
          newTabOpenTime: String(msg.data)
        });
        this.addBehaviorMeasure("new_tab_open_times", msg.data);
        break;
      default:
        throw new Error(`Message type not recognized, ${ msg.name }`);
    }
  }

  /**
   * Create a new instance of the ConsoleAPI, so we can control
   * the maxLogLevel with Config.jsm.
   *
   * @param {string} logLevel NEEDS_DOC
   * @returns {ConsoleAPI}    NEEDS_DOC
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

  async initBehaviorSummary() {
    const initialized = (await Storage.has("behavior-summary"));
    if (initialized) return;

    // does the user have any of the top adblockers?
    const ADBLOCKER_ID_LIST = [
                                "{d10d0bf8-f5b5-c8b4-a8b2-2b9879e08c5d}", // AdblockPlus
                                "uBlock0@raymondhill.net", // uBlock Origin
                                "jid1-NIfFY2CA8fy1tg@jetpack" // Adblock for Firefox
                              ];
    let containsAddon = false;
    AddonManager.getAllAddons().then((addons) => {
      for (let addon of addons) {
        if (ADBLOCKER_ID_LIST.includes(addon.id)) containsAddon = true;
      }
    })

    // co-variates
    const oldestTimestamp = await ((new ProfileAge()).getOldestProfileTimestamp())
    const profileAgeDays = Math.round((Date.now() - oldestTimestamp) / (1000 * 3600 * 24));
    const dntEnabled = Services.prefs.getBoolPref("privacy.donottrackheader.enabled");
    const historyEnabled = Services.prefs.getBoolPref("places.history.enabled");
    const appUpdateEnabled = Services.prefs.getBoolPref("app.update.enabled");

    await Storage.create("behavior-summary", {
      reject: "false",
      intro_accept: "false",
      intro_reject: "false",
      badge_clicks: String(0),
      panel_open_times: JSON.stringify([]),
      panel_open_times_median: String(0),
      panel_open_times_mean: String(0),
      new_tab_open_times: JSON.stringify([]),
      new_tab_open_times_median: String(0),
      new_tab_open_times_mean: String(0),
      page_action_counter: JSON.stringify([]),
      page_action_counter_median: String(0),
      page_action_counter_mean: String(0),
      covariates_profile_age: String(profileAgeDays),
      covariates_dnt_enabled: String(dntEnabled),
      covariates_history_enabled: String(historyEnabled),
      covariates_app_update_enabled: String(appUpdateEnabled),
      covariates_has_adblocker: String(containsAddon)
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
          this.telemetry({
            message_type: "event",
            event: "study-ended",
            reason: reason,
          });
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
      this.state.shouldShowIntroPanel = true;
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
    // 4.2 load stylesheet for pageAction panel
    const uri = Services.io.newURI(this.STYLESHEET_URL);
    styleSheetService.loadAndRegisterSheet(uri, styleSheetService.AGENT_SHEET);
    CleanupManager.addCleanupHandler(() => styleSheetService.unregisterSheet(uri, styleSheetService.AGENT_SHEET));
    // load content into existing windows and listen for new windows to load content in
    WindowWatcher.start(this.loadIntoWindow.bind(this), this.unloadFromWindow.bind(this), this.onWindowError.bind(this));
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
    // handle the case where the window closed, but intro or pageAction panel
    // is still open.
    this.handleWindowClosing(win);
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
   *   - switched windows (onOpenWindow)
   *   - loading new pages in the same tab (on page load in frame script)
   *   - switching tabs but not switching windows (tabSelect)
   * Each one needs its own separate handler, because each one is detected by its
   * own separate event.
   *
   * @param {ChromeWindow} win NEEDS_DOC
   * @returns {void}
  */
  addWindowEventListeners(win) {
    if (win && win.gBrowser) {
      win.gBrowser.addTabsProgressListener(this);
      win.gBrowser.tabContainer.addEventListener(
        "TabSelect",
        this.onTabChangeRef,
      );
      win.addEventListener("deactivate", this.onWindowDeactivateRef);
    }
  }

  removeWindowEventListeners(win) {
    if (win && win.gBrowser) {
      win.gBrowser.removeTabsProgressListener(this);
      win.gBrowser.tabContainer.removeEventListener(
        "TabSelect",
        this.onTabChangeRef,
      );
      win.removeEventListener("deactivate", this.onWindowDeactivateRef);
    }
  }

  // Dismiss the intro panel if showing on window change
  // Note: deactivate is only fired when the focus state changes for a top-level window.
  // focus/blur events fire whenever focus changes for any DOM element
  onWindowDeactivate(evt) {
    const win = evt.target;
    if (this.state.introPanelIsShowing
      && win === this.weakIntroPanelChromeWindow.get()) {
      this.hidePanel("window-deactivate", true);
    }
  }

  handleWindowClosing(win) {
    if (this.state.introPanelIsShowing && win === this.weakIntroPanelChromeWindow.get()) {
      this.hidePanel("window-close", true);
    }
    if (this.state.pageActionPanelIsShowing && win === this.weakPageActionPanelChromeWindow.get()) {
      this.hidePanel("window-close", false);
    }
  }

  /**
   * This method is called when opening a new tab among many other times.
   * This is a listener for the addTabsProgressListener
   * Not appropriate for modifying the page itself because the page hasn't
   * finished loading yet. More info: https://tinyurl.com/lpzfbpj
   *
   * @param  {Object} browser  NEEDS_DOC
   * @param  {Object} progress NEEDS_DOC
   * @param  {Object} request  NEEDS_DOC
   * @param  {Object} uri      NEEDS_DOC
   * @param  {number} flags    NEEDS_DOC
   * @returns {void}
   */
  onLocationChange(browser, progress, request, uri, flags) {
    const LOCATION_CHANGE_SAME_DOCUMENT = 1;
    // ensure the location change event is occuring in the top frame (not an
    // iframe for example) and also that a different page is being loaded
    if (!progress.isTopLevel || flags === LOCATION_CHANGE_SAME_DOCUMENT) {
      return;
    }

    // Hide panels on location change in the same tab if showing
    if (this.state.introPanelIsShowing && this.weakIntroPanelBrowser.get() === browser) {
      this.hidePanel("location-change-same-tab", true);
    }
    if (this.state.pageActionPanelIsShowing) {
      this.hidePanel("location-change-same-tab", false);
    }

    const doc = browser.getRootNode();

    // only show pageAction on http(s) pages
    if (uri.scheme !== "http" && uri.scheme !== "https") {
      this.hidePageAction(doc);
      return;
    }

    // if we got this far, this is an http(s) page; show pageAction and
    // reset per-page quantities
    const win = browser.ownerGlobal;
    this.showPageAction(doc, win);
    this.setPageActionCounter(doc, 0, win);
    this.state.blockedResources.set(browser, 0);
    this.state.blockedAds.set(browser, 0);
    this.state.timeSaved.set(browser, 0);

    if (this.state.shouldShowIntroPanel) {
      this.weakIntroPanelBrowser = Cu.getWeakReference(browser);
    }
  }

  /**
   * Called when a non-focused tab is selected.
   * If have CNN in one tab (with blocked elements) and Fox in another, go to
   * Fox tab and back to CNN, you want counter to change back to CNN count.
   * Only one icon in URL across all tabs, have to update it per page.
   *
   * @param {Object} evt NEEDS_DOC
   * @returns {void}
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
        this.state.blockedResources.get(win.gBrowser.selectedBrowser) || 0 :
        this.state.timeSaved.get(win.gBrowser.selectedBrowser) || 0;
      if (!counter) {
        counter = 0;
      }
      this.showPageAction(win.document, win);
      this.setPageActionCounter(win.document, counter, win);
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
   * @param   {ChromeWindow}  win    NEEDS_DOC
   * @param   {string}  message      NEEDS_DOC
   * @param   {boolean} isIntroPanel NEEDS_DOC
   * @returns {void}
   */
  showPanel(win, message, isIntroPanel) {
    // If there's both a non-private and private window showing, we get window
    // listeners from the non-private window calling showPanel
    if (PrivateBrowsingUtils.isWindowPrivate(win)) {
      return;
    }

    // don't show the pageAction panel before the intro panel has been shown
    if (this.state.shouldShowIntroPanel && !this.introPanelIsShowing && !isIntroPanel) {
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
    const firstQuantity = this.state.blockedResources.get(browser) || 0;
    const secondQuantity = this.treatment === "fast"
      ? this.state.timeSaved.get(browser) || 0
      : this.state.blockedAds.get(browser) || 0;
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

  /**
   * This is a method my page scripts can call to pass messages to the JSM.
   *
   * @param  {string} message NEEDS_DOC
   * @param  {Object} data    NEEDS_DOC
   * @returns {void}
   */
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

        Storage.update("behavior-summary", {intro_accept: "true"});
        break;
      case "introduction-reject":
        this.log.debug("You clicked 'Disable Protection' on the intro panel.");
        this.telemetry({
          message_type: "event",
          event: "ui-event",
          ui_event: message,
        });
        break;
      case "introduction-confirmation-cancel":
        this.log.debug("You clicked 'Cancel' on the intro confirmation panel.");
        this.telemetry({
          message_type: "event",
          event: "ui-event",
          ui_event: message,
        });
        break;
      case "introduction-confirmation-leave-study":
        this.log.debug("You clicked 'Disable' on the intro confirmation panel.");
        this.hidePanel(message, true);
        this.telemetry({
          message_type: "event",
          event: "ui-event",
          ui_event: message,
        });

        Storage.update("behavior-summary", {intro_reject: "true"}).then(() => this.endStudy(message));
        break;
      case "page-action-reject":
        this.log.debug("You clicked 'Disable Protection' on the pageAction panel.");
        this.telemetry({
          message_type: "event",
          event: "ui-event",
          ui_event: message,
        });
        break;
      case "page-action-confirmation-cancel":
        this.log.debug("You clicked 'Cancel' on the pageAction confirmation panel.");
        this.telemetry({
          message_type: "event",
          event: "ui-event",
          ui_event: message,
        });
        break;
      case "page-action-confirmation-leave-study":
        this.log.debug("You clicked 'Disable' on the pageAction confirmation panel.");
        this.hidePanel(message, false);
        this.telemetry({
          message_type: "event",
          event: "ui-event",
          ui_event: message,
        });

        Storage.update("behavior-summary", {reject: "true"}).then(() => this.endStudy(message));
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
    this.telemetry({
        message_type: "event",
        event: "panel-shown",
        panel_type: panelType
      });
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
      Math.round((panelHiddenTime - this.panelShownTime) / 1000);
    this.log.debug(`${panelType} was open for ${panelOpenTime} seconds.`);
    this.telemetry({
        message_type: "event",
        event: "panel-hidden",
        panel_type: panelType,
        showTime: panelOpenTime.toString(),
      });
    this.addBehaviorMeasure("panel_open_times", panelOpenTime);
  }

  /**
   * NEEDS_DOC
   *
   * @param   {Object} data A string:string key:value object.
   * @returns {void}
   */
  async telemetry(data) {
    this.studyUtils.telemetry(data);
  }

  async reportBehaviorSummary() {
    const behaviorSummary = await Storage.get("behavior-summary");
    return this.telemetry(Object.assign({message_type: "behavior_summary"}, behaviorSummary));
  }

  /**
  * adds a new value for a measure to the behavior summary and updates its mean and median
  * this is mainly used to get a summary of quantitative values that are recorded multiple times,
  * such as how long the panel has been open
  * @param {String} type - source of measure
  * @param {Integer} value - measured value
  */
  async addBehaviorMeasure(type, value) {

    const median = function(arr) {
      arr = arr.slice(0).sort( (a, b) => a - b );

      return middle(arr);
    }

    const middle = function(arr) {
      const len = arr.length;
      const half = Math.floor(len / 2);

      if(len % 2)
        return arr[half];
      else
        return (arr[half - 1] + arr[half]) / 2.0;
    }

    const behaviorSummary = (await Storage.get("behavior-summary"));
    const valuesArr = JSON.parse(behaviorSummary[`${type}`]);
    valuesArr.push(value);

    const meanValue = valuesArr.reduce((acc, cV) => acc + cV) / valuesArr.length;
    const medianValue = median(valuesArr);

    return Storage.update("behavior-summary", {
      [`${type}`]: JSON.stringify(valuesArr),
      [`${type}_mean`]: String(meanValue),
      [`${type}_median`]: String(medianValue)
    });
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
      message_type: "event",
      event: "panel-dismissed",
      panel_type: panelType,
      reason: details,
    });
  }

  /**
   * Called when the browser is about to make a network request.
   *
   * @param {Object} details NEEDS_DOC
   * @returns {BlockingResponse} data (determines whether or not
   * the request should be cancelled).
   * If this method returns `{}`, the request will not be blocked;
   * if it returns `{ cancel: true }`, the request will be blocked.
   */
  onBeforeRequest(details) {
    const DONT_BLOCK_THE_REQUEST = {};
    const BLOCK_THE_REQUEST = { cancel: true };

    // If a request has started while the addon is shutting down and
    // Feature.jsm has unloaded
    if (!URL || !Services) {
      return DONT_BLOCK_THE_REQUEST;
    }

    // make sure there is a details object, that the request has a target URL,
    // and that the resource being requested is going to be loaded into a XUL browser
    if (details && details.url && details.browser) {
      const browser = details.browser;
      // the currently loaded URL for the browser
      const currentURI = browser.currentURI;

      // if no URL is loaded into the browser
      if (!currentURI) {
        return DONT_BLOCK_THE_REQUEST;
      }

      // if there's no URL for the resource that triggered the request
      if (!details.originUrl) {
        return DONT_BLOCK_THE_REQUEST;
      }

      // if the page loaded into the browser is not a "normal webpage"
      if (currentURI.scheme !== "http" && currentURI.scheme !== "https") {
        return DONT_BLOCK_THE_REQUEST;
      }

      // the domain name for the current page (e.g. www.nytimes.com)
      const currentHost = currentURI.host;
      // the domain name for the entity making the request
      const host = new URL(details.originUrl).host;

      // Block third-party requests only.
      if (currentHost !== host
        && blocklists.hostInBlocklist(this.lists.blocklist, host)) {
        let counter = this.state.blockedResources.get(details.browser) || 0;

        const rootDomainHost = this.getRootDomain(host);
        const rootDomainCurrentHost = this.getRootDomain(currentHost);

        // check if host entity is in the entity list;
        // TODO bdanforth: improve effeciency of this algo
        // https://github.com/mozilla/blok/blob/master/src/js/requests.js#L18-L27
        // for a much more efficient implementation
        for (const entity in this.lists.entityList) {
          if (this.lists.entityList[entity].resources.includes(rootDomainHost)) {
            const resources = this.lists.entityList[entity].resources;
            const properties = this.lists.entityList[entity].properties;
            // This just means that this "host" is contained in the entity list
            // and owned by "entity" but we have to check and see if the
            // "currentHost" is also owned by "entity"
            // if it is, don't block the request; if it isn't, block the request
            if (resources.includes(rootDomainCurrentHost)
              || properties.includes(rootDomainCurrentHost)) {
              return DONT_BLOCK_THE_REQUEST;
            }
          }
        }

        // If we get this far, we're going to block the request
        counter++;
        this.state.blockedResources.set(details.browser, counter);
        const timeSavedThisRequest = Math.min(Math.random() * (counter) * 1000, this.MAX_TIME_SAVED_FRACTION * counter * 1000);
        const timeSavedLastRequest = this.state.timeSaved.get(details.browser) || 0;
        if (timeSavedThisRequest > timeSavedLastRequest) {
          this.state.timeSaved.set(details.browser, timeSavedThisRequest);
          this.state.totalTimeSaved -= Math.ceil(timeSavedLastRequest / 1000);
          this.state.totalTimeSaved += Math.ceil(timeSavedThisRequest / 1000);
        }
        this.state.totalBlockedResources += 1;
        const adsBlockedLastRequest = this.state.blockedAds.get(details.browser) || 0;
        const adsBlockedThisRequest = Math.floor(this.AD_FRACTION * counter);
        this.state.totalBlockedAds -= Math.floor(adsBlockedLastRequest);
        this.state.totalBlockedAds += Math.floor(adsBlockedThisRequest);
        this.state.blockedAds.set(details.browser, Math.floor(this.AD_FRACTION * counter));
        Services.mm.broadcastAsyncMessage("TrackingStudy:UpdateContent", {
          blockedResources: this.state.totalBlockedResources,
          timeSaved: this.state.totalTimeSaved,
          blockedAds: this.state.totalBlockedAds,
          newTabMessage: this.newTabMessages[this.treatment],
        });
        // If the pageAction panel is showing, update the quantities dynamically
        if (this.state.pageActionPanelIsShowing) {
          const firstQuantity = counter;
          const secondQuantity = this.treatment === "fast"
            ? this.state.timeSaved.get(details.browser) || 0
            : this.state.blockedAds.get(details.browser) || 0;
          this.weakEmbeddedBrowser.get().contentWindow.wrappedJSObject
            .updateTPNumbers(JSON.stringify({
              treatment: this.treatment,
              firstQuantity,
              secondQuantity,
            }));
        }

        const enumerator = Services.wm.getEnumerator("navigator:browser");
        while (enumerator.hasMoreElements()) {
          const win = enumerator.getNext();
          // Mac OS has an application window that keeps running even if all
          // normal Firefox windows are closed.
          // Since WebRequest.onBeforeRequest isn't a window listener, we
          // have to check for PB mode here too.
          if (win === Services.appShell.hiddenDOMWindow
            || PrivateBrowsingUtils.isWindowPrivate(win)) {
            continue;
          }

          // only update pageAction with new blocked requests if we're in the
          // "private" treatment branch, otherwise we want to display timeSaved
          // for the "fast" treatment branch
          if (details.browser === win.gBrowser.selectedBrowser) {
            const badgeValue = this.treatment === "private"
              ? counter
              : this.state.timeSaved.get(details.browser) || 0;
            this.showPageAction(browser.getRootNode(), win);
            this.setPageActionCounter(browser.getRootNode(), badgeValue, win);
          }
        }
        return BLOCK_THE_REQUEST;
      }
    }
    return DONT_BLOCK_THE_REQUEST;
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
   * @param {document} doc The browser.xul document for the page action.
   * @param {ChromeWindow} win NEEDS_DOC
   * @returns {void}
   */
  showPageAction(doc, win) {
    // If we have both a non-private and private window open, the non-private
    // window will try to show UI; instead we want the study to pause when a
    // private window is open
    if (PrivateBrowsingUtils.isWindowPrivate(win)) {
      return;
    }
    const urlbar = doc.getElementById("page-action-buttons");

    let pageActionButton = doc.getElementById(`${this.PAGE_ACTION_BUTTON_ID}`);

    if (!pageActionButton) {
      pageActionButton = doc.createElementNS(this.XUL_NS, "toolbarbutton");
      pageActionButton.style.backgroundColor = "green";
      pageActionButton.setAttribute("id", `${this.PAGE_ACTION_BUTTON_ID}`);
      pageActionButton.setAttribute(
        "image",
        `resource://${STUDY}/content/tp-shield.svg`);
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
    if (evt.target.id !== `${this.PAGE_ACTION_BUTTON_ID}`) {
      return;
    }
    const isIntroPanel = this.state.introPanelIsShowing || this.state.shouldShowIntroPanel;
    if (this.state.pageActionPanelIsShowing
      || this.state.introPanelIsShowing) {
      this.hidePanel("page-action-click", isIntroPanel);
    } else {
      this.showPanel(
        win,
        this.introPanelMessages[this.treatment],
        isIntroPanel
      );
      if (isIntroPanel) this.state.shouldShowIntroPanel = false;
      
      // record page action click event and badge count
      let counter = this.treatment === "private" ?
        this.state.blockedResources.get(win.gBrowser.selectedBrowser) || 0 :
        Math.ceil((this.state.timeSaved.get(win.gBrowser.selectedBrowser) || 0) / 1000);

      Storage.get("behavior-summary").then((behaviorSummary) => {
        let clicks = Number(behaviorSummary.badge_clicks) + 1;
        return Storage.update("behavior-summary", {badge_clicks: String(clicks)});
      });

      this.telemetry({
        message_type: "event",
        event: "page-action-click",
        counter:  String(counter),
        is_intro: String(isIntroPanel),
        treatment: this.treatment
      });

      this.addBehaviorMeasure("page_action_counter", counter);
    }
  }

  setPageActionCounter(doc, counter, win) {
    // We could block resources in Private Browsing, but we don't want
    // to trigger the intro panel until we're not in private browsing
    if (PrivateBrowsingUtils.isWindowPrivate(win)) {
      return;
    }
    if (this.state.shouldShowIntroPanel && counter > 0) {
      const isIntroPanel = true;
      this.showPanel(
        win,
        this.introPanelMessages[this.treatment],
        isIntroPanel
      );
      this.state.shouldShowIntroPanel = false;
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
    // returning the Activity Stream preloading to its default state
    Services.prefs.clearUserPref("browser.newtab.preload");

    // Shutdown intro panel or pageAction panel, if either is active
    if (this.weakEmbeddedBrowser) {
      try {
        this.weakEmbeddedBrowser.get().contentWindow.wrappedJSObject.onShutdown();
      } catch (error) {
        // the <browser> element must have already been removed from the chrome
      }
    }

    // Remove all listeners from existing windows and stop listening for new windows
    WindowWatcher.stop();

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
