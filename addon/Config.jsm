"use strict";

/* to use:

- Recall this file has chrome privileges
- Cu.import in this file will work for any 'general firefox things' (Services,etc)
  but NOT for addon-specific libs
*/

/* eslint no-unused-vars: ["error", { "varsIgnorePattern": "(config|EXPORTED_SYMBOLS)" }]*/
var EXPORTED_SYMBOLS = ["config"];

var config = {
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
    "studyName": "buttonFeatureExperiment",

    async getCampaignId() {
      if (this.variation) {
        return this.variation.campaign_id;
      }
      // TODO bdanforth: handle non-override variation case
    },

    // optional, use to override/decide
    // Disable this for production!
    variation: {
      name: "tp-on-fast",
      campaign_id: "tp-on-fast",
    },

    weightedVariations: [
      // TP OFF, no UI 
      { name: "control", weight: 1 },
      // TP ON, no UI
      { name: "tp-on", weight: 1 },
      // TP ON, UI (doorhanger && new tab), fast messaging
      { name: "tp-on-fast", weight: 1 },
      // TP ON, UI (doorhanger && new tab), private/etc. messaging
      { name: "tp-on-private", weight: 1 },
    ],

    campaigns: {
      "doorhanger": {
        "campaign_ids": [
          "tp-on-fast",
          "tp-on-private",
        ],
        "messages": [
          "Tracking protection is enabled, making Firefox super fast.",
          "Tracking protection is enabled, protecting your privacy.",
        ],
        "newtab_messages": [
          "Firefox blocked ${blockedRequests} trackers today<br/> and saved you ${minutes} minutes",
          "Firefox blocked ${blockedRequests} trackers today<br/> from ${blockedEntities} companies that track your browsing",
          // "Firefox blocked ${blockedRequests} ads today from<br/> ${blockedSites} different websites"
        ],
        "urls": [
          "https://mozilla.org/learn-more-about-tp-study#doorhanger-fast",
          "https://mozilla.org/learn-more-about-tp-study#doorhanger-private",
        ],
      },
      "opentab": {
        "campaign_ids": [
          "tp-on-fast",
          "tp-on-private",
        ],
        "messages": [],
        "newtab_messages": [
          "Firefox blocked ${blockedRequests} trackers today<br/> and saved you ${minutes} minutes",
          "Firefox blocked ${blockedRequests} trackers today<br/> from ${blockedEntities} companies that track your browsing",
          // "Firefox blocked ${blockedRequests} ads today from<br/> ${blockedSites} different websites",
        ],
        "urls": [
          "https://mozilla.org/learn-more-about-tp-study#opentab-fast",
          "https://mozilla.org/learn-more-about-tp-study#opentab-private",
        ],
      },
    },

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
        "baseUrl": "http://www.example.com/?reason=user-disable",
      },
      "ineligible": {
        "baseUrl": "http://www.example.com/?reason=ineligible",
      },
      "expired": {
        "baseUrl": "http://www.example.com/?reason=expired",
      },
      /** User defined endings */
      "used-often": {
        "baseUrl": "http://www.example.com/?reason=used-often",
        "study_state": "ended-positive",  // neutral is default
      },
      "a-non-url-opening-ending": {
        "study_state": "ended-neutral",
        "baseUrl":  null,
      },
      "introduction-leave-study": {
        "study_state": "ended-negative",
        "baseUrl": "http://www.example.com/?reason=introduction-leave-study",
      },
    },
    "telemetry": {
      "send": true, // assumed false. Actually send pings?
      "removeTestingFlag": false,  // Marks pings as testing, set true for actual release
      // TODO "onInvalid": "throw"  // invalid packet for schema?  throw||log
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
    // get whatever prefs, addons, telemetry, anything!
    // Cu.import can see 'firefox things', but not package things.
    return true;
  },

  // Optional: relative to bootstrap.js in the xpi
  "studyUtilsPath": `./StudyUtils.jsm`,
};
