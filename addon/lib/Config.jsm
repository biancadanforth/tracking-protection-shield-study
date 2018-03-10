"use strict";

/* eslint no-unused-vars: ["error", { "varsIgnorePattern": "(config|EXPORTED_SYMBOLS)" }]*/

/**
 * To use:
 * - Recall this file has chrome privileges
 * - Cu.import in this file will work for any 'general firefox things' (Services,etc)
 *   but NOT for addon-specific libs
 */

const { utils: Cu } = Components;
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "Services",
  "resource://gre/modules/Services.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "AddonManager",
  "resource://gre/modules/AddonManager.jsm");

/* eslint no-unused-vars: ["error", { "varsIgnorePattern": "(config|EXPORTED_SYMBOLS)" }]*/
const EXPORTED_SYMBOLS = ["config"];
const SURVEY_URL = "https://qsurvey.mozilla.com/s3/tp-perception";

const config = {
  PREF_TP_ENABLED_GLOBALLY: "privacy.trackingprotection.enabled",
  PREF_TP_ENABLED_IN_PRIVATE_WINDOWS: "privacy.trackingprotection.pbmode.enabled",
  PREF_ALWAYS_PRIVATE_BROWSING: "browser.privatebrowsing.autostart",

  // required STUDY key
  "study": {
    /** Required for studyUtils.setup():
      *
      * - studyName
      * - endings:
      *   - map of endingName: configuration
      * - telemetry
      *   - boolean send
      *   - boolean removeTestingFlag
      *
      * All other keys are optional.
      */

    // required keys: studyName, endings, telemetry

    // will be used activeExperiments tagging
    "studyName": "trackingProtectionMessagingExperiment",

    /** **endings**
      * - keys indicate the 'endStudy' even that opens these.
      * - urls should be static (data) or external, because they have to
      *   survive uninstall
      * - If there is no key for an endStudy reason, no url will open.
      * - usually surveys, orientations, explanations
      */
    "endings": {
      /** standard endings */
      "user-disable": {
        "baseUrl": `${SURVEY_URL}?reason=user-disable`,
      },
      "ineligible": {
        "baseUrl": null,
      },
      "expired": {
        "baseUrl": `${SURVEY_URL}?reason=expired`,
      },
      "user-installed-ad-blocker": {
        "baseUrl": `${SURVEY_URL}?reason=user-installed-ad-blocker`,
      },
      "user-enabled-auto-private-browsing": {
        "baseUrl": `${SURVEY_URL}?reason=user-enabled-auto-private-browsing`,
      },
      /** User defined endings */
      "user-disabled-builtin-tracking-protection": {
        "baseUrl": `${SURVEY_URL}?reason=user-disabled-builtin-tracking-protection`,
        "study_state": "ended-negative",  // neutral is default
      },
      "user-enabled-builtin-tracking-protection": {
        "baseUrl": `${SURVEY_URL}?reason=user-enabled-builtin-tracking-protection`,
        "study_state": "ended-positive",
      },
      "introduction-confirmation-leave-study": {
        "baseUrl": `${SURVEY_URL}?reason=introduction-confirmation-leave-study`,
        "study_state": "ended-negative",
      },
      "page-action-confirmation-leave-study": {
        "baseUrl": `${SURVEY_URL}?reason=page-action-confirmation-leave-study`,
        "study_state": "ended-negative",
      },
    },
    "telemetry": {
      "send": true, // assumed false. Actually send pings?
      "removeTestingFlag": true,  // Marks pings as testing, set true for actual release
    },
  },

  // required LOG key
  "log": {
    // Fatal: 70, Error: 60, Warn: 50, Info: 40, Config: 30, Debug: 20, Trace: 10, All: -1,
    "bootstrap": {
      // Console.jsm uses "debug", whereas Log.jsm uses "Debug", *sigh*
      "level": "debug",
    },
    "studyUtils":  {
      "level": "Trace",
    },
  },

  // OPTION KEYS

  // a place to put an 'isEligible' function
  // Will run only during first install attempt
  "isEligible": async function() {
    const isAlwaysPrivateBrowsing = Services.prefs.getBoolPref(this.PREF_ALWAYS_PRIVATE_BROWSING);
    if (isAlwaysPrivateBrowsing) {
      return false;
    }

    // Does the user have any of the top ad blockers installed?
    const ADBLOCKER_ID_LIST = [
      "{d10d0bf8-f5b5-c8b4-a8b2-2b9879e08c5d}", // AdblockPlus
      "uBlock0@raymondhill.net", // uBlock Origin
      "jid1-NIfFY2CA8fy1tg@jetpack", // Adblock for Firefox
      "2.0@disconnect.me", // Disconnect
      "firefox@ghostery.com", // Ghostery
    ];
    let containsAddon = false;
    const addons = await AddonManager.getAllAddons();
    for (const addon of addons) {
      if (ADBLOCKER_ID_LIST.includes(addon.id)) {
        containsAddon = true;
        continue;
      }
    }
    if (containsAddon) {
      return false;
    }

    const isGloballyEnabled = Services.prefs.getBoolPref(this.PREF_TP_ENABLED_GLOBALLY);
    const isPBModeOnly = Services.prefs.getBoolPref(this.PREF_TP_ENABLED_IN_PRIVATE_WINDOWS);
    // Has user enabled TP globally?
    if (isGloballyEnabled) {
      return false;
    // Has user disabled TP globally?
    } else if (!isPBModeOnly) {
      return false;
    }
    return true;
  },

  /* Study branches and sample weights */
  "weightedVariations": [
    // Built-in TP ON in Private Windows only, no study UI
    {"name": "control",
      "weight": 1},
    // Built-in TP ON globally, no study UI
    {"name": "pseudo-control",
      "weight": 1},
    // Built-in TP OFF globally, re-implemented ON globally in study, study UI shows "fast" messaging
    {"name": "fast",
      "weight": 1},
    // Built-in TP OFF globally, re-implemented ON globally in study, study UI shows "private etc." messaging
    {"name": "private",
      "weight": 1},
  ],


  // Optional: relative to bootstrap.js in the xpi
  "studyUtilsPath": `./StudyUtils.jsm`,
};
