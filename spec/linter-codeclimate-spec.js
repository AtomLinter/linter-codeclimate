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
          const rubocopMessage = messages.find(message => message.excerpt.match(/^RUBOCOP:.*?\[Rubocop\/Lint\/UnusedMethodArgument\]$/));

          expect(rubocopMessage).toBeDefined();

          expect(rubocopMessage.severity).toBe('warning');
          expect(rubocopMessage.excerpt).toBe('RUBOCOP: Unused method argument - ' +
            "`bar`. If it's necessary, use `_` or `_bar` as an argument name to " +
            "indicate that it won't be used. You can also write as `foo(*)` if " +
            "you want the method to accept any arguments but don't care about " +
            'them. [Rubocop/Lint/UnusedMethodArgument]');
          expect(rubocopMessage.description).toBeDefined();
          expect(rubocopMessage.reference).not.toBeDefined();
          expect(rubocopMessage.icon).not.toBeDefined();
          expect(rubocopMessage.solutions).not.toBeDefined();
          expect(rubocopMessage.location.file).toBe(coolCodePath);
          expect(rubocopMessage.location.position).toEqual([[1, 11], [1, 14]]);
        }),
    ));
});
