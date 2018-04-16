'use babel';

/* eslint no-use-before-define:0 */

// eslint-disable-next-line import/extensions, import/no-extraneous-dependencies
import { CompositeDisposable } from 'atom';
import { dirname, join } from 'path';
import * as Helpers from 'atom-linter';

const logHeader = 'linter-codeclimate::';
const linting = {};
const fingerprints = {};
const debounceTimeout = 250;
const notificationDefaults = {
  buttons: [{
    className: 'btn-install',
    onDidClick: () => {
      // eslint-disable-next-line import/no-extraneous-dependencies
      require('shell').openExternal('https://github.com/codeclimate/codeclimate');
    },
    text: 'Install guide',
  }],
  dismissable: true,
};

/**
 * @summary Promisify a delay (timeout).
 * @param   {Integer} ms The time (milliseconds) to delay.
 * @return  {Promise}    Promise that is resolved after `ms` milliseconds.
 */
const delay = async ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * @summary Resets the flags for project at `projectRoot`.
 * @param   {String} projectRoot The absolute path to the project root.
 */
const reset = (projectRoot) => {
  delete fingerprints[projectRoot];
  delete linting[projectRoot];
};

const measure = {
  start(cwd) {
    if (!atom.inDevMode()) return;
    const startMark = `${cwd}-start`;
    // Clear start mark from previous execution for the same file
    if (performance.getEntriesByName(startMark).length) {
      performance.clearMarks(startMark);
    }
    performance.mark(startMark);
  },

  end(cwd) {
    if (!atom.inDevMode()) return;
    const mark = {
      start: `${cwd}-start`,
      end: `${cwd}-end`,
    };
    performance.mark(mark.end);
    performance.measure(cwd, mark.start, mark.end);
    // eslint-disable-next-line no-console
    console.log(
      `${logHeader} Analysis for ${cwd} took:`,
      performance.getEntriesByName(cwd)[0].duration.toFixed(2),
    );
    performance.clearMeasures(cwd);
    performance.clearMarks(mark.start);
    performance.clearMarks(mark.end);
  },
};

/**
 * @summary Show a clearer error in Atom when the exact problem is known.
 * @param   {Error}  err              The caught error.
 * @param   {String} [description=''] A descriptive explanation of the error in
 *                                  Markdown (preserves line feeds).
 * @see     {@link https://atom.io/docs/api/latest/NotificationManager#instance-addError|Adding error notifications}
 */
const notifyError = (err, description = '') => {
  let friendlyDesc = '';
  let detail = 'Exception details:';

  if (err.message) {
    detail += `\n- MESSAGE: ${err.message}`;
  }

  if (err.code) {
    detail += `\n- CODE: ${err.code}`;
    switch (err.code) {
      case 'ENOENT':
        friendlyDesc = 'CodeClimate binary could not be found.';
        break;
      case 'EACCES':
      case 'EDIR':
        friendlyDesc = 'Executable path not pointing to a binary.';
        break;
      default:
        friendlyDesc = 'CodeClimate execution failed.';
    }
  }

  const options = Object.assign(notificationDefaults, {
    description: `${description}\n${friendlyDesc}`.trim(),
    detail,
    stack: err.stack,
  });
  atom.notifications.addError('linter-codeclimate error', options);
};

/**
 * @summary Checks if the reported issue has been reported previously (duplicated).
 * @return  {Boolean} Whether the issue is duplicated (`true`) or not (`false`).
 * @todo    Remove after fixing https://github.com/phpmd/phpmd/issues/467
 */
const reportedPreviously = (projectRoot, fingerprint) => {
  if (!Object.prototype.hasOwnProperty.call(fingerprints, projectRoot)) {
    fingerprints[projectRoot] = new Set();
  }

  if (fingerprints[projectRoot].has(fingerprint)) return true;

  fingerprints[projectRoot].add(fingerprint);
  return false;
};

/**
 * Search for a CodeClimate config file in the project tree. If none found,
 * use the presence of a `.git` directory as the assumed project root.
 *
 * @param  {String}  filePath The absolute path to the file triggering the analysis.
 * @return {Promise}          The absolute path to the project root.
 */
