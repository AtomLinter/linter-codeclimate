{CompositeDisposable} = require 'atom'
FS = require 'fs'
Path = require 'path'
YAML = require 'js-yaml'

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
      'Ruby': ['rubocop'],
      'JavaScript': ['eslint'],
      'CoffeeScript': ['coffeelint'],
      'Python': ['pep8', 'radon'],
      'PHP': ['phpcodesniffer', 'phpmd']
    }
    provider =
      name: 'Code Climate'
      grammarScopes: ['*'] # Lint everything then filter with map
      scope: 'file'
      lint: (textEditor) =>
        filePath = textEditor.getPath()
        fileDir = Path.dirname(filePath)
        grammarName = textEditor.getGrammar().name
        linterNameArray = linterMap['*']

        if (linterMap.hasOwnProperty(grammarName) == true)
          linterNameArray.push(linter) for linter in linterMap[grammarName] when (linter not in linterNameArray)

        configurationFilePath = Helpers.findFile(fileDir, configurationFile)
        if (!configurationFilePath)
          gitDir = Path.dirname(Helpers.findFile(fileDir, ".git"))
          message = "No .codeclimate.yml file found. Should I initialize one for you in " + gitDir + "?"

          if atom.config.get("codeclimate.linter.init") != false
            initRepo = confirm(message)
            if initRepo
              Helpers.exec("/bin/bash", ["-lc", "codeclimate init"], {cwd: gitDir})
              alert("init complete. Save your code again to run Code Climate analysis.")
            else
              atom.config.set("codeclimate.linter.init", false)
          return []

        configEnabledEngines = getEnabledEngines(configurationFilePath)
        linterEnabledEngines = (linter for linter in linterNameArray when ((linter in configEnabledEngines) == true))

        cmd = ["codeclimate analyze",
               "-f json",
               makeEngineString(linter for linter in linterEnabledEngines when linter),
               "'" + atom.project.relativize(filePath) + "'",
               "< /dev/null"].join(" ")

        console.log cmd

        analysisBeginTime = Date.now()
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

            console.log("Code Climate analysis: " + (Date.now() - analysisBeginTime) + "ms")
            return linterResults
          )
