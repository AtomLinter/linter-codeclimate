## linter-codeclimate: Atom Integration for the Code Climate CLI

[![Issue Count](https://codeclimate.com/github/AtomLinter/linter-codeclimate/badges/issue_count.svg)](https://codeclimate.com/github/AtomLinter/linter-codeclimate)

An Atom package for the [Code Climate command line tool](https://github.com/codeclimate/codeclimate). Uses the awesome [Atom Linter](https://atom.io/packages/linter) infrastructure.

<center><img src="https://raw.githubusercontent.com/AtomLinter/linter-codeclimate/master/atommovie.gif"></center>

## Installation: Code Climate CLI

*Note that these instructions assume that you have Docker and Atom already installed*

To use the Code Climate Atom Package you must have the [Code Climate command line tool](https://github.com/codeclimate/codeclimate) installed.

If you don't already, you can install it like this (assuming Mac OSX with `brew` - Linux instructions can be found in the CLI repo README):

```
brew tap codeclimate/formulae
brew install codeclimate
```

You can test that the installation worked correctly by invoking `codeclimate version` - if a version number is printed - you're ready to roll!

Once you have the CLI installed, you'll want to make sure that the engines you need to analyze your code are installed locally. If the repo you want to analyze already has a `.codeclimate.yml` file, you can run:

```
cd MYPROJECT
codeclimate engines:install
```

And that should take care of it for you. If you'd like to analyze a project which has never been analyzed by Code Climate before, the CLI can take care of that for you as well! Just run:

```
cd MYPROJECT
codeclimate init
codeclimate engines:install
```

The CLI will detect the file extensions of the code in your project and turn on engines which are meant to analyze those languages or frameworks. You're now ready to test the CLI with your code! Just make sure ou are still in the same directory as your project's `.codeclimate.yml` and run:

```
codeclimate analyze
```

And you should see some progress, and most likely, some results. Cool! Now it's time to get it working in your editor.

## Installation: Atom Package

Once you have a functioning installation of the Code Climate CLI, you're ready to see the same results within the comfort of your favorite text editor. Install the `linter` package, the `linter-codeclimate` package, and make sure any of the language modes you prefer are also installed.

Once these are installed, reload your editor (`View` -> `Reload` from the Atom menu), open a file of your choice, and save it. Code Climate analysis will run in the background and then pop up results that you can inspect right inside Atom. Awesome! You're now linting with superpowers.

## Installation: Special Considerations

Note that currently `linter-codeclimate` works only on single file analysis types, not on engines which analyze the entire codebase at once. The following engines currently work with the Atom package (this will soon be all packages - thanks for your patience as we work out some kinks):


* All Languages: fixme
* Python: Radon, Pep8
* Ruby: Rubocop
* CoffeeScript: CoffeeLint
* JavaScript: ESLint
* PHP: PHPCodeSniffer, PHPMD
