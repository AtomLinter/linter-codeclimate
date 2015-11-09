{CompositeDisposable} = require 'atom'
Path = require 'path'

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
      'Ruby': 'rubocop',
      'JavaScript': 'eslint',
      'CoffeeScript': 'coffeelint',
    }
    provider =
      name: 'Code Climate'
      grammarScopes: ['*'] # Lint everything then filter with map
      scope: 'file'
      lint: (textEditor) =>
        filePath = textEditor.getPath()
        fileDir = Path.dirname(filePath)
        grammarName = textEditor.getGrammar().name
        linterName = null

        if (linterMap.hasOwnProperty(grammarName) == true)
          linterName = linterMap[grammarName]
        else
          return []

        configurationFilePath = Helpers.findFile(fileDir, configurationFile)
        if (!configurationFilePath)
          fileDir = __dirname

        execPath = Path.dirname(configurationFilePath)
        relativeFilePath = atom.project.relativize(filePath)

        cmd = "codeclimate analyze -f json -e " +
                linterName +
                " '" + relativeFilePath + "'" +
                " < /dev/null"

        return Helpers
          .exec("/bin/bash", ["-c", cmd], {cwd: execPath})
          .then(JSON.parse)
          .then((messages) =>
            linterResults = []
            for issue in messages
              if (issue.location.positions)
                locLineBegin = issue.location.positions.begin.line
                locLineEnd = issue.location.positions.end.line
              else
                locLineBegin = issue.location.lines.begin
                locLineEnd = issue.location.lines.end

              do (issue) ->
                linterResults.push({
                  type: "Warning"
                  text: issue.description
                  filePath
                  range: [[locLineBegin-1,0], [locLineEnd-1,0]]
                })
            return linterResults
          )
