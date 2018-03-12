# Test plan for this add-on

## Preparations

### Make a clean profile in the right version of Firefox and set some preferences in `about:config`
1. Download an [unbranded Beta](https://wiki.mozilla.org/Add-ons/Extension_Signing#Unbranded_Builds) version of Firefox.
  - What is now Beta (Firefox 59) will be Release when this study is deployed.
  - As of Firefox 57, unsigned legacy addons are [prohibited](https://wiki.mozilla.org/Add-ons/Firefox57) in Release and Beta channels, so that's why we have to use an unbranded build.
  - When you open unbranded Firefox, you will notice the icon is a dark blue globe, not the Firefox logo. The window title will also say "Nightly". This is the unbranded part. You can confirm you have Firefox 59 installed by clicking the hamburger menu in the top right corner, selecting "Help" and then "Troubleshooting Information".
2. Create a new profile at `about:profiles`.
  - Set the profile as your default.
  - Shutdown Beta Firefox and re-launch it for the changes to take effect.
3. Go to `about:config` and set:
  - `xpinstall.signatures.required`: `false`,
    - This allows installing unsigned add-ons. It is only needed if the XPI is not signed.
  - `extensions.legacy.enabled`: `true`
    - This permits the loading of the legacy add-on since new versions of Firefox are allowing pure WebExtensions only.

### Set study-specific preferences and get the latest XPI

1. Set `extensions.tracking_protection_messaging_study.variation_override` to `fast` or `private`. These are the two experimental branches.
  - A list of all treatment branches in this study can be found in the [README](https://github.com/biancadanforth/tracking-protection-shield-study#treatment-branches).
  - A list of all override preferences can be found in the [README](https://github.com/biancadanforth/tracking-protection-shield-study#testing-preferences).
2. Get a copy of the study's XPI. There are three ways to do this:
  1. Go to [this study's tracking bug](https://bugzilla.mozilla.org/show_bug.cgi?id=1433473) and install the latest signed XPI OR
  2. Go to the [Releases](https://github.com/biancadanforth/tracking-protection-shield-study/releases) page of this repo and download the XPI from there. Note: It may be unsigned.
  3. Using the [developer instructions](https://github.com/biancadanforth/tracking-protection-shield-study#development), find a copy of the unsigned XPI in the `./dist` folder.

### Install the add-on and enroll in the study

1. Go to `about:addons`. In the "Extensions" tab, click the Gear icon in the top right corner of the page and select "Install Add-on From File...".
2. Navigate to where the XPI is located on your local machine and open it.
3. Click through the warnings and notifications that the add-on was installed.

## User Flow Overview

See the [User Flow](https://github.com/biancadanforth/tracking-protection-shield-study#user-flow) section of the README.

## Functional Tests to Perform

- If either panel is open when the user changes the window size mode (i.e. the window is maximized, minimized, made full screen or brought to a "normal" size), the panel will be dismissed.
- If the user has an ad blocker installed (one of: Disconnect, uBlock Origin, AdBlock Plus, AdBlock for Firefox or Ghostery) before the study installs, the study will end with reason = `ineligible`. There is no survey. (#162)
- If the user installs one of the ad blockers above during the study, the study ends with reason = `user-installed-ad-blocker`. There is a survey. (#162)
- In the "pseudo-control" treatment for a clean profile, ensure the user does not receive the Tracking Protection onboarding tour (Something like this [page](https://www.mozilla.org/en-US/firefox/59.0/tracking-protection/start/?step=2&newtab=true)) after the study has been installed, #145.
- When the user proactively changes the state of Tracking Protection (e.g. through `about:preferences` or `about:config`), the study ends, and their updated setting for Tracking Protection is not changed.
- If the study runs to completion or the user uninstalls the add-on, the study ends, resetting Tracking Protection to its default value (ON in private windows only); #21 .
- Check for correct surveys given study ending (see #23 ).
  - A complete list of [study endings](https://github.com/biancadanforth/tracking-protection-shield-study#study-endings) can be found in the README. The only study ending that does NOT have a survey is `ineligible`.
  - For each ending, the survey URL should be:
    - <https://qsurvey.mozilla.com/s3/tp-perception?reason=user-disable>
    - <https://qsurvey.mozilla.com/s3/tp-perception?reason=user-disabled-builtin-tracking-protection>
    - <https://qsurvey.mozilla.com/s3/tp-perception?reason=page-action-confirmation-leave-study>
    - <https://qsurvey.mozilla.com/s3/tp-perception?reason=user-enabled-builtin-tracking-protection>
    - <https://qsurvey.mozilla.com/s3/tp-perception?reason=expired>
    - <https://qsurvey.mozilla.com/s3/tp-perception?reason=introduction-confirmation-leave-study>
- Check the study expiration end study condition and survey. See the [Debug](https://github.com/biancadanforth/tracking-protection-shield-study/blob/master/TESTPLAN.md#debug) section of this document for how to override the study duration and verify correct behavior.
- Check that you don't see the pageAction unless on a http(s) page.
- Check that you don't see the new tab variation/content until at least one resource is blocked during the session (blocked resources -- or a proxy of time saved for the "fast" branch -- are shown on the pageAction icon).
- Check that you don't see the intro panel after addon install until the first time you visit a page and it has blocked resources (could visit biancadanforth.com to check this).
- Check that the intro panel is dismissed by:
  - a tab change
  - a window close
  - a location change in the same tab
  - the user interacting with it
  - the window the intro panel is currently in losing focus
- Check that the intro panel is NOT dismissed by:
  - the user clicking off of it
- Check that the pageAction panel is triggered by:
  - Clicking on the pageAction button, when the intro panel is NOT open.
- Check that the pageAction panel is dismissed by:
  - Clicking off the pageAction panel
- Check that eligibility criteria are correctly met otherwise study ends #35  .
- If the first site you visit after install has 0 blocked resources, clicking on the pageAction button will show the intro panel, see #110 .
- Check that there is no UI/prompting in Private Browsing mode, see #86 . Note that Tracking Protection will still be enabled, so if a non-private window is open, the session totals on `about:newtab` in the non-private will still increase for pages in Private Browsing.

1. Npm run firefox
2. Open a new private window
3. Notice the modified `about:privatebrowsing` page in the new tab (no toggle or tour button for Tracking Protection).
4. Visit `npr.org` in private window
5. Notice there is no pageAction badge
6. Visit `about:home` or `about:newtab`
7. Notice there is no new tab variation content
8. With the private window still open, open a new tab in the non-private window
9. Notice the new tab variation is there and includes totals from the private window.
10. In the non-private window, visit npr.org.
11. Notice that the intro panel shows, since this is the first site you have visited in a non-private window since the study has been installed.
- Check that the values in the pageAction panel are per-page (the first number should match the badge number of the pageAction). The values in this page should always be equal to or less than the values in the new tab variation, which are totals per session.
- Verify that telemetry pings are correct per [TELEMETRY.md](./TELEMETRY.md).
  - In particular, verify that for any of the [study endings](https://github.com/biancadanforth/tracking-protection-shield-study#study-endings) listed in the README, a summary ping is sent before the addon uninstalls.

### How do I know if "telemetry pings are correct"?

See the [Debug](https://github.com/biancadanforth/tracking-protection-shield-study/blob/master/TESTPLAN.md#debug) section of this document for an example of the correct telemetry for a common user flow.

## Debug

### How to view log output

* Open the Browser Console using Firefox's top menu at `Tools > Web Developer > Browser Console` (or CMD/CTRL + Shift + J). This will display Shield (loading/telemetry) log output from the add-on.

### How to view telemetry pings

_Before installing the study XPI_, install the Shield Study Helper Add-on available on the [Releases](https://github.com/biancadanforth/tracking-protection-shield-study/releases) page of this repo, @qa-shield-study-helper-1.0.0.xpi ([source code](https://github.com/mozilla/shield-studies-addon-utils/tree/master/shield-study-helper-addon)).

Once both add-ons are installed, click the browserAction icon for the Shield Study Helper (it's a black shield with the letters "QA" written over it). Search through the timestamps for the correct date and time and observe the pings that have been sent:

### Example telemetry pings after successfully installing the add-on:

```
1 2018-03-03T23:10:40.340Z shield-study
{
  "study_state": "enter"
}

2 2018-03-03T23:10:40.344Z shield-study
{
  "study_state": "installed"
}
```

### Example telemetry pings for a common user flow, ending with "expired"

*Setup*
* BEFORE installing the study:
  - First install the Shield Study Helper Add-on as described [above](https://github.com/biancadanforth/tracking-protection-shield-study/blob/master/TESTPLAN.md#how-to-view-telemetry-pings).
  - Set the study treatment override string preference, `extensions.tracking_protection_messaging_study.variation_override` to `private`.
  - Set the study expiration override integer preference, `extensions.tracking_protection_messaging_study.duration_override` to `10000` (10 seconds).
* Install the addon per the [instructions](https://github.com/biancadanforth/tracking-protection-shield-study/blob/master/TESTPLAN.md#preparations) in this document.

*Flow*
Important: This assumes you start with a clean profile.
1. Navigate to "npr.org".
2. Notice the intro panel.
3. On the intro panel, click "Disable Protection".
4. On the confirmation screen, click "Cancel".
5. With the intro panel still open, open a new tab in the same window.
6. Notice the intro panel gets dismissed.
7. On the new tab page, notice the message "Firefox has blocked X trackers and Y advertisements." Note the values of X and Y.
8. Switch back to the original tab with "npr.org"
9. Notice the badge on the pageAction button. Its value should match X from the new tab page.
9. Click the pageAction button.
10. Notice the pageAction panel. The values on the pageAction panel should match X and Y from the new tab page.
11. Click off of the pageAction panel.
12. Notice the panel gets dismissed.
13. Leaving the "npr.org" tab opened, close the new tab page tab.
14. Wait for about 30 seconds, just to make sure the study does indeed expire.
15. Close out of Unbranded Beta Firefox completely.
16. Re-launch Unbranded Beta Firefox.
17. Notice a survey opens in a new tab. The survey tab should not be focused.
18. Go to `about:addons`.
19. Notice the study is gone, but the Shield Study Helper Add-on is still around.
20. Click the Shield Study Helper Add-on browserAction on the top right corner of the browser window (black shield with "QA" written on it).
21. If you started with a clean profile, you should see the telemetry pings sent by the study from the first session and the current session.
22. Verify the pings match the pings below:
  - Note: The addon version and dates/times may differ.

```
Ran at: Sat Mar 03 2018 17:03:25 GMT-0800 (PST)

// common fields
branch private
study_name addon-tracking-protection-messaging-1433473-all-users  // or addon-tracking-protection-messaging-1433473-new-users
addon_version 1.0.1
version 3

0 2018-03-04T01:00:25.202Z shield-study
{
  "study_state": "enter"
}

1 2018-03-04T01:00:25.206Z shield-study
{
  "study_state": "installed"
}

2 2018-03-04T01:00:33.632Z shield-study-addon
{
  "attributes": {
    "message_type": "event",
    "event": "panel-shown",
    "panel_type": "intro-panel"
  }
}

3 2018-03-04T01:00:37.416Z shield-study-addon
{
  "attributes": {
    "message_type": "event",
    "event": "ui-event",
    "ui_event": "introduction-reject"
  }
}

4 2018-03-04T01:00:41.176Z shield-study-addon
{
  "attributes": {
    "message_type": "event",
    "event": "ui-event",
    "ui_event": "introduction-confirmation-cancel"
  }
}

5 2018-03-04T01:00:45.714Z shield-study-addon
{
  "attributes": {
    "message_type": "event",
    "event": "panel-hidden",
    "panel_type": "intro-panel",
    "showTime": "12"
  }
}

6 2018-03-04T01:00:45.722Z shield-study-addon
{
  "attributes": {
    "message_type": "event",
    "event": "panel-dismissed",
    "panel_type": "introduction-panel",
    "reason": "tab-change"
  }
}

7 2018-03-04T01:01:13.790Z shield-study-addon
{
  "attributes": {
    "message_type": "event",
    "event": "page-action-click",
    "counter": "37",
    "is_intro": "false",
    "treatment": "private"
  }
}

8 2018-03-04T01:01:13.992Z shield-study-addon
{
  "attributes": {
    "message_type": "event",
    "event": "panel-shown",
    "panel_type": "page-action-panel"
  }
}

9 2018-03-04T01:01:19.076Z shield-study-addon
{
  "attributes": {
    "message_type": "event",
    "event": "panel-hidden",
    "panel_type": "page-action-panel",
    "showTime": "5"
  }
}

10 2018-03-04T01:01:19.080Z shield-study-addon
{
  "attributes": {
    "message_type": "event",
    "event": "panel-dismissed",
    "panel_type": "page-action-panel",
    "reason": "user-clicked-off-panel"
  }
}

11 2018-03-04T01:01:26.066Z shield-study-addon
{
  "attributes": {
    "message_type": "event",
    "event": "new-tab-closed",
    "newTabOpenTime": "40"
  }
}

12 2018-03-04T01:02:17.330Z shield-study
{
  "study_state": "expired"
}

13 2018-03-04T01:02:17.334Z shield-study
{
  "study_state": "exit"
}

14 2018-03-04T01:02:17.598Z shield-study-addon
{
  "attributes": {
    "message_type": "behavior_summary",
    "reject": "false",
    "intro_accept": "false",
    "intro_reject": "false",
    "badge_clicks": "1",
    "panel_open_times": "[12,5]",
    "panel_open_times_median": "8.5",
    "panel_open_times_mean": "8.5",
    "new_tab_open_times": "[40]",
    "new_tab_open_times_median": "40",
    "new_tab_open_times_mean": "40",
    "page_action_counter": "[37]",
    "page_action_counter_median": "37",
    "page_action_counter_mean": "37",
    "covariates_profile_age": "0",
    "covariates_dnt_enabled": "false",
    "covariates_history_enabled": "true",
    "covariates_app_update_enabled": "true",
  }
}

```
