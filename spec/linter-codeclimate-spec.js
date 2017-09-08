'use babel';

import { join } from 'path';

const fixturesPath = join(__dirname, 'fixtures');
const coolCodePath = join(fixturesPath, 'cool_code.rb');
const TIMEOUT = process.env.CI ? 60000 : 10000;

describe('The codeclimate provider for Linter', () => {
  const { lint } = require('../lib/index.js').provideLinter();

  beforeEach(() => {
    atom.workspace.destroyActivePaneItem();

    waitsForPromise(() =>
      Promise.all([
        atom.packages.activatePackage('linter-codeclimate'),
      ]));
  });

  it('works with a valid .codeclimate.yml file', () =>
    waitsForPromise(
      { timeout: TIMEOUT },
      () =>
        atom.workspace.open(coolCodePath).then(editor => lint(editor)).then((messages) => {
          expect(messages[0].severity).toBe('warning');
          expect(messages[0].excerpt).toBe('RUBOCOP: Unused method argument - ' +
            "`bar`. If it's necessary, use `_` or `_bar` as an argument name to " +
            "indicate that it won't be used. You can also write as `foo(*)` if " +
            "you want the method to accept any arguments but don't care about " +
            'them. [Rubocop/Lint/UnusedMethodArgument]');
          expect(messages[0].description).toBeDefined();
          expect(messages[0].reference).not.toBeDefined();
          expect(messages[0].icon).not.toBeDefined();
          expect(messages[0].solutions).not.toBeDefined();
          expect(messages[0].location.file).toBe(coolCodePath);
          expect(messages[0].location.position).toEqual([[1, 11], [1, 14]]);
        }),
    ));
});