const findProjectRoot = async (filePath) => {
  const fileDir = dirname(filePath);
  const configurationFilePath = await Helpers.findAsync(fileDir, '.codeclimate.yml');

  if (configurationFilePath !== null) {
    return dirname(configurationFilePath);
  }

  // Fall back to dir of current file if a .git repo can't be found.
  const gitPath = await Helpers.findAsync(fileDir, '.git');
  return dirname(gitPath || filePath);
};

/**
 * Returns the range (lines/columns) for a given issue from its location.
 *
 * @param  {TextEditor} textEditor The Atom TextEditor instance.
 * @param  {Object}     location   The location object of the CodeClimate issue.
 * @return {Array[]}               The range: `[[lineNumber, colStart], [lineNumber, colEnd]]`.
 */
const calcRange = (textEditor, location) => {
  // Issue only has a line number
  if (!Object.prototype.hasOwnProperty.call(location, 'positions')) {
    return Helpers.generateRange(textEditor, location.lines.begin - 1);
  }

  const { positions } = location;
  const line = positions.begin.line - 1;

  // Invalid starting column, just treat it as a line number
  if (positions.begin.column === undefined) {
    return Helpers.generateRange(textEditor, line);
  }

  const colStart = (positions.begin.column - 1) || 0;
  const colEnd = (positions.end.column === undefined)
    ? undefined : (positions.end.column - 1);

  // No valid end column, let generateRange highlight a word
  if (colEnd === undefined || colStart === colEnd) {
    return Helpers.generateRange(textEditor, line, colStart);
  }

  // Valid end column, and different from the start one
  return [[line, colStart], [line, colEnd]];
};

/**
 * @summary Fetch the paths of all currently open files on Atom.
 * @return  {Object} Dictionary of open file abspaths ~> textEditor.
 *
 * NOTE Files indexed by abspath to avoid relative filepath collision among different projects.
 */
const fetchOpenFilepaths = () => {
  const openFiles = {};
  atom.workspace.textEditorRegistry.editors.forEach((textEditor) => {
    openFiles[textEditor.getPath()] = textEditor;
  });
  return openFiles;
};

/**
 * @summary Parses the issues reported by CodeClimate CLI to the format AtomLinter expects.
 * @param   {Object}    path    Object with paths for project root and triggering file.
 * @param   {Object}    result  JSON string from the CodeClimate CLI output to parse.
 * @return  {Object[]}          Parsed issues, with following keys per oobject (array item):
 *                              - severity: the issue severity (one of (info|warning|error)).
 *                              - excerpt: summary of the issue.
 *                              - description: explanation of the issue.
 *                              - location: { file, position }.
 */
const parseIssues = (path, result) => {
  let messages;

  try {
    messages = JSON.parse(result);
  } catch (e) {
    notifyError(e, 'Invalid JSON returned from CodeClimate. See the Console for details.');
    // eslint-disable-next-line no-console
    console.error('Invalid JSON returned from CodeClimate:', result);
    return [];
  }

  const open = fetchOpenFilepaths();
  const linterResults = [];
  messages.forEach((issue) => {
    // Exit early if not an issue
    if (issue.type.toLowerCase() !== 'issue') return;

    // Exit early if issued file is not open
    const file = join(path.project, issue.location.path);
    if (!open[file]) return;

    // Exit early if duplicated issue
    if (reportedPreviously(path.project, issue.fingerprint)) return;

    const position = calcRange(open[file], issue.location);
    const mapSeverity = {
      major: 'error',
      minor: 'warning',
    };
    linterResults.push({
      severity: mapSeverity[issue.severity] || 'warning',
      excerpt: `${issue.engine_name.toUpperCase()}: ${issue.description} [${issue.check_name}]`,
      description: (issue.content && issue.content.body) ? issue.content.body : undefined,
      location: { file, position },
    });
  });

  return linterResults;
};

/**
 * @summary Keeps track of open files and cache their project roots.
 * @param   {TextEditor} textEditor TextEditor instance of the file which triggered the analysis.
 * @return  {Promise}               An object with the absolute paths to project/triggering file.
 */
