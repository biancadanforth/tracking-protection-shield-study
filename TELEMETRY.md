# Telemetry sent by Addon

PLEASE SEE THE JSON SCHEMA FOR DETAILED DESCRIPTION OF THE ADDON-SPECIFIC PING PAYLOAD: [https://github.com/biancadanforth/tracking-protection-shield-study/tree/master/schemas/schema.json](https://github.com/biancadanforth/tracking-protection-shield-study/tree/master/schemas/schema.json)

## Usual Firefox Telemetry is unaffected.

- No change: `main` and other pings are UNAFFECTED by this addon.
- Respects telemetry preferences.  If user has disabled telemetry, no telemetry will be sent.


## `shield-study` pings (common to all shield-studies)

`shield-studies-addon-utils` sends the usual packets.

The STUDY SPECIFIC ENDINGS this study supports are:

- "user-enabled-auto-private-browsing"
- "user-disabled-builtin-tracking-protection"
- "user-enabled-builtin-tracking-protection"
- "introduction-confirmation-leave-study"
- "page-action-confirmation-leave-study"
- "user-installed-ad-blocker"


## `shield-study-addon` pings, specific to THIS study.

Events instrumented in this study:

-Rreported UI events:
    - "panel-shown"
    - "panel-hidden"
    - "panel-dismissed"

- Reported user interactions:
    - "page-action-clicked"
    - "new-tab-closed"
    - "introduction-accept"
    - "introduction-reject"
    - "introduction-confirmation-cancel"
    - "introduction-confirmation-leave-study"
    - "page-action-reject"
    - "page-action-confirmation-cancel"
    - "page-action-confirmation-leave-study"

- Behavior Summary Stats
    - panel opening time lengths + its median + its mean
    - new tab opening time lengths + its median + its mean
    - page action counters when page action button is clicked + its median + its mean
    - number of overall page action badge clicks

- Reported covariate attributes
    - is dnt enabled?
    - is auto update enabled?
    - is web history enabled?
    - have any of the three most popular adblockers?
    - user profile age in days


## Example sequence for a user rejecting tracking protection via the introductory panel

These are the `payload` fields from all pings in the `shield-study` and `shield-study-addon` buckets.

```

// common fields

branch        private
study_name    addon-tracking-protection-messaging-1433473-all-users
addon_version 1.0.1
version       3

0 2018-03-09T20:41:36.676Z shield-study
{
  "study_state": "enter"
}


1 2018-03-09T20:41:36.681Z shield-study
{
  "study_state": "installed"
}


2 2018-03-09T20:42:57.638Z shield-study-addon
{
  "attributes": {
    "message_type": "event",
    "event": "panel-shown",
    "panel_type": "intro-panel"
  }
}


3 2018-03-09T20:43:03.857Z shield-study-addon
{
  "attributes": {
    "message_type": "event",
    "event": "ui-event",
    "ui_event": "introduction-reject"
  }
}


4 2018-03-09T20:43:05.689Z shield-study-addon
{
  "attributes": {
    "message_type": "event",
    "event": "panel-hidden",
    "panel_type": "intro-panel",
    "show_time": "8"
  }
}


5 2018-03-09T20:43:05.692Z shield-study-addon
{
  "attributes": {
    "message_type": "event",
    "event": "panel-dismissed",
    "panel_type": "introduction-panel",
    "reason": "introduction-confirmation-leave-study"
  }
}


6 2018-03-09T20:43:05.694Z shield-study-addon
{
  "attributes": {
    "message_type": "event",
    "event": "ui-event",
    "ui_event": "introduction-confirmation-leave-study"
  }
}


7 2018-03-09T20:43:05.764Z shield-study
{
  "study_state": "ended-neutral",
  "study_state_fullname": "introduction-confirmation-leave-study"
}


8 2018-03-09T20:43:05.765Z shield-study
{
  "study_state": "exit"
}


9 2018-03-09T20:43:05.819Z shield-study-addon
{
  "attributes": {
    "message_type": "behavior-summary",
    "reject": "false",
    "intro_accept": "false",
    "intro_reject": "false",
    "badge_clicks": "0",
    "panel_open_times": "[8]",
    "panel_open_times_median": "8",
    "panel_open_times_mean": "8",
    "new_tab_open_times": "[]",
    "new_tab_open_times_median": "0",
    "new_tab_open_times_mean": "0",
    "page_action_counter": "[]",
    "page_action_counter_median": "0",
    "page_action_counter_mean": "0",
    "covariates_profile_age": "0",
    "covariates_dnt_enabled": "false",
    "covariates_history_enabled": "true",
    "covariates_app_update_enabled": "false",
  }
}
```

## Example sequence for a user accepting tracking protection via the introductory panel and later clicking on the page action button to disable it

```

// common fields

branch        private
study_name    addon-tracking-protection-messaging-1433473-all-users
addon_version 1.0.1
version       3

0 2018-03-09T21:05:00.169Z shield-study
{
  "study_state": "enter"
}


1 2018-03-09T21:05:00.174Z shield-study
{
  "study_state": "installed"
}


2 2018-03-09T21:05:23.979Z shield-study-addon
{
  "attributes": {
    "message_type": "event",
    "event": "panel-shown",
    "panel_type": "intro-panel"
  }
}


3 2018-03-09T21:05:27.291Z shield-study-addon
{
  "attributes": {
    "message_type": "event",
    "event": "panel-hidden",
    "panel_type": "intro-panel",
    "show_time": "3"
  }
}


4 2018-03-09T21:05:27.294Z shield-study-addon
{
  "attributes": {
    "message_type": "event",
    "event": "panel-dismissed",
    "panel_type": "introduction-panel",
    "reason": "introduction-accept"
  }
}


5 2018-03-09T21:05:34.807Z shield-study-addon
{
  "attributes": {
    "message_type": "event",
    "event": "page-action-clicked",
    "counter": "21",
    "is_intro": "false",
    "treatment": "private"
  }
}


6 2018-03-09T21:05:35.001Z shield-study-addon
{
  "attributes": {
    "message_type": "event",
    "event": "panel-shown",
    "panel_type": "page-action-panel"
  }
}


7 2018-03-09T21:05:36.250Z shield-study-addon
{
  "attributes": {
    "message_type": "event",
    "event": "ui-event",
    "ui_event": "page-action-reject"
  }
}


8 2018-03-09T21:05:37.125Z shield-study-addon
{
  "attributes": {
    "message_type": "event",
    "event": "panel-hidden",
    "panel_type": "page-action-panel",
    "show_time": "2"
  }
}


9 2018-03-09T21:05:37.128Z shield-study-addon
{
  "attributes": {
    "message_type": "event",
    "event": "panel-dismissed",
    "panel_type": "page-action-panel",
    "reason": "page-action-confirmation-leave-study"
  }
}


10 2018-03-09T21:05:37.129Z shield-study-addon
{
  "attributes": {
    "message_type": "event",
    "event": "ui-event",
    "ui_event": "page-action-confirmation-leave-study"
  }
}


11 2018-03-09T21:05:37.188Z shield-study
{
  "study_state": "ended-neutral",
  "study_state_fullname": "page-action-confirmation-leave-study"
}


12 2018-03-09T21:05:37.189Z shield-study
{
  "study_state": "exit"
}


13 2018-03-09T21:05:37.233Z shield-study-addon
{
  "attributes": {
    "message_type": "behavior-summary",
    "reject": "false",
    "intro_accept": "false",
    "intro_reject": "false",
    "badge_clicks": "1",
    "panel_open_times": "[3,2]",
    "panel_open_times_median": "2.5",
    "panel_open_times_mean": "2.5",
    "new_tab_open_times": "[]",
    "new_tab_open_times_median": "0",
    "new_tab_open_times_mean": "0",
    "page_action_counter": "[21]",
    "page_action_counter_median": "21",
    "page_action_counter_mean": "21",
    "covariates_profile_age": "0",
    "covariates_dnt_enabled": "false",
    "covariates_history_enabled": "true",
    "covariates_app_update_enabled": "false",
  }
}
```

