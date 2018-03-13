# This script automates part the process of testing your Shield study add-on
# on the Try server:
#   - It takes the state of your addon's working directory in your GitHub repo and
# drops it into your local Firefox development directory.
#   - You do not need to commit any changes in Git, but to submit the patch
# for testing in-tree, you do have to commit the patch (and modify some Firefox
# config files) manually in the mozilla-unified mono repo in Mercurial.

# **: For more detailed instructions, see:
# https://github.com/biancadanforth/tracking-protection-shield-study/pull/12#issuecomment-364610061

# IMPORTANT: READ BEFORE USING - ASSUMPTIONS MADE FOR THIS SCRIPT TO WORK
# **You have a jar.mn and moz.build file inside your ./addon folder in your Git repo
# Your local Firefox directory is located at: $FIREFOX_LOCAL_DIR
#  If not, update the value of that variable in this script.

# This script could be improved by:
#   - (EASY) Before copying over the files, switching to the Firefox Hg directory and
#   `hg pull release`, `hg up release` to fetch the latest changes and bring
#   the Release branch to the tip of the mono repo.
#   - (MODERATE) Somehow building the `jar.mn` and `moz.build` files from the add-on's
#   `install.rdf` and placing them in the `./addon` folder in the Git repo dir.
#   - (MODERATE) Somehow auto-editing the CANDIDATE_TREES object in
#   `./python/mozbuild/mozbuild/artifacts.py` to add `releases/mozilla-release`
#    and the DIRS object in `./browser/extension/moz.build` to add
#    <add-onID> in the Hg mozilla-unified mono repo.
# If all 3 of these tasks could also be automated, then the commit and push to the
# try server could be automated easily so that all the dev has to do is run the script
# and simply input the try server syntax for what tests they want to run.

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

echo "NPM RUN TEST: Script finished. Switch over to your local Firefox hg repo, commit, build, run and finally push to try."
echo "For detailed instructions on how to do this, see https://github.com/biancadanforth/tracking-protection-shield-study/pull/12#issuecomment-364610061"