const track = async (textEditor) => {
  const path = { file: textEditor.getPath() };

  // Exit early on `untitled` files (not saved into disk yet)
  if (path.file === undefined) return path;

  // Fetch previously cached paths when available.
  if (ccLinter.openOnTextEditor[path.file]) {
    path.project = ccLinter.openOnTextEditor[path.file].project;
    return path;
  }

  path.project = await findProjectRoot(path.file);
  return path;
};

/**
 * @summary Lints a project.
 * @param   {Object}  path The absolute paths to project/triggering file.
 * @return  {Promise}      An array of issues in the format that AtomLinter expects.
 */
const lintProject = async (path) => {
  // Debug the command executed to run the Code Climate CLI to the console
  if (atom.inDevMode()) {
    // eslint-disable-next-line no-console
    console.log(`${logHeader} Analyzing project @ ${path.project}`);
  }

  // Start measure for how long the analysis took
  measure.start(path.project);

  // Exec cc-cli and handle unique spawning (killed execs will return `null`)
  const result = await ccLinter.runCli(path.project);
  if (result === null) return null;

  const linterResults = parseIssues(path, result);

  // Log the length of time it took to run analysis
  measure.end(path.project);

  reset(path.project);
  return linterResults;
};

/**
 * @summary Debounces the linting to join triggerings from multiple files of same project.
 * @param   {TextEditor} textEditor The TextEditor instance of the triggering file.
 * @return  {Promise}               An array of issues in the format that AtomLinter expects.
 */
const debouncedLint = async (textEditor) => {
  const now = Date.now();
  const path = await track(textEditor);

  // Exit early on `untitled` files (not saved into disk yet)
  if (path.file === undefined) return null;

  if (linting[path.project] === undefined) {
    linting[path.project] = [now];
  } else {
    linting[path.project].push(now);
  }

  await delay(debounceTimeout);
  linting[path.project].shift();

  // More lints for the same project have been requested and delayed.
  if (linting[path.project].length > 0) return null;

  // This is the last requested lint, so analyze!
  return lintProject(path);
};

const ccLinter = {
  openOnTextEditor: {},

  activate() {
    // Idle callback to check version
    this.idleCallbacks = new Set();
    let depsCallbackID;
    const installLinterCodeclimateDeps = () => {
      this.idleCallbacks.delete(depsCallbackID);
      if (!atom.inSpecMode()) {
        require('atom-package-deps').install('linter-codeclimate');
      }
    };
    depsCallbackID = window.requestIdleCallback(installLinterCodeclimateDeps);
    this.idleCallbacks.add(depsCallbackID);

    this.subscriptions = new CompositeDisposable();
    this.subscriptions.add(
      atom.config.observe(
        'linter-codeclimate.executablePath',
        (value) => { this.executablePath = value; },
      ),
      atom.config.observe(
        'linter-codeclimate.disableTimeout',
        (value) => { this.disableTimeout = value; },
      ),
    );
  },

  deactivate() {
    this.idleCallbacks.forEach(callbackID => window.cancelIdleCallback(callbackID));
    this.idleCallbacks.clear();
    this.subscriptions.dispose();
  },

  provideLinter() {
    return {
      name: 'Code Climate',
      grammarScopes: ['*'],
      scope: 'project',
      lintsOnChange: false,
      lint: debouncedLint,
    };
  },

  /**
   * @summary Runs the CodeClimate CLI in a spawned process.
   * @param   {String}        cwd The absolute path to the project root.
   * @return  {Promise|null}      Promise with the output from executing the CLI.
   * @todo    Remove option `ignoreExitCode` after fixing https://github.com/steelbrain/exec/issues/97
   */
  async runCli(cwd) {
    const execArgs = ['analyze', '-f', 'json'];
    const execOpts = {
      cwd,
      uniqueKey: `linter-codeclimate::${cwd}`,
      ignoreExitCode: true,
    };

    if (this.disableTimeout || atom.inSpecMode()) {
      execOpts.timeout = Infinity;
    }

    // Execute the Code Climate CLI, parse the results, and emit them to the
    // Linter package as warnings. The Linter package handles the styling.
    try {
      return await Helpers.exec(ccLinter.executablePath, execArgs, execOpts);
    } catch (e) {
      notifyError(e);
      return null;
    }
  },
};

export default ccLinter;
