'use babel';

// eslint-disable-next-line import/extensions, import/no-extraneous-dependencies
import { CompositeDisposable } from 'atom';
import { dirname } from 'path';

const badCommands = new Set();

const startMeasure = (baseName) => {
  const startMark = `${baseName}-start`;
  // Clear start mark from previous execution for the same file
  if (performance.getEntriesByName(startMark).length) {
    performance.clearMarks(startMark);
  }
  performance.mark(startMark);
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

/**
 * Show a clearer error in Atom when the exact problem is known.
 *
 * @param  {Error}    err               The caught error.
 * @param  {String}   cmd               The CodeClimate commmand.
 * @param  {String}   [description='']  A descriptive explanation of the error in
 *                                      Markdown (preserves line feeds).
 * @param  {String}   [extraDetails=''] Additional details to document the error (shown
 *                                      only code and message when available by default)
 *                                      (plain text, does NOT preserve line feeds).
 * @param  {Object[]} [buttons=[]]      Array of buttons to show.
 * @see {@link https://atom.io/docs/api/v1.8.0/NotificationManager#instance-addError|Adding error notifications}
 */
const notifyError = (err, cmd, description = '', extraDetails = '', buttons = []) => {
  let friendlyDesc = '';
  let detail = `Exception details:\n- COMMAND: \`${cmd}\``;
  if (err && err.code) {
    detail += `\n- CODE: ${err.code}`;
    switch (err.code) {
      case 'ENOENT':
        friendlyDesc = 'CodeClimate binary could not be found.'; break;
      case 'EACCES':
      case 'EDIR':
        friendlyDesc = 'Executable path not pointing to a binary.'; break;
      default:
        friendlyDesc = 'CodeClimate execution failed.';
    }
  }
  if (err && err.message) detail += `\n- MESSAGE: ${err.message}`;
  if (extraDetails) detail += `\n${extraDetails}`;
  if (!badCommands.has(cmd)) {
    atom.notifications.addError('linter-codeclimate error', {
      buttons: [{
        className: 'btn-install',
        onDidClick: () => {
          // eslint-disable-next-line import/no-extraneous-dependencies
          require('shell').openExternal('https://github.com/codeclimate/codeclimate');
        },
        text: 'Install guide',
      }].concat(buttons),
      detail,
      description: `${description}\n${friendlyDesc}`.trim(),
      dismissable: true,
      stack: err.stack,
    });
    // Only notify once per path
    badCommands.add(cmd);
  }
};

export default {
  activate() {
    this.subscriptions = new CompositeDisposable();
    this.subscriptions.add(atom.config.observe(
      'linter-codeclimate.executablePath', (value) => {
        this.executablePath = value;
      },
    ));
    this.subscriptions.add(atom.config.observe(
      'linter-codeclimate.init', (value) => {
        this.init = value;
      },
    ));
    this.subscriptions.add(atom.config.observe(
      'linter-codeclimate.disableTimeout', (value) => {
        this.disableTimeout = value;
      },
    ));
  },

  deactivate() {
    this.subscriptions.dispose();
  },

  provideLinter() {
    const Helpers = require('atom-linter');
    const configurationFile = '.codeclimate.yml';
    return {
      name: 'Code Climate',
      grammarScopes: ['*'],
      scope: 'file',
      lint: async (textEditor) => {
        const filePath = textEditor.getPath();
        const fileDir = dirname(filePath);

        // Search for a .codeclimate.yml in the project tree. If one isn't found,
        // use the presence of a .git directory as the assumed project root,
        // and offer to create a .codeclimate.yml file there. If the user doesn't
        // want one, and says no, we won't bug them again.
        const configurationFilePath = await Helpers.findAsync(fileDir, configurationFile);
        if (configurationFilePath === null) {
          const gitPath = await Helpers.findAsync(fileDir, '.git');
          let gitDir;
          if (gitPath !== null) {
            gitDir = dirname(gitPath);
          } else {
            // Fall back to the directory of the current file if a .git repo
            // can't be found.
            gitDir = dirname(filePath);
          }

          if (atom.config.get('linter-codeclimate.init') !== false) {
            const message = 'No .codeclimate.yml file found. Should I ' +
              `initialize one for you in ${gitDir}?`;
            // eslint-disable-next-line no-alert
            const initRepo = confirm(message);
            if (initRepo) {
              try {
                await Helpers.exec(
                  this.executablePath,
                  ['init'],
                  { cwd: gitDir },
                );
                atom.notifications.addSuccess('init complete. Save your code ' +
                  'again to run Code Climate analysis.');
              } catch (e) {
                notifyError(e, `${this.executablePath} init`,
                  `Unable to initialize \`.codeclimate.yml\` file in \`${gitDir}\`.`);
              }
            } else {
              atom.config.set('linter-codeclimate.init', false);
            }
          }
          return [];
        }

        // Construct the command line invocation which runs the Code Climate CLI
        const relpath = atom.project.relativizePath(filePath).pop();
        const execArgs = ['analyze', '-f', 'json', relpath];
        const execOpts = {
          cwd: dirname(configurationFilePath),
          uniqueKey: `linter-codeclimate::${relpath}`,
        };
        if (this.disableTimeout) {
          execOpts.timeout = Infinity;
        }

        // Debug the command executed to run the Code Climate CLI to the console
        if (atom.inDevMode()) {
          // eslint-disable-next-line no-console
          console.log('linter-codeclimate:: Command: ' +
            `\`${this.executablePath} ${execArgs.join(' ')}\``);
        }

        // Start measure for how long the analysis took.
        const measureId = `linter-codeclimate: \`${relpath}\` analysis`;
        startMeasure(measureId);

        // Execute the Code Climate CLI, parse the results, and emit them to the
        // Linter package as warnings. The Linter package handles the styling.
        let result;
        try {
          result = await Helpers.exec(this.executablePath, execArgs, execOpts);
        } catch (e) {
          notifyError(e, `${this.executablePath} ${execArgs.join(' ')}`);
          return null;
        }

        // Handle unique spawning: killed execs will return null
        if (result === null) {
          return null;
        }

        let messages;
        try {
          messages = JSON.parse(result);
        } catch (e) {
          notifyError(e, `${this.executablePath} ${execArgs.join(' ')}`,
            'Invalid JSON returned from CodeClimate. See the Console for details.');
          // eslint-disable-next-line no-console
          console.error('Invalid JSON returned from CodeClimate:', result);
          return [];
        }
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
                colEnd = issue.location.positions.end.column - 1;
              }
              if (colEnd !== undefined && colStart !== colEnd) {
                // Valid end column, and it isn't the same as the start
                range = [[line, colStart], [line, colEnd]];
              } else {
                // No valid end column, let generateRange highlight a word
                range = Helpers.generateRange(textEditor, line, colStart);
              }
            } else {
              // No valid starting column, just treat it as a line number
              range = Helpers.generateRange(textEditor, line);
            }
          } else {
            // Issue only has a line number
            const line = issue.location.lines.begin - 1;
            range = Helpers.generateRange(textEditor, line);
          }

          linterResults.push({
            type: 'Warning',
            text: issue.description,
            filePath,
            range,
          });
        });

        // Log the length of time it took to run analysis
        endMeasure(measureId);
        return linterResults;
      },
    };
  },
};
