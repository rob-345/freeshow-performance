# FreeShow performance build

This branch carries the Scripture Fix 2 performance changes on FreeShow 1.6.0. It includes exact title priority, lyric words in any order, Akan keyboard matching with e for ɛ and o for ɔ, faster fuzzy title comparisons, cached scripture content readers, and the text sizing readiness fix for scripture projection.

## Download a Mac application

Open this repository's Actions tab and select a successful **Performance macOS build** run for the **scripture-fix-2** branch. Download the artifact for your Mac, extract the artifact, then extract the application ZIP.

- Apple silicon Macs use **arm64**.
- Intel Macs use **x64**.

The personal Mac build uses ad hoc signing. Apple developer signing and notarization require your own developer credentials. macOS may require approval through **System Settings > Privacy & Security** when you first open a trusted downloaded build.

## Run from source on a Mac

Install Node.js 22, Python 3.11 with setuptools, and Apple's command line tools. Then run these commands in Terminal.

```sh
git clone --branch scripture-fix-2 https://github.com/rob-345/freeshow-performance.git
cd freeshow-performance
git remote add upstream https://github.com/ChurchApps/FreeShow.git
git config url."https://github.com/".insteadOf ssh://git@github.com/
git config --add url."https://github.com/".insteadOf git@github.com:
npm ci
npm run test:performance
npm start
```

To create a Mac application ZIP locally, use `npm run build:mac -- --arm64` for Apple silicon or `npm run build:mac -- --x64` for Intel. The ZIP is written to `dist/`.

FreeShow's native media dependencies are installed for the machine running the build. Copy your Bible files, shows, media, and templates to the Mac through FreeShow's normal data export and import facilities.

## Validation

The regression suite checks search ranking, Akan keyboard input, spelling distance, scripture content, sizing readiness, cancellation, and transition delays. Builds run on both Mac architectures in GitHub Actions. A service rehearsal on the target Mac should include a short verse, a long passage, rapid verse changes, and your usual video background and output template.

The output capture preview remains on the work list. This branch contains the completed search and scripture performance changes.
