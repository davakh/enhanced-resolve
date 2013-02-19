/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/
var Tapable = require("tapable");
function Resolver(fileSystem) {
	Tapable.call(this);
	this.fileSystem = fileSystem;
}
module.exports = Resolver;

Resolver.prototype = Object.create(Tapable.prototype);

Resolver.prototype.resolveSync = function resolveSync(context, request) {
	var err, result, sync = false;
	this.resolve(context, request, function(e, r) {
		err = e;
		result = r;
		sync = true;
	});
	if(!sync) throw new Error("Cannot 'resolveSync' because the fileSystem is not sync. Use 'resolve'!");
	if(err) throw err;
	return result;
};

Resolver.prototype.resolve = function resolve(context, request, callback) {
	if(typeof request === "string") request = this.parse(request);
	this.applyPlugins("resolve", context, request);
	var obj = {
		path: context,
		request: request.path,
		query: request.query,
		directory: request.directory
	};
	function onResolved(err, result) {
		if(err) return callback(err);
		return callback(null, result.path + (result.query || ""));
	}
	if(request.module) return this.doResolve("module", obj, onResolved);
	if(request.directory) return this.doResolve("directory", obj, onResolved);
	return this.doResolve(["file", "directory"], obj, onResolved);
};

Resolver.prototype.doResolve = function doResolve(types, request, callback) {
	if(!Array.isArray(types)) types = [types];
	this.applyPlugins("resolve-step", types, request);
	if(types.length == 1) {
		// If only one type, we can pass the error.
		return this.applyPluginsParallelBailResult(types[0], request, function(err, result) {
			if(err) return callback(err);
			if(!result) return callback(new Error("Cannot resolve " + types[0] + " " + request.request + " in " + request.path + "."));
			return callback(null, result);
		});
	}
	// For multiple type we have to ignore the error
	this.forEachBail(types, function(type, callback) {
		this.applyPluginsParallelBailResult(type, request, function(err, result) {
			if(!err && result) return callback(result);
			callback();
		});
	}.bind(this), function(result) {
		if(!result) return callback(new Error("Cannot resolve " + types.join(" or ") + " " + request.request + " in " + request.path + "."));
		return callback(null, result);
	});
};

Resolver.prototype.parse = function parse(identifier) {
	if(identifier === "") return null;
	var part = {
		path: null,
		query: null,
		module: false,
		directory: false,
		file: false
	};
	var idxQuery = identifier.indexOf("?");
	if(idxQuery == 0) {
		part.query = identifier;
	} else if(idxQuery > 0) {
		part.path = identifier.slice(0, idxQuery);
		part.query = identifier.slice(idxQuery);
	} else {
		part.path = identifier;
	}
	if(part.path) {
		part.module = this.isModule(part.path);
		if(part.directory = this.isDirectory(part.path)) {
			part.path = part.path.substr(0, part.path.length - 1);
		}
	}
	return part;
};

var notModuleRegExp = /^\.$|^\.[\\\/]|^\.\.$|^\.\.[\/\\]|^\/|^[A-Z]:[\\\/]/i;
Resolver.prototype.isModule = function isModule(path) {
	return !notModuleRegExp.test(path);
};

var directoryRegExp = /[\/\\]$/i;
Resolver.prototype.isDirectory = function isDirectory(path) {
	return directoryRegExp.test(path);
};

var absoluteWinRegExp = /^[A-Z]:[\\\/]/i;
var absoluteNixRegExp = /^\//i;
Resolver.prototype.join = function join(path, request) {
	if(absoluteWinRegExp.test(request)) return this.normalize(request.replace(/\//g, "\\"));
	if(absoluteNixRegExp.test(request)) return this.normalize(request);
	if(path == "/") return this.normalize(path + request);
	if(path.indexOf("/") == 0) return this.normalize(path + "/" + request);
	return this.normalize(path + "\\" + request.replace(/\//g, "\\"));
};

var doubleSlashWinRegExp = /\\\\/g;
var doubleSlashNixRegExp = /\/\//g;
var currentDirectoryWinMiddleRegExp = /\\\.\\/;
var currentDirectoryWinEndRegExp = /\\\.$/;
var parentDirectoryWinMiddleRegExp = /\\[^\\]+\\\.\.\\/;
var parentDirectoryWinEndRegExp = /\\[^\\]+\\\.\.$/;
var currentDirectoryNixMiddleRegExp = /\/\.\//;
var currentDirectoryNixEndRegExp = /\/\.$/;
var parentDirectoryNixMiddleRegExp = /\/[^\/]+\/\.\.\//;
var parentDirectoryNixEndRegExp = /\/[^\/]+\/\.\.$/;
Resolver.prototype.normalize = function normalize(path) {
	path = path.replace(doubleSlashWinRegExp, "\\").replace(doubleSlashNixRegExp, "/");
	while(currentDirectoryWinMiddleRegExp.test(path)) {
		path = path.replace(currentDirectoryWinMiddleRegExp, "\\");
	}
	path = path.replace(currentDirectoryWinEndRegExp, "");
	while(parentDirectoryWinMiddleRegExp.test(path)) {
		path = path.replace(parentDirectoryWinMiddleRegExp, "\\");
	}
	path = path.replace(parentDirectoryWinEndRegExp, "");
	while(currentDirectoryNixMiddleRegExp.test(path)) {
		path = path.replace(currentDirectoryNixMiddleRegExp, "/");
	}
	path = path.replace(currentDirectoryNixEndRegExp, "");
	while(parentDirectoryNixMiddleRegExp.test(path)) {
		path = path.replace(parentDirectoryNixMiddleRegExp, "/");
	}
	path = path.replace(parentDirectoryNixEndRegExp, "");
	return path;
};

Resolver.prototype.forEachBail = function(array, iterator, callback) {
	if(array.length == 0) return callback();
	var currentPos = array.length;
	var currentError, currentResult;
	var done = [];
	for(var i = 0; i < array.length; i++) {
		var itCb = function(i) {
			if(i >= currentPos) return; // ignore
			var args = Array.prototype.slice.call(arguments, 1);
			done.push(i);
			if(args.length > 0) {
				currentPos = i + 1;
				done = done.filter(function(item) {
					return item <= i;
				});
				currentResult = args;
			}
			if(done.length == currentPos) {
				callback.apply(null, currentResult);
				currentPos = 0;
			}
		}.bind(this, i);
		iterator(array[i], itCb);
		if(currentPos == 0) break;
	}
};
