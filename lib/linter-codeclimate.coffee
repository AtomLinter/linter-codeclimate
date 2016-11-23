{CompositeDisposable} = require 'atom'
FS = require 'fs'
Path = require 'path'
YAML = require 'js-yaml'
EX = require('child_process').execSync

makeEngineString = (engineNames) ->
  (("-e " + language) for language in engineNames).join(" ")

getEnabledEngines = (configFilePath) ->
  configYaml = YAML.safeLoad(FS.readFileSync(configFilePath, "utf8"))
  (engine for engine, attrs of configYaml["engines"] when attrs["enabled"] == true)

getPosEnd = (posEnd, posBeg) ->
  if posBeg == posEnd
    return posBeg + 2
  else
    posEnd || 120

module.exports =
  config:
    executablePath:
      type: 'string'
      default: '/usr/local/bin/codeclimate'

  activate: ->
    @subscriptions = new CompositeDisposable
    @subscriptions.add atom.config.observe 'linter-codeclimate.executablePath',
      (executablePath) =>
        @executablePath = executablePath

  deactivate: ->
    @subscriptions.dispose()

  provideLinter: ->
    Helpers = require('atom-linter')
    configurationFile = '.codeclimate.yml'
    linterMap = {
      '*': ['fixme'],
      'Ruby': ['rubocop', 'reek'],
      'Ruby on Rails': ['rubocop', 'reek'],
      'Ruby on Rails (RJS)': ['rubocop', 'reek'],
      'JavaScript': ['eslint'],
      'CoffeeScript': ['coffeelint'],
      'CoffeeScript (Literate)': ['coffeelint'],
      'Python': ['pep8', 'radon'],
      'PHP': ['phpcodesniffer', 'phpmd'],
      'Go': ['gofmt', 'golint', 'govet'],
      'GitHub Markdown': ['markdownlint']
    }
    provider =
      name: 'Code Climate'
      grammarScopes: ['*']
      scope: 'file'
      lint: (textEditor) =>
        filePath = textEditor.getPath()
        fileDir = Path.dirname(filePath)
        grammarName = textEditor.getGrammar().name
        linterNameArray = []
        linterNameArray.push(linter) for linter in linterMap['*']

        # Make sure executable path exists and reconcile it if it doesn't
        if !FS.existsSync(@executablePath)
          try
            @executablePath = EX("/bin/bash -lc 'which codeclimate'").toString().trim()
            atom.config.set("linter-codeclimate.executablePath", @executablePath)
          catch error
            atom.notifications.addError("codeclimate binary not found! Installation instructions at http://github.com/codeclimate/codeclimate")
            return []

        # Search for a .codeclimate.yml in the project tree. If one isn't found,
        # use the presence of a .git directory as the assumed project root,
        # and offer to create a .codeclimate.yml file there. If the user doesn't
        # want one, and says no, we won't bug them again.
        configurationFilePath = Helpers.find(fileDir, configurationFile)
        if (!configurationFilePath)
          gitDir = Path.dirname(Helpers.find(fileDir, ".git"))

          if atom.config.get("linter-codeclimate.init") != false
            message = "No .codeclimate.yml file found. Should I initialize one for you in " + gitDir + "?"
            initRepo = confirm(message)
            if initRepo
              try
                EX("/bin/bash -lc '" + @executablePath + " init'", {cwd: gitDir})
                atom.notifications.addSuccess("init complete. Save your code again to run Code Climate analysis.")
              catch error
                atom.notifications.addError("Unable to initialize .codeclimate.yml file in " + gitDir)
            else
              atom.config.set("linter-codeclimate.init", false)
          return []

        # Construct the list of linters to be passed to the CLI by looking at
        # the linters made available for our language grammar by the LinterMap,
        # and whether or not the engines are enabled in a user's config file.
        if (linterMap.hasOwnProperty(grammarName) == true)
          linterNameArray.push(linter) for linter in linterMap[grammarName] when (linter not in linterNameArray)
        configEnabledEngines = getEnabledEngines(configurationFilePath)
        linterEnabledEngines = (linter for linter in linterNameArray when ((linter in configEnabledEngines) == true))

        # Construct the command line invocation which runs the Code Climate CLI
        cmd = [@executablePath, "analyze",
               "-f json",
               makeEngineString(linter for linter in linterEnabledEngines when linter),
               "'" + atom.project.relativize(filePath) + "'",
               "< /dev/null"].join(" ")

        # Debug the command executed to run the Code Climate CLI to the console
        console.log cmd

        # Record time for the purposes of displaying total analysis run time
        analysisBeginTime = Date.now()

        # Execute the Code Climate CLI, parse the results, and emit them to the
        # Linter package as warnings. The Linter package handles the styling.
        return Helpers
          .exec("/bin/bash", ["-lc", cmd], {cwd: Path.dirname(configurationFilePath)})
          .then(JSON.parse)
          .then((messages) =>
            linterResults = []
            for issue in messages
              if (issue.location.positions)
                locLine = issue.location.positions.begin.line - 1
                locPosBeg = (issue.location.positions.begin.column - 1) || 0
                locPosEnd = getPosEnd(issue.location.positions.end.column, issue.location.positions.begin.column)
              else
                locLine = issue.location.lines.begin - 1
                locPosBeg = 0
                locPosEnd = 120

              do (issue) ->
                linterResults.push({
                  type: "Warning"
                  text: issue.description
                  filePath: filePath
                  range: [[locLine,locPosBeg], [locLine,locPosEnd]]
                })

            # Log the length of time it took to run analysis
            console.log("Code Climate analysis: " + (Date.now() - analysisBeginTime) + "ms")
            return linterResults
          )
