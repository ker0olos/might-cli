[![npm (tag)](https://img.shields.io/npm/v/might-cli/latest)](http://npmjs.com/package/might-cli)

End-to-end testing can get very complicated and overwhelming; especially if you need to start testing huge apps, that would take a lot of time and afford, and will be boring and repetitive.


<br>

### Breaking Changes (Updating to v2)
**Before updating please rename all your screenshots from [*test*].png to [*test*].chromium.png**
or delete all of them and update your config to use firefox/webkit solely.

> Might now uses [Playwright](https://github.com/microsoft/playwright) to allow testing using all 3 major browsers.

New configs generated by v2 will include all 3 browsers by default.

Might (or more accurately playwright) requires more system dependencies to run all the 3 browsers, [use this](#running-might-in-cI) to run tests correctly inside a CI.

Since I don't care that much about maintenance, there won't be any patches released to v1 (update to v2 to get any future bug fixes).

- Setting "prefers-reduced-motion" is no longer supported.
- Your coverage reports will look a bit different *(and will take a LOT longer to generate when there's a LOT of tests to compute)*.
- We removed some other small functions, but that shouldn't affect anything.

<br>

### The Solution

A no-code method to perform and manage end-to-end tests, handling all of the mess in the background.

[Might UI](https://github.com/ker0olos/Might) is an easy way to create, manage and edit tests, and [Might CLI](https://github.com/ker0olos/might-cli) runs those tests.

### Installation
`
npm install --save-dev might-cli`

### Usage

`npx might`

When you run the command for the first time, it will walk you through all the things you need to configure:

[![](./screenshots/1.png)](https://github.com/ker0olos/might-cli/raw/main/screenshots/1.png)

[![](./screenshots/2.png)](https://github.com/ker0olos/might-cli/raw/main/screenshots/2.png)

1. You will be asked to set a command that starts the development server of your app, it's spawned before testing begins and terminated after the testing is done (optional).
2. The URL of the app (required).


> **More optional configurations** are available in `might.config.json`, which will be automatically generated after you finish those prompts.

---

Now you have to create a few tests to run, tests are described inside a file called `might.map.json`, the easiest way to create tests is with the help of [Might UI](https://github.com/ker0olos/Might).

Run `npx might -m` to open the UI regardless of it's installed or not;

> If you really want to write tests manually (not recommended) look at
> [map.md](https://github.com/ker0olos/might-cli/blob/main/map.md).

##### *Might UI In Action:*
[![](https://github.com/ker0olos/Might/raw/main/screenshots/1.png)](https://github.com/ker0olos/Might/raw/main/screenshots/1.png)

---

Now that you have at least one test in `might.map.json`.

[![](./screenshots/3.png)](https://github.com/ker0olos/might-cli/raw/main/screenshots/3.png)

[![](./screenshots/4.png)](https://github.com/ker0olos/might-cli/raw/main/screenshots/4.png)

The first time each individual test is performed, its outcome (after all the steps) is screenshotted and saved inside a folder in your project directory.

When the test is performed for a second time, a new screenshot is compared with the first screenshot, if both match the test passes, but if they mismatch the test fails and an error diff-image will be created to show the difference between both screenshots).

---

run `npx might -h` to see additional information about how to run specific tests and skip the rest, how to update failed tests, how to control the amount of parallel tests, and how to get a coverage report.

### Running Might in CI

Please use this [Docker image](https://hub.docker.com/_/microsoft-playwright) or this [GitHub Action](https://github.com/microsoft/playwright-github-action).

And here's an [example of a project](https://github.com/ker0olos/example) using Might with Github Actions.

#### What can I test?

- Waiting
- Changing the Viewport
- Going to Different Pages
- Setting Media Features
- Keypresses
- Hovering
- Clicking
- Dragging Elements
- Swiping the Screen
- Typing


[Want a feature that we don't have yet?](https://github.com/ker0olos/might-cli/issues/new?template=feature_request.md)

Any feature requests related to the UI should be requested [there](https://github.com/ker0olos/Might/issues/new?template=feature_request.md).
