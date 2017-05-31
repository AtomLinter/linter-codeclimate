# Changelog

## v0.2.5

* Allow only one concurrent analysis per file (#64)
* Fix end column of issue range (#67)
* Run all configured CC engines (#67)

## v0.2.4

* Allow disabling execution timeout (#61)

## v0.2.3

* Check for a non-existent .git directory (#56)
* Dependency updates (#52 and #53)

## v0.2.2

* Rewrite in ES2017 (#48)
* Update `atom-linter` dependency (#50)
* Report invalid JSON from `codeclimate` (#51)

## v0.2.1

* Fix a bug in library usage from a bad upgrade

## v0.2.0

* Library updates
* Added `reek` support to Ruby languages
* Added `markdownlint` to GitHub Markdown

_..._

## 0.0.5 - We got bubbles!
* Changed "CodeClimate" -> "Code Climate" in provider name
* Changed linter provider 'scope' to 'file'
* Clarified codeclimate CLI invocation, guarding against filenames with spaces
* Emit filepath properly
