[![npm (tag)](https://img.shields.io/npm/v/might-cli/latest)](http://npmjs.com/package/might-cli)
![npm](https://img.shields.io/npm/dm/might-cli)

**This project is still new, issues are to be expected.**

## The Problem

End-to-end testing can get very complicated and overwhelming; especially if you want to start testing a huge app, that would take a lot of time and afford, and will be boring and repetitive.

## The Solution

A no-code (almost zero-config) method to perform and manage end-to-end tests, handling most of the mess in the background.

[Might UI](https://github.com/ItsKerolos/Might) is an easy way to create, manage and edit tests, it was designed to make the whole process easier and way faster.

But this, might-cli, is how your run those tests.

## Installation
`
npm install --save-dev might-cli`

## Usage

`npx might`

##### When you run the command for the first time, it will walk you through all the things you need to configure:

[![](./screenshots/1.png)](https://github.com/ItsKerolos/might-cli/raw/master/screenshots/1.png)

1. You will be asked to set a command that starts the development server of your app, it's spawned before testing begins and terminated after the testing is done (optional).
2. The URL of the app (required).

##### Like this:
[![](./screenshots/2.png)](https://github.com/ItsKerolos/might-cli/raw/master/screenshots/2.png)

**More optional configurations** are available in `might.config.json`, which will be created in your project's directory after you finish those 2 prompts.

---

Now you have to create a few tests to run, tests are described inside a file called `might.map.json`, the easiest way to create those tests and that file is to use [might-ui](https://github.com/ItsKerolos/Might), but if you really want to write tests manually read [map.md](https://github.com/ItsKerolos/might-cli/blob/master/map.md) (not recommended).

When you're done, make sure to save the file to `might.map.json` inside the root of your project's directory or might-cli won't be able to see it.

---

Now lets say you did create at least one test.

The first time each individual test is performed, we screenshot its outcome (after all the steps) and save that screenshot inside a folder in your project directory.

[![](./screenshots/3.png)](https://github.com/ItsKerolos/might-cli/raw/master/screenshots/3.png)

When the test is performed for the second time, we again take a screenshot of its outcome, but this time it's compared with the first-run screenshot, if both match then the test is passed, but if they mismatch then the test fails, in that case a diff-image will be created inside the project's directory to show you the difference between both screenshots.

[![](./screenshots/4.png)](https://github.com/ItsKerolos/might-cli/raw/master/screenshots/4.png)

---

run `npx might -h` to see additional information about how to run specific tests and skip the rest, how to update failed tests, how to control the amount of parallel tests, and how to get a coverage report.

#### Notes about code coverage:
while the feature itself is new and probably have few issues, 
we use the coverage data returned by chrome, which have issues with things like JSX, so keep in mind that the coverage reports are never 100% accurate.

the reports themselves will be outputted to `__coverage__`, and can be used with tools like codecov.

---

## What can I test?

- Waiting
- Changing the Viewport
- Going to Different Pages.
- Setting Media Features
- Keypresses
- Hovering
- Clicking
- Dragging Elements
- Swiping the Screen
- Typing


Want a feature that we don't have yet? open a [feature request](https://github.com/ItsKerolos/might-cli/issues/new?template=feature_request.md).

**How does it work?** Puppeteer, because of course it is, but if you're still curious, feel free to have a look at [runner.js](https://github.com/ItsKerolos/might-cli/blob/master/src/runner.js).
