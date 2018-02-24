'use babel';

// eslint-disable-next-line no-unused-vars
import { it, fit, wait, beforeEach, afterEach } from 'jasmine-fix';
import { join } from 'path';

const fixturesPath = join(__dirname, 'fixtures');
const coolCodePath = join(fixturesPath, 'cool_code.rb');

const { lint } = require('../lib/index.js').provideLinter();

// Codeclimate can sometimes be quite slow (especially in a CI environment)
jasmine.getEnv().defaultTimeoutInterval = 5 * 60 * 1000; // 5 minutes

describe('The codeclimate provider for Linter', () => {
  beforeEach(async () => {
    atom.workspace.destroyActivePaneItem();
    await atom.packages.activatePackage('linter-codeclimate');
  });

  it('works with a valid .codeclimate.yml file', async () => {
    const editor = await atom.workspace.open(coolCodePath);
    const messages = await lint(editor);

    const issueExcerpt = "RUBOCOP: Unused method argument - `bar`. If it's necessary,"
      + " use `_` or `_bar` as an argument name to indicate that it won't be used."
      + ' You can also write as `foo(*)` if you want the method to accept any'
      + " arguments but don't care about them. [Rubocop/Lint/UnusedMethodArgument]";
    const msgIndex = messages.map(msg => msg.excerpt).indexOf(issueExcerpt);
    const msg = messages[msgIndex];
    expect(msg.severity).toBe('warning');
    expect(msg.excerpt).toBe(issueExcerpt);
    expect(msg.description).toBeDefined();
    expect(msg.reference).not.toBeDefined();
    expect(msg.icon).not.toBeDefined();
    expect(msg.solutions).not.toBeDefined();
    expect(msg.location.file).toBe(coolCodePath);
    expect(msg.location.position).toEqual([[1, 11], [1, 14]]);
  });
});
