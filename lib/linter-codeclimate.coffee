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
      'Ruby': 'rubocop'
    }
    provider =
      grammarScopes: ['*'] # Lint everything then filter with map
      lintOnFly: true
      scope: 'file'
      statusIconScope: 'file'
      lint: (textEditor) =>
        filePath = textEditor.getPath()
        fileDir = Path.dirname(filePath)
        grammarName = textEditor.getGrammar().name
        linterName = null

        if (linterMap.hasOwnProperty(grammarName) == true)
          linterName = linterMap[grammarName]
        else
          return [] # The grammar is unknown to us, ignore

        configurationFilePath = Helpers.findFile(fileDir, configurationFile)
        if (!configurationFilePath)
          fileDir = __dirname

        execPath = Path.dirname(configurationFilePath)
        relativeFilePath = atom.project.relativize(filePath)

        return Helpers.exec(@executablePath, ['analyze', '-e', linterName, '-f', 'json', relativeFilePath], {cwd: execPath})
          .then((messages) =>
            console.log(messages)
            return []
          )
