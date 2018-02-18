# This script automates the process of testing your Shield study addon locally
# for a given unit test.
# It takes the state of your addon's working directory in your GitHub repo and
# drops it into your local Firefox development directory. You do not need to
# commit any changes in Git or Hg to perform local testing.

# IMPORTANT: READ BEFORE USING - ASSUMPTIONS MADE FOR THIS SCRIPT TO WORK
# **You have added your shield study ID to the list of DIRS in ./browser/extensions/moz.build in the Hg repo
# **You have a jar.mn and moz.build file inside your ./addon folder in your Git repo
# You are testing against the "release" channel
# You have recently built the "release" branch of Firefox
#   (`hg pull -u release` > [`./mach clobber`] > `./mach build`)
#   in your local Firefox directory
# Your local Firefox directory is located at: $FIREFOX_LOCAL_DIR
#  If not, update the value of that variable in this script.
# The unit test you want to run is located at: $UNIT_TEST_RELATIVE_PATH
#  If not, update the value of that variable in this script.

# **: For more detailed instructions, see:
# https://github.com/biancadanforth/tracking-protection-shield-study/pull/12#issuecomment-356196425

# Note: If you are checking for memory leaks, make sure you are building a "debug" build
# https://developer.mozilla.org/en-US/docs/Mozilla/Developer_guide/Build_Instructions/Configuring_Build_Options

# Step 1: Copying build-includes into dist/${ADDON_NAME}/ for testing in tree
echo "NPM RUN TEST: Copying addon files to a folder in ./dist..."
BASE_DIR="$(dirname "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)")"
ADDON_NAME=$(node -p -e "require('./package.json').name");
mkdir -p dist/$ADDON_NAME
while read -r LINE || [[ -n "${LINE}" ]]; do
  mkdir -p "$(dirname "dist/${ADDON_NAME}/${LINE}")"
  cp -r "${BASE_DIR}/addon/${LINE}" "$(dirname "dist/${ADDON_NAME}/${LINE}")"
done < "${BASE_DIR}/build-includes.txt"

# Step 2: Copies over the folder made in Step 1 into the tree, ./browser/extensions
echo "NPM RUN TEST: Copying that folder into your local copy of Firefox..."
FIREFOX_LOCAL_DIR=$HOME/src/mozilla-unified
FIREFOX_LOCAL_ADDON_DIR=$FIREFOX_LOCAL_DIR/browser/extensions
cp -r dist/"${ADDON_NAME}" "${FIREFOX_LOCAL_ADDON_DIR}"

# Step 3: Change directories in the terminal to location for mozilla-unified
pushd ${FIREFOX_LOCAL_DIR} > /dev/null

# Step 4: Fetch latest changes from branch of interest, e.g. release
echo "NPM RUN TEST: Fetching latest changes for the release branch of Firefox..."
hg pull -u release

# Step 5: Build Firefox with this patch
echo "NPM RUN TEST: Building a local copy of Firefox..."
./mach build faster

# Step 6: Run the test of interest
UNIT_TEST_RELATIVE_PATH="browser/base/content/test/plugins/browser_pluginnotification.js"
echo "NPM RUN TEST: Running the test at ${UNIT_TEST_RELATIVE_PATH}..."
./mach mochitest $UNIT_TEST_RELATIVE_PATH

# Step 7: Change directories back to GitHub repo
echo "NPM RUN TEST: Exiting..."
trap "popd > /dev/null" EXIT
