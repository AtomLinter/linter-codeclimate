{CompositeDisposable} = require 'atom'
Path = require 'path'

makeEngineString = (engineNames) ->
  (("-e " + language) for language in engineNames).join(" ")

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
        linterNameArray = [makeEngineString(linterMap['*'])]

        if (linterMap.hasOwnProperty(grammarName) == true)
          linterNameArray.push(makeEngineString(linterMap[grammarName]))

        linterNames = linterNameArray.join(" ")

        configurationFilePath = Helpers.findFile(fileDir, configurationFile)
        if (!configurationFilePath)
          fileDir = __dirname

        execPath = Path.dirname(configurationFilePath)
        relativeFilePath = "'" + atom.project.relativize(filePath) + "'"

        cmd = ["codeclimate analyze",
               "-f json",
               linterNames,
               relativeFilePath,
               "< /dev/null"].join(" ")

        console.log cmd

        analysisBeginTime = Date.now()
        return Helpers
          .exec("/bin/bash", ["-lc", cmd], {cwd: execPath})
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
