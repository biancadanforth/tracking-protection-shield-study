"use strict";

/* global config, studyUtils, Feature */
/* eslint no-unused-vars: ["error", { "varsIgnorePattern": "(startup|shutdown|install|uninstall)" }]*/

const { utils: Cu } = Components;
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "Services",
  "resource://gre/modules/Services.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "Preferences",
  "resource://gre/modules/Preferences.jsm");

const STUDY = "tracking-protection-messaging-study";

XPCOMUtils.defineLazyModuleGetter(this, "config",
  `resource://${STUDY}/lib/Config.jsm`);
XPCOMUtils.defineLazyModuleGetter(this, "studyUtils",
  `resource://${STUDY}/lib/StudyUtils.jsm`);
XPCOMUtils.defineLazyModuleGetter(this, "Feature",
  `resource://${STUDY}/lib/Feature.jsm`);

this.Bootstrap = {

  UI_AVAILABLE_NOTIFICATION: "sessionstore-windows-restored",
  VARIATION_OVERRIDE_PREF:
    "extensions.tracking_protection_messaging_study.variation_override",
  DURATION_OVERRIDE_PREF:
    "extensions.tracking_protection_messaging_study.duration_override",
  EXPIRATION_DATE_STRING_PREF:
    "extensions.tracking_protection_messaging_study.expiration_date_string",
  STUDY_DURATION_WEEKS: 2,

  /**
   * @param addonData Array [ "id", "version", "installPath", "resourceURI", "instanceID", "webExtension" ]  bootstrap.js:48
   * @param reason
   * @returns {Promise<void>}
   */
  async startup(addonData, reason) {
    this.REASONS = studyUtils.REASONS;

    this.initLog();

    this.log.debug("startup", this.REASONS[reason] || reason);

    this.initStudyUtils(addonData.id, addonData.version);

    // choose and set variation
    const variation = await this.selectVariation();
    this.variation = variation;
    this.reason = reason;

    // Check if the user is eligible to run this study using the |isEligible|
    // function when the study is initialized (install or upgrade, the latter
    // being interpreted as a new install).
    if (reason === this.REASONS.ADDON_INSTALL) {
      //  telemetry "enter" ONCE
      studyUtils.firstSeen();
      const eligible = await config.isEligible();
      if (!eligible) {
        this.log.debug("User is ineligible, ending study.");
        // 1. uses config.endings.ineligible.url if any,
        // 2. sends UT for "ineligible"
        // 3. then uninstalls addon
        await studyUtils.endStudy({reason: "ineligible"});
        return;
      }
    }

    /*
    * Adds the study to the active list of telemetry experiments,
    * and sends the "installed" telemetry ping if applicable
    */
    await studyUtils.startup({reason});

    this.initStudyDuration();

    if (this.isStudyExpired()) {
      await studyUtils.endStudy({ reason: "expired" });
    }

    // log what the study variation and other info is.
    this.log.debug(`info ${JSON.stringify(studyUtils.info())}`);

    // make sure the UI is available before adding the feature
    if (!Services.wm.getMostRecentWindow("navigator:browser")) {
      Services.obs.addObserver(this, this.UI_AVAILABLE_NOTIFICATION);
    } else {
      // TODO bdanforth: check if window is private before adding UI
      this.addFeature(this.variation, this.reason);
    }
  },

  /*
  * Create a new instance of the ConsoleAPI, so we can control
  * the maxLogLevel with Config.jsm.
  */
  initLog() {
    XPCOMUtils.defineLazyGetter(this, "log", () => {
      const ConsoleAPI =
        Cu.import("resource://gre/modules/Console.jsm", {}).ConsoleAPI;
      const consoleOptions = {
        maxLogLevel: config.log.bootstrap.level,
        prefix: "TPStudy",
      };
      return new ConsoleAPI(consoleOptions);
    });
  },

  initStudyUtils(id, version) {
    // validate study config
    studyUtils.setup({...config, addon: { id, version }});
    // TODO bdanforth: patch studyUtils to setLoggingLevel as part of setup method
    studyUtils.setLoggingLevel(config.log.studyUtils.level);
  },

  // choose the variation for this particular user, then set it.
  async selectVariation() {
    const variation = this.getVariationFromPref(config.weightedVariations) ||
      await studyUtils.deterministicVariation(config.weightedVariations);
    studyUtils.setVariation(variation);
    this.log.debug(`studyUtils has config and variation.name: ${variation.name}.
      Ready to send telemetry`);
    return variation;
  },

  // helper to let Dev or QA set the variation name
  getVariationFromPref(weightedVariations) {
    const name = Services.prefs.getCharPref(this.VARIATION_OVERRIDE_PREF, "");
    if (name !== "") {
      const variation = weightedVariations.filter(x => x.name === name)[0];
      if (!variation) {
        throw new Error(`about:config => ${this.VARIATION_OVERRIDE_PREF} set to ${name},
          but no variation with that name exists.`);
      }
      return variation;
    }
    return name;
  },

  initStudyDuration() {
    if (!Preferences.has(this.EXPIRATION_DATE_STRING_PREF)) {
      const now = Date.now();
      // ms = weeks * 7 days/week * 24 hours/day * 60 minutes/hour
      // * 60 seconds/minute * 1000 milliseconds/second
      const studyDurationInMs =
        this.getDurationFromPref()
        || (this.STUDY_DURATION_WEEKS * 7 * 24 * 60 * 60 * 1000);
      const expirationDateInt = now + studyDurationInMs;
      Preferences.set(
        this.EXPIRATION_DATE_STRING_PREF,
        new Date(expirationDateInt).toISOString());
    }
  },

  // helper to let Dev or QA set the study duration
  getDurationFromPref() {
    return Services.prefs.getIntPref(this.DURATION_OVERRIDE_PREF, "");
  },

  isStudyExpired() {
    const expirationDateInt =
      Date.parse(Preferences.get(this.EXPIRATION_DATE_STRING_PREF));
    if (Date.now() > expirationDateInt) {
      return true;
    }
    return false;
  },

  // eslint-disable-next-line no-unused-vars
  observe(subject, topic, data) {
    if (topic === this.UI_AVAILABLE_NOTIFICATION) {
      Services.obs.removeObserver(this, this.UI_AVAILABLE_NOTIFICATION);
      this.addFeature(this.variation, this.reason);
    }
  },

  addFeature(variation, reason) {
    // Start up your feature, with specific variation info.
    this.feature = new Feature({
      variation,
      studyUtils,
      reasonName: this.REASONS[reason],
      logLevel: config.log.bootstrap.level,
    });
  },

  /**
   * Shutdown needs to distinguish between USER-DISABLE and other
   * times that `endStudy` is called.
   *
   * studyUtils._isEnding means this is a '2nd shutdown'.
   */
  async shutdown(addonData, reason) {
    this.log.debug("shutdown", this.REASONS[reason] || reason);

    // In the case the UI was available already and the observe method never fired
    try {
      Services.obs.removeObserver(this, this.UI_AVAILABLE_NOTIFICATION);
    } catch (err) {
      // It must already be removed!
    }

    const isUninstall = (reason === this.REASONS.ADDON_UNINSTALL
      || reason === this.REASONS.ADDON_DISABLE);
    if (isUninstall) {
      // Send this before the ShuttingDown event to ensure that message handlers
      // are still registered and receive it.
      // Tells already loaded frame scripts to shutdown
      Services.mm.broadcastAsyncMessage("TrackingStudy:Uninstalling");
    }

    // Tells already loaded frame scripts to shutdown
    Services.mm.broadcastAsyncMessage("TrackingStudy:ShuttingDown");

    if (isUninstall && !studyUtils._isEnding) {
      // we are the first 'uninstall' requestor => must be user action.

      // remove custom pref for study duration and overrides
      Services.prefs.clearUserPref(this.EXPIRATION_DATE_STRING_PREF);
      Services.prefs.clearUserPref(this.DURATION_OVERRIDE_PREF);
      Services.prefs.clearUserPref(this.VARIATION_OVERRIDE_PREF);

      // If clause neccessary since study could end due to user ineligible or study expired, in which case feature is not initialized
      if (this.feature) {
        await this.feature.endStudy("user-disable");
      }
    }

    // normal shutdown, or 2nd uninstall request

    // If clause neccessary since study could end due to user ineligible or study expired, in which case feature is not initialized
    if (this.feature) {
      await this.feature.uninit();
    }

    // Unload addon-specific modules
    Cu.unload(`resource://${STUDY}/lib/Feature.jsm`);
    Cu.unload(`resource://${STUDY}/lib/Config.jsm`);
    Cu.unload(`resource://${STUDY}/lib/StudyUtils.jsm`);
  },

  uninstall() {
  },

  install() {
  },
};

// Expose bootstrap methods on the global
for (const methodName of ["install", "startup", "shutdown", "uninstall"]) {
  this[methodName] = Bootstrap[methodName].bind(Bootstrap);
}
