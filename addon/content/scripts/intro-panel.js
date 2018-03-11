"use strict";

let introPanel;

/* global sendMessageToChrome */

/* eslint no-unused-vars: ["error", { "varsIgnorePattern": "(onChromeListening|updateTPNumbers|onShutdown)" }]*/

function onChromeListening(copy) {
  introPanel = new IntroPanel(copy);
}

class IntroPanel {
  constructor(copy) {
    this.copy = JSON.parse(copy);
    this.OS = this.copy.OS;

    if (document.readyState === "complete") {
      this.handleLoad();
    } else {
      this.handleLoadRef = this.handleLoad.bind(this);
      document.addEventListener("load", this.handleLoadRef);
    }
  }

  handleLoad() {
    this.introPanel = document.getElementById("tracking-protection-study-intro-panel-box");
    this.introPanelHeading = document.getElementById("tracking-protection-study-heading");
    this.introPanelMessage = document.getElementById("tracking-protection-study-intro-message");
    this.primaryButton = document.getElementById("tracking-protection-study-primary-button");
    this.secondaryButton = document.getElementById("tracking-protection-study-secondary-button");
    if (this.OS === "Linux") {
      this.secondaryButton.classList.add("linux-os");
    }
    this.confirmationPanel = document.getElementById("tracking-protection-study-confirmation-panel-box");
    this.confirmationCancelButton = document.getElementById("tracking-protection-study-confirmation-default-button");
    this.confirmationDisableButton = document.getElementById("tracking-protection-study-confirmation-secondary-button");
    this.addCustomContent();
    this.resizeBrowser(this.introPanel);
    this.addClickListeners();
  }

  resizeBrowser(panel) {
    const dimensions = this.getPanelDimensions(panel);
    // Since resizeBrowser is called from both intro-panel.js and page-action-panel.js, I want to let
    // Feature.jsm know that this resize request is coming from the intro panel.
    if (this.OS === "Windows") {
      dimensions.isIntroPanel = true;
    }
    sendMessageToChrome(
      "browser-resize",
      JSON.stringify(dimensions)
    );
  }

  // get width and height of panel after it's loaded
  getPanelDimensions(panel) {
    // get the DOMRect object of panel element, not JSON-able
    const dimensions = panel.getBoundingClientRect();
    return { width: dimensions.width, height: dimensions.height };
  }

  addCustomContent() {
    this.introPanelHeading.textContent = this.copy.introHeader;
    this.introPanelMessage.textContent = this.copy.introMessage;
  }

  addClickListeners() {
    this.handleButtonClickRef = this.handleButtonClick.bind(this);
    this.primaryButton.addEventListener("click", this.handleButtonClickRef);
    this.secondaryButton.addEventListener("click", this.handleButtonClickRef);
    this.confirmationCancelButton.addEventListener("click", this.handleButtonClickRef);
    this.confirmationDisableButton.addEventListener("click", this.handleButtonClickRef);
  }

  handleButtonClick(evt) {
    let event;
    switch (evt.target.id) {
      case "tracking-protection-study-primary-button":
        event = "introduction-accept";
        break;
      case "tracking-protection-study-secondary-button":
        event = "introduction-reject";
        this.confirmationPanel.classList.remove("hidden");
        this.introPanel.classList.add("hidden");
        this.resizeBrowser(this.confirmationPanel);
        break;
      case "tracking-protection-study-confirmation-default-button":
        event = "introduction-confirmation-cancel";
        this.confirmationPanel.classList.add("hidden");
        this.introPanel.classList.remove("hidden");
        this.resizeBrowser(this.introPanel);
        break;
      case "tracking-protection-study-confirmation-secondary-button":
        event = "introduction-confirmation-leave-study";
        break;
      default:
        throw new Error("Unrecognized UI element: ", evt.target);
    }
    sendMessageToChrome(event);
  }

  onShutdown() {
    document.removeEventListener("load", this.handleLoadRef);
    this.removeClickListeners();
  }

  removeClickListeners() {
    this.primaryButton.removeEventListener("click", this.handleButtonClickRef);
    this.secondaryButton.removeEventListener("click", this.handleButtonClick);
    this.confirmationCancelButton.removeEventListener("click", this.handleButtonClick);
    this.confirmationDisableButton.removeEventListener("click", this.handleButtonClick);
  }
}

/**
 * Dummy function to prevent error messages, since the same <browser>
 * is used for the intro panel and pageAction panel page.
 * Only the pageAction has content (TPNumbers) that needs to be updated
 */
// eslint-disable-next-line no-unused-vars
function updateTPNumbers(state) {

}

function onShutdown() {
  introPanel.onShutdown();
}
