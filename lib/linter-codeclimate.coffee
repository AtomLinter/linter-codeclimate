{CompositeDisposable} = require 'atom'
FS = require 'fs'
Path = require 'path'
YAML = require 'js-yaml'

makeEngineString = (engineNames) ->
  (("-e " + language) for language in engineNames).join(" ")

getEnabledEngines = (configFilePath) ->
  configYaml = YAML.safeLoad(FS.readFileSync(configFilePath, "utf8"))
  (engine for engine, attrs of configYaml["engines"] when attrs["enabled"] == true)

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
          linterNameArray.push(linter) for linter in linterMap[grammarName]

        configurationFilePath = Helpers.findFile(fileDir, configurationFile)
        if (!configurationFilePath)
          # Throw error
          return []

        configEnabledEngines = getEnabledEngines(configurationFilePath)
        linterEnabledEngines = (linter for linter in linterNameArray when (linter in configEnabledEngines))

        cmd = ["codeclimate analyze",
               "-f json",
               makeEngineString(linterEnabledEngines),
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
                locLineBegin = issue.location.positions.begin.line
                locLineEnd = issue.location.positions.end.line
                locPosBegin = issue.location.positions.begin.column || 0
                locPosEnd = 80
              else
                locLineBegin = issue.location.lines.begin
                locLineEnd = issue.location.lines.end
                locPosBegin = 0
                locPosEnd = 80

              do (issue) ->
                linterResults.push({
                  type: "Warning"
                  text: issue.description
                  filePath: filePath
                  range: [[locLineBegin-1,locPosBegin], [locLineEnd-1,locPosEnd]]
                })
            console.log("Code Climate analysis: " + (Date.now() - analysisBeginTime) + "ms")
            return linterResults
          )
