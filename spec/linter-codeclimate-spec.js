'use babel';

// eslint-disable-next-line no-unused-vars
import { it, fit, wait, beforeEach, afterEach } from 'jasmine-fix';
import { join } from 'path';

const { lint } = require('../lib/index.js').provideLinter();

const fixturesPath = join(__dirname, 'fixtures');
const coolCodePath = join(fixturesPath, 'cool_code.rb');

// Codeclimate can sometimes be quite slow (especially in a CI environment)
jasmine.getEnv().defaultTimeoutInterval = 60 * 1000; // 60 seconds

describe('The codeclimate provider for Linter', () => {
  beforeEach(async () => {
    atom.workspace.destroyActivePaneItem();
    await atom.packages.activatePackage('linter-codeclimate');
  });

  it('works with a valid .codeclimate.yml file', async () => {
    // eslint-disable-next-line no-console
    console.log('Started the spec...');
    const editor = await atom.workspace.open(coolCodePath);
    const messages = await lint(editor);
    // eslint-disable-next-line no-console
    console.log('Messages: ', JSON.stringify(messages, null, ' '));

    expect(messages.length).toBe(1);
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
  });
});
