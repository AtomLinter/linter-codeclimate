path = require 'path'
fs = require 'fs-plus'
helpers = require('atom-linter')

describe "linter-codeclimate package", ->
  fixturesPath = ""

  beforeEach ->
    fixturesPath = path.join(__dirname, 'fixtures')

    waitsForPromise ->
      atom.packages.activatePackage("language-ruby")

    waitsForPromise ->
      atom.packages.activatePackage("linter")

    waitsForPromise ->
      atom.packages.activatePackage("linter-codeclimate")

    waitsForPromise ->
      atom.workspace.open(fixturesPath + '/cool_code.rb')

    spyOn(helpers, 'exec')

  describe "with a valid .codeclimate.yml file", ->
    it "runs codeclimate-linter on save", ->
      expect(atom.workspace.getActiveTextEditor().getTitle()).toBe "cool_code.rb"
      expect(atom.workspace.getActiveTextEditor().getGrammar().name).toBe "Ruby"
      runs ->
        atom.commands.dispatch(atom.views.getView(atom.workspace), "core:save")
        cmd = '/usr/local/bin/codeclimate analyze -f json -e fixme -e rubocop \'cool_code.rb\' < /dev/null'
        expect(helpers.exec).toHaveBeenCalledWith("/bin/bash", ["-lc", cmd], {cwd: fixturesPath})
