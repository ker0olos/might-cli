### Breaking Changes

<br>

> Might now uses [Playwright](https://github.com/microsoft/playwright) to allow testing using all 3 major browsers.

**Before updating please rename all your screenshots from [*test*].png to [*test*].chromium.png**

New configs generated by v2 will include all 3 browsers by default.

Might (or more accurately playwright) requires more system dependencies to run all the 3 browsers, [use this](#running-might-in-cI) to run tests correctly inside a CI.

Since I don't care that much about maintenance, there won't be any patches released to v1 (update to v2 to get any future bug fixes).

- Setting "prefers-reduced-motion" is no longer supported.
- Your coverage reports will look a bit different *(and will take a LOT longer to generate when there's a LOT of tests to compute)*.
- We removed some other small functions, but that shouldn't affect anything.
