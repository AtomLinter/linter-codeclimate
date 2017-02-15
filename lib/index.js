'use babel';

// eslint-disable-next-line import/extensions, import/no-extraneous-dependencies
import { CompositeDisposable } from 'atom';
import FS from 'fs';
import { dirname } from 'path';
import YAML from 'js-yaml';

const makeEngineString = engineNames => (
  engineNames.map(language => (`-e ${language}`))
).join(' ');

const getEnabledEngines = (configFilePath) => {
  const configYaml = YAML.safeLoad(FS.readFileSync(configFilePath, 'utf8'));
  const result = new Set();
  Object.keys(configYaml.engines).forEach((engineKey) => {
    const engine = configYaml.engines[engineKey];
    if (engine.enabled === true) {
      result.add(engineKey);
    }
  });
  return result;
};

const badPaths = new Set();

const startMeasure = (baseName) => {
  performance.mark(`${baseName}-start`);
};

const endMeasure = (baseName) => {
  if (atom.inDevMode()) {
    performance.mark(`${baseName}-end`);
    performance.measure(baseName, `${baseName}-start`, `${baseName}-end`);
    // eslint-disable-next-line no-console
    console.log(`${baseName} took: `, performance.getEntriesByName(baseName)[0].duration);
    performance.clearMarks(`${baseName}-end`);
    performance.clearMeasures(baseName);
  }
  performance.clearMarks(`${baseName}-start`);
};

export default {
  activate() {
    this.subscriptions = new CompositeDisposable();
    this.subscriptions.add(atom.config.observe(
      'linter-codeclimate.executablePath', (value) => {
        this.executablePath = value;
      },
    ));
  },

  deactivate() {
    this.subscriptions.dispose();
  },

  provideLinter() {
    const Helpers = require('atom-linter');
    const configurationFile = '.codeclimate.yml';
    const linterMap = {
      '*': ['fixme'],
      Ruby: ['rubocop', 'reek'],
      'Ruby on Rails': ['rubocop', 'reek'],
      'Ruby on Rails (RJS)': ['rubocop', 'reek'],
      JavaScript: ['eslint'],
      CoffeeScript: ['coffeelint'],
      'CoffeeScript (Literate)': ['coffeelint'],
      Python: ['pep8', 'radon'],
      PHP: ['phpcodesniffer', 'phpmd'],
      Go: ['gofmt', 'golint', 'govet'],
      'GitHub Markdown': ['markdownlint'],
    };
    return {
      name: 'Code Climate',
      grammarScopes: ['*'],
      scope: 'file',
      lint: async (textEditor) => {
        // Make sure executable path exists
        if (!FS.existsSync(this.executablePath)) {
          if (!badPaths.has(this.executablePath)) {
            const msg = 'codeclimate binary not found! Installation ' +
            'instructions at http://github.com/codeclimate/codeclimate';
            atom.notifications.addError(msg);
            // Only notify once per path
            badPaths.add(this.executablePath);
          }
          return [];
        }

        const filePath = textEditor.getPath();
        const fileDir = dirname(filePath);
        const grammarName = textEditor.getGrammar().name;
        const linterNames = new Set();
        // Add the generic 'fixme' linter
        linterNames.add(linterMap['*'][0]);

        // Search for a .codeclimate.yml in the project tree. If one isn't found,
        // use the presence of a .git directory as the assumed project root,
        // and offer to create a .codeclimate.yml file there. If the user doesn't
        // want one, and says no, we won't bug them again.
        const configurationFilePath = await Helpers.findAsync(fileDir, configurationFile);
        if (configurationFilePath === null) {
          const gitDir = dirname(await Helpers.findAsync(fileDir, '.git'));

          if (atom.config.get('linter-codeclimate.init') !== false) {
            const message = 'No .codeclimate.yml file found. Should I ' +
              `initialize one for you in ${gitDir}?`;
            // eslint-disable-next-line no-alert
            const initRepo = confirm(message);
            if (initRepo) {
              try {
                await Helpers.exec(
                  '/bin/bash',
                  [`-lc '${this.executablePath} init'`],
                  { cwd: gitDir },
                );
                atom.notifications.addSuccess('init complete. Save your code ' +
                  'again to run Code Climate analysis.');
              } catch (error) {
                atom.notifications.addError('Unable to initialize ' +
                  `.codeclimate.yml file in ${gitDir}`);
              }
            } else {
              atom.config.set('linter-codeclimate.init', false);
            }
          }
          return [];
        }

        // Construct the list of linters to be passed to the CLI by looking at
        // the linters made available for our language grammar by the LinterMap,
        // and whether or not the engines are enabled in a user's config file.
        if (Object.prototype.hasOwnProperty.call(linterMap, grammarName) === true) {
          // for (const linter of linterMap[grammarName]) {
          linterMap[grammarName].forEach((linter) => {
            linterNames.add(linter);
          });
        }
        const configEnabledEngines = getEnabledEngines(configurationFilePath);
        const linterEnabledEngines = Array.from(linterNames).filter(
          linterName => configEnabledEngines.has(linterName));

        // Construct the command line invocation which runs the Code Climate CLI
        const cmd = [this.executablePath, 'analyze',
          '-f json',
          makeEngineString(linterEnabledEngines),
          `'${atom.project.relativize(filePath)}'`,
          '< /dev/null'].join(' ');

        // Debug the command executed to run the Code Climate CLI to the console
        if (atom.inDevMode()) {
          // eslint-disable-next-line no-console
          console.log(`linter-codeclimate:: Command: \`${cmd}\``);
        }

        // Start measure for how long the analysis took.
        startMeasure('linter-codeclimate: Analysis');

        // Execute the Code Climate CLI, parse the results, and emit them to the
        // Linter package as warnings. The Linter package handles the styling.
        const execArgs = ['-lc', cmd];
        const execOpts = {
          cwd: dirname(configurationFilePath),
        };
        const result = await Helpers.exec('/bin/bash', execArgs, execOpts);
        const messages = JSON.parse(result);
        const linterResults = [];
        let range;
        Object.keys(messages).forEach((issueKey) => {
          const issue = messages[issueKey];
          if (Object.prototype.hasOwnProperty.call(issue.location, 'positions')) {
            const line = issue.location.positions.begin.line - 1;
            let colStart;
            let colEnd;
            if (issue.location.positions.begin.column !== undefined) {
              colStart = (issue.location.positions.begin.column - 1) || 0;
              if (issue.location.positions.end.column !== undefined) {
                // Valid end column, attempt to generate full range
                colEnd = issue.location.positions.begin.column - 1;
              }
              if (colEnd !== undefined && colStart !== colEnd) {
                // Valid end column, and it isn't the same as the start
                range = [[line, colStart], [line, colEnd]];
              } else {
                // No valid end column, let rangeFromLineNumber highlight a word
                range = Helpers.rangeFromLineNumber(textEditor, line, colStart);
              }
            } else {
              // No valid starting column, just treat it as a line number
              range = Helpers.rangeFromLineNumber(textEditor, line);
            }
          } else {
            // Issue only has a line number
            const line = issue.location.lines.begin - 1;
            range = Helpers.rangeFromLineNumber(textEditor, line);
          }

          linterResults.push({
            type: 'Warning',
            text: issue.description,
            filePath,
            range,
          });
        });

        // Log the length of time it took to run analysis
        endMeasure('linter-codeclimate: Analysis');
        return linterResults;
      },
    };
  },
};
