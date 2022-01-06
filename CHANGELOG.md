## 4.0.0

- tests now always leave behind a diff image when updated

### Breaking changes
  - `titleBasedScreenshots` is now `true` by default for new configs
  - include titles in error logs and diff images filenames when `titleBasedScreenshots` is `on`

## 3.2.0

### Error logs
  - Errors will generate a `.log` file detailing all the information about an error and the steps Might took until it reached it.
  - The logs already include a lot of details but we'll keep improving and adding to them over time to help you debug issues and find their source faster.
  - Some of the info included in the error logs are all the console messages you called in your web app during the test run.
---
