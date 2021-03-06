'use strict';

var _ = require('lodash');
var utils = require('./inc/utils');
var GruntOModuleContext = require('./inc/GruntOModuleContext');
var gruntOverride = require('./inc/override');

/**
 * @class GruntO
 * @property {Date} _time
 * @property {grunt} grunt
 * @property {Object} _gruntOverrider
 * @property {Object} config
 * @property {Object} _options
 * @property {Array} _scans
 * @returns {GruntO}
*/
var GruntO = function (grunt) {
	this._time = Date.now();
	this.grunt = grunt || require('grunt');
	this._gruntOverrider = gruntOverride(grunt);

	this._config = {};
	this._options = {};
	this._scans = [];

	this._gruntOverrider.override();
};

GruntO.prototype = {

	/**
	 * @this GruntO
	 * @public
	 * @param {!Object|Array|String} files
	 * @returns {GruntO} this
	 */
	scan: function (files) {
		if (_.isArray(files)) {
			this._scans = this._scans.concat(files);
			return this;
		}

		if (_.isPlainObject(files)) {
			this._scans.push(files);
			return this;
		}

		if (_.isString(files)) {
			this._scans.push(files);
			return this;
		}

		this.grunt.fail.fatal('Invalid scan type, must be object/array');

		return this;
	},

	/**
	 * @this GruntO
	 * @public
	 * @param {!Object} params
	 * @returns {GruntO} this
	 */
	context: function (params) {
		if (!_.isPlainObject(params)) {
			this.grunt.fail.fatal('Invalid options type, must be object');
			return this;
		}

		_.extend(this._options, params);
		return this;
	},

	/**
	 * @this GruntO
	 * @public
	 * @param {!Object} config
	 * @returns {GruntO} this
	 */
	config: function (config) {
		if (_.isPlainObject(config)) {
			_.extend(this._config, config);
		} else if (config != null) {
			this.grunt.fail.fatal('invalid config value, must be object');
		}

		return this;
	},

	/**
	 * @this GruntO
	 * @public
	 * @param {!String} fPath
	 * @param {!String} cwd
	 * @returns {String}
	 */
	getPrefix: function (fPath, cwd) {
		return fPath.replace(/^[\/]?(.+?)(?:\/default)?(?:\.js)?$/, '$1').replace(/\\+/g, '/');
	},

	/**
	 * @this GruntO
	 * @private
	 * @returns {Array}
	 */
	_searchGruntOModules: function () {
		var that = this;
		var modules = [];

		_.each(this._scans, function (scan) {
			_.each(that.grunt.file.expand(scan, scan.src), function (fPath) {
				var cwd =  (scan.cwd || '').replace(/^\.\//, '') || '';
				var prefix = '';
				var modulePath = utils.joinPaths(cwd, fPath);

				if (!that.grunt.file.isPathAbsolute(modulePath)) {
					modulePath = process.cwd() + '/' + modulePath;
				}

				if (scan.prefix) {
					if (_.isRegExp(scan.prefix)) {
						prefix = fPath.replace(scan.prefix, '$1');
					} else if (_.isString(scan.prefix)) {
						prefix = scan.prefix;
					} else if (_.isFunction(scan.prefix)) {
						prefix = scan.prefix(fPath, cwd);
					} else {
						that.grunt.fail.fatal('invalid prefix type, must be string/regExp/function');
					}
				} else {
					prefix = that.getPrefix(fPath, cwd);
				}

				modules.push({
					path: fPath,
					modulePath: modulePath,
					cwd: cwd,
					prefix: prefix
				});
			});
		});

		return modules;
	},

	/**
	 * @this GruntO
	 * @private
	 * @returns {GruntO} this
	 */
	_run: function () {
		var that = this;
		var refs = {};
		var aliases = {};
		var time = Date.now();
		var loadTime = time - this._time;

		this.config(this._gruntOverrider.flushConfig());

		var gruntOModules = this._searchGruntOModules();

		gruntOModules.forEach(function (f) {
			var context = new GruntOModuleContext(that.grunt, aliases, refs, that._config, f.prefix, that._options);

			var config = require(f.modulePath).call(context, that.grunt, that._options);

			that.config(config);
		});

		this._gruntOverrider.restore();

		if (aliases.grunto == null) {
			aliases.grunto = [];
		}

		_.each(aliases, function (tasks, name) {
			_.each(tasks, function (taskName) {
				if (!refs[taskName]) {
					that.grunt.fail.fatal(name + ': undefined task "' + taskName + '"');
				}
			});

			that.grunt.task.registerTask(name, tasks);
		});

		that.grunt.initConfig(this._config);

		this._statistic(aliases, refs, gruntOModules, loadTime, time);

		return this;
	},

	/**
	 * @this GruntO
	 * @private
	 * @param {Object} aliases
	 * @param {Object} refs
	 * @param {Array} gruntOModules
	 * @param {Number} loadTime
	 * @param {Number} time
	 * @returns {GruntO} this
	 */
	_statistic: function (aliases, refs, gruntOModules, loadTime, time) {
		var taskKeys    = _.keys(this._config);
		var regTaskKeys = _.keys(this._gruntOverrider.registered());

		var aliasesLength = _.size(aliases);
		var refsLength    = _.size(refs);

		var tasksSize             = taskKeys.length;
		var registeredTasksSize   = regTaskKeys.length;
		var registeredModulesSize = gruntOModules.length;

		var msg = '\n';

		msg += '\tModules(' + registeredModulesSize + ')' +
			', Tasks(' + tasksSize + ')' +
			', Sub-tasks(' + (refsLength - aliasesLength) + ')' +
			', Aliases(' + aliasesLength + ')\n';
		msg += '\tPrepare Time (load-grunt-tasks work): ' + (loadTime / 1000) + 's\n';
		msg += '\tModule Config Generation Time (grunto work): ' + ((Date.now() - time) / 1000) + 's\n';

		if (registeredTasksSize > tasksSize) {
			msg += '\tUnused Tasks (was loaded, but unused): "' + _.difference(regTaskKeys, taskKeys).join('", "') + '"\n';
		}

		this.grunt.log.writeln(msg);

		return this;
	}
};

module.exports = function (func, options) {
	options = _.extend({
		autoload: true,
		timeMetric: true
	}, options);

	return function (grunt) {
		var gruntO = new GruntO(grunt);

		grunt.task.registerMultiTask('gruntoTask', function () {
			this.data.call(this);
		});

		if (options.autoload) {
			require('load-grunt-tasks')(grunt, _.isEmpty(options.autoload) ? {} : options.autoload);
		}

		if (options.timeMetric) {
			require('time-grunt')(grunt);
		}

		gruntO.config(func.call(gruntO, grunt));

		gruntO._run();
	};
};
