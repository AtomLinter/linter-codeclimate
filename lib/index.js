'use babel';

// eslint-disable-next-line import/extensions, import/no-extraneous-dependencies
import { CompositeDisposable } from 'atom';
import { dirname, join } from 'path';
import * as Helpers from 'atom-linter';

const devLog = (msg) => {
  if (!atom.inDevMode()) return;
  // eslint-disable-next-line no-console
  console.log(`linter-codeclimate:: ${msg}`);
};

/**
 * @summary Promisify a delay (timeout).
 * @param   {Integer} ms The time (milliseconds) to delay.
 * @return  {Promise}    Promise that is resolved after `ms` milliseconds.
 */
const delay = async ms => new Promise(resolve => setTimeout(resolve, ms));

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
    devLog(`Analysis for ${cwd} took: ${performance.getEntriesByName(cwd)[0].duration.toFixed(2)}`);
    /*
    // eslint-disable-next-line no-console
    console.log(
      `${logHeader} Analysis for ${cwd} took:`,
      performance.getEntriesByName(cwd)[0].duration.toFixed(2),
    );
    */
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

  const binErrorDefaults = {
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
  let defaults = {};
  if (err.code) {
    detail += `\n- CODE: ${err.code}`;
    switch (err.code) {
      case 'ENOENT':
        friendlyDesc = 'CodeClimate binary could not be found.';
        defaults = binErrorDefaults;
        break;
      case 'EACCES':
      case 'EDIR':
        friendlyDesc = 'Executable path not pointing to a binary.';
        defaults = binErrorDefaults;
        break;
      default:
        friendlyDesc = 'CodeClimate execution failed.';
    }
  }

  const options = Object.assign(defaults, {
    description: `${description}\n${friendlyDesc}`.trim(),
    detail,
    stack: err.stack,
  });
  atom.notifications.addError('linter-codeclimate error', options);
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
 * @summary Estimates the range for a non-open file.
 * @param   {Object}  location The location object of the CodeClimate issue.
 * @return  {Array[]}          The range: `[[lineNumber, colStart], [lineNumber, colEnd]]`.
 */
const estimateRange = (location) => {
  if (Object.prototype.hasOwnProperty.call(location, 'lines')) {
    return [
      [location.lines.begin - 1, 0],
      [location.lines.end - 1, 0],
    ];
  }

  if (Object.prototype.hasOwnProperty.call(location, 'positions')) {
    const { begin, end } = location.positions;
    return [
      [begin.line - 1, begin.column - 1],
      [end.line - 1, end.column - 1],
    ];
  }

  return [[0, 0], [0, 0]];
};

/**
 * @summary Returns the range (lines/columns) for a given issue from its location.
 * @param   {TextEditor} textEditor The Atom TextEditor instance.
 * @param   {Object}     location   The location object of the CodeClimate issue.
 * @return  {Array[]}               The range: `[[lineNumber, colStart], [lineNumber, colEnd]]`.
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

  const colStart = positions.begin.column - 1;
  const colEnd = (positions.end.column === undefined)
    ? undefined : (positions.end.column - 1);

  // No valid end column, let `generateRange()` highlight a word
  if (colEnd === undefined || colStart === colEnd) {
    return Helpers.generateRange(textEditor, line, colStart);
  }

  // Valid end column, and different from the start one
  return [[line, colStart], [line, colEnd]];
};


const ccLinter = {
  cache: {},
  fingerprints: {},
  linting: {},

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
      atom.workspace.observeTextEditors(textEditor => this.cacheEditor(textEditor)),
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
      lint: async textEditor => this.debouncedLint(textEditor),
    };
  },

  /**
   * @summary Debounces the linting to join triggerings from multiple files of same project.
   * @param   {TextEditor} textEditor The TextEditor instance of the triggering file.
   * @return  {Promise}               An array of issues in the format that AtomLinter expects.
   */
  async debouncedLint(textEditor) {
    const path = textEditor.getPath();

    // Exit early on `untitled` files (not saved into disk yet)
    if (path === undefined) return null;

    if (!this.cache[path]) {
      // Beware with race condition: textEditor observer and linter fired simultaneously
      await this.cacheEditor(textEditor);
    }
    const { project } = this.cache[path];
    const now = Date.now();
    if (this.linting[project] === undefined) {
      this.linting[project] = [now];
    } else {
      this.linting[project].push(now);
    }

    await delay(250);
    this.linting[project].shift();

    // More lints for the same project have been requested and delayed.
    if (this.linting[project].length > 0) return null;

    // This is the last requested lint, so analyze!
    return this.lintProject(project);
  },

  /**
   * @summary Lints a project.
   * @param   {String}  path The absolute path to the project to analyze.
   * @return  {Promise}      An array of issues in the format that AtomLinter expects.
   */
  async lintProject(path) {
    // Debug the command executed to run the Code Climate CLI to the console
    devLog(`Analyzing project @ ${path}`);

    // Start measure for how long the analysis took
    measure.start(path);

    // Exec cc-cli and handle unique spawning (killed execs will return `null`)
    const result = await this.runCli(path);
    if (result === null) return null;

    const linterResults = this.parseIssues(path, result);

    // Log the length of time it took to run analysis
    measure.end(path);

    this.reset(path);
    return linterResults;
  },

  /**
   * @summary Cache and keeps track of open textEditors and cache its file/project paths.
   * @param   {TextEditor} textEditor TextEditor instance of the file which triggered the analysis.
   */
  async cacheEditor(textEditor) {
    const path = textEditor.getPath();

    if (path === undefined) {
      // Although this could be placed after the event subscriptions to allow
      // TextEditors to automatically get fixed, it could mean that there were
      // multiple subscriptions for the same editor. By returning before
      // subscribing to events on an unsaved TextEditor we avoid this, and if
      // a lint() is called on it later once it has a path it will get cached
      // then.
      return;
    }

    if (this.cache[path]) return;

    textEditor.onDidDestroy(() => delete this.cache[path]);
    textEditor.onDidChangePath((newPath) => {
      const cached = this.cache[path];
      delete this.cache[path];
      cached.path = newPath;
      this.cache[newPath] = cached;
    });

    this.cache[path] = {
      editor: textEditor,
      file: path,
      project: await findProjectRoot(path),
    };
  },

  findTextEditor(filepath) {
    return this.cache[filepath] && this.cache[filepath].editor;
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
      ignoreExitCode: true,
      uniqueKey: `linter-codeclimate::${cwd}`,
    };

    if (this.disableTimeout || atom.inSpecMode()) {
      execOpts.timeout = Infinity;
    }

    // Execute the Code Climate CLI, parse the results, and emit them to the
    // Linter package as warnings. The Linter package handles the styling.
    try {
      return await Helpers.exec(this.executablePath, execArgs, execOpts);
    } catch (e) {
      notifyError(e);
      return null;
    }
  },

  /**
   * @summary Parses the issues reported by CodeClimate CLI to the format AtomLinter expects.
   * @param   {String}   project The absolute path to the project to analyze.
   * @param   {Object}   result  JSON string from the CodeClimate CLI output to parse.
   * @return  {Object[]}         Parsed issues, with following keys per object (array item):
   *                             - description: explanation of the issue.
   *                             - excerpt: summary of the issue.
   *                             - location: { file, position }.
   *                             - severity: the issue severity (one of (info|warning|error)).
   */
  parseIssues(project, result) {
    let messages;

    try {
      messages = JSON.parse(result);
    } catch (e) {
      notifyError(e, 'Invalid JSON returned from CodeClimate. See the Console for details.');
      // eslint-disable-next-line no-console
      console.error('Invalid JSON returned from CodeClimate:', result);
      return [];
    }

    const linterResults = [];
    messages.forEach((issue) => {
      // Exit early if not an issue
      if (issue.type.toLowerCase() !== 'issue') return;

      // Exit early if duplicated issue
      if (this.reportedPreviously(project, issue.fingerprint)) return;

      const file = join(project, issue.location.path);
      const textEditor = this.findTextEditor(file);
      const position = textEditor
        ? calcRange(textEditor, issue.location)
        : estimateRange(issue.location);
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
  },

  /**
   * @summary Checks if the reported issue has been reported previously (duplicated).
   * @param   {String}  projectRoot The project root.
   * @param   {}
   * @return  {Boolean} Whether the issue is duplicated (`true`) or not (`false`).
   * @todo    Remove after fixing https://github.com/phpmd/phpmd/issues/467
   */
  reportedPreviously(projectRoot, fingerprint) {
    if (!Object.prototype.hasOwnProperty.call(this.fingerprints, projectRoot)) {
      this.fingerprints[projectRoot] = new Set();
    }

    if (this.fingerprints[projectRoot].has(fingerprint)) return true;

    this.fingerprints[projectRoot].add(fingerprint);
    return false;
  },

  /**
   * @summary Resets the flags for project at `projectRoot`.
   * @param   {String} projectRoot The absolute path to the project root.
   */
  reset(projectRoot) {
    delete this.fingerprints[projectRoot];
    delete this.linting[projectRoot];
  },
};

export default ccLinter;
