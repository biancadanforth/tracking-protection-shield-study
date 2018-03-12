"use strict";

/* All Mozilla specific rules and enviroments at:
 * http://firefox-source-docs.mozilla.org/tools/lint/linters/eslint-plugin-mozilla.html
 */

module.exports = {
  "parserOptions": {
    "ecmaVersion": 8,
    "sourceType": "module",
    "ecmaFeatures": {
      "jsx": false,
      "experimentalObjectRestSpread": true
    }
  },
  env: {
    "es6": true

  },
  extends: [
    "eslint:recommended",
    "plugin:jsdoc/recommended",
    /* list of rules at:
     * https://dxr.mozilla.org/mozilla-central/source/tools/lint/eslint/eslint-plugin-mozilla/lib/configs/recommended.js
     */
    "plugin:mozilla/recommended",
  ],

  plugins: [
    "jsdoc",
    "json",
    "mozilla"
  ],

  rules: {
    "babel/new-cap": "off",
    "jsdoc/require-returns-description": "off",
    "mozilla/balanced-listeners": "error",
    "mozilla/no-aArgs": "warn",
    "mozilla/use-chromeutils-import": "off", // TODO: "warn"?

    "comma-dangle": ["error", "always-multiline"],
    "eqeqeq": "error",
    "indent": ["warn", 2, {SwitchCase: 1}],
    "no-console": "warn",
    "no-shadow": "error",
    "no-unused-vars": "error",
    "no-var": "error",
    "no-warning-comments": ["warn", {"terms": ["todo", "fixme", "needs_doc", "xxx", "tbd"], "location": "anywhere"}],
    "prefer-const": "warn",
    "prefer-spread": "error",
    "semi": ["error", "always"],
    "valid-jsdoc": "error",
  },
};
