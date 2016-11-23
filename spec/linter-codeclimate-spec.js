'use babel';

import { join } from 'path';

const helpers = require('atom-linter');

const fixturesPath = join(__dirname, 'fixtures');
const coolCodePath = join(fixturesPath, 'cool_code.rb');

describe('linter-codeclimate package', () => {
  beforeEach(() => {
    waitsForPromise(() =>
      Promise.all([
        atom.packages.activatePackage('language-ruby'),
        atom.packages.activatePackage('linter'),
        atom.packages.activatePackage('linter-codeclimate'),
      ]).then(() =>
        atom.workspace.open(coolCodePath),
      ),
    );
    spyOn(helpers, 'exec');
  });

  describe('with a valid .codeclimate.yml file', () =>
    it('runs codeclimate-linter on save', () => {
      const cmd = "/usr/local/bin/codeclimate analyze -f json -e fixme -e rubocop 'cool_code.rb' < /dev/null";
      expect(atom.workspace.getActiveTextEditor().getTitle()).toBe('cool_code.rb');
      expect(atom.workspace.getActiveTextEditor().getGrammar().name).toBe('Ruby');
      runs(() => {
        atom.commands.dispatch(atom.views.getView(atom.workspace), 'core:save');
        expect(helpers.exec).toHaveBeenCalledWith('/bin/bash', ['-lc', cmd], { cwd: fixturesPath });
      });
    }),
  );
});
