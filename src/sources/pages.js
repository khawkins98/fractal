/**
 * Module dependencies.
 */

var Promise     = require('bluebird');
var _           = require('lodash');
var logger      = require('winston');

var Directory   = require('../filesystem/directory');
var Page        = require('./entities/page');
var Group       = require('./entities/group');
var mixin       = require('./source');
var data        = require('../data');

/*
 * Export the page source.
 */

module.exports = PageSource;

/*
 * PageSource constructor.
 *
 * @api private
 */

function PageSource(pages, app){
    this.pages = pages;
    this.app = app;
};

mixin.call(PageSource.prototype);

/*
 * Return the page tree.
 *
 * @api public
 */

PageSource.prototype.all = function(){
    return this.pages;
};

/*
 * Resolve a page by handle or path and return the page.
 *
 * @api public
 */

PageSource.prototype.resolve = function(str){
    if (_.startsWith(str, '@')) {
        return this.findByHandle(str);
    } else {
        return this.findByPath(str);
    }
};

/*
 * Find a page by it's path.
 * Path format: my/page/path
 *
 * @api public
 */

PageSource.prototype.findByPath = function(pagePath){
    return this.findByKey('path', pagePath);
};

/*
 * Find a page by it's handle.
 * Throws an error if the page is not found.
 *
 * Handle format: @page-handle
 *
 * @api public
 */

PageSource.prototype.findByHandle = function(handle){
    var handle = handle.replace(/^@/, '');
    return this.findByKey('handle', handle);
};

/*
 * Find a page by a key.
 * Throws an error if the page is not found.
 *
 * @api public
 */

PageSource.prototype.findByKey = function(key, value) {
    var found = null;
    function checkChildren(children){
        if (found) return found;
        for (var i = 0; i < children.length; i++) {
            var child = children[i];
            if (child.type === 'page' && _.get(child, key) === value) {
                found = child;
                break;
            } else if (child.type == 'group') {
                checkChildren(child.children);
            }
        };
        return found;
    }
    var result = checkChildren(this.pages);
    if (!result) {
        throw new Error('The page ' + key + ':' + value + ' could not be found.');
    }
    return result;
};

/*
 * Find a group by a key.
 * Throws an error if the page is not found.
 *
 * @api public
 */

PageSource.prototype.findGroupByKey = function(key, value) {
    var found = null;
    function checkChildren(children){
        if (found) return found;
        for (var i = 0; i < children.length; i++) {
            var child = children[i];
            if (child.type == 'group') {
                if (_.get(child, key) === value) {
                    found = child;
                    break;
                } else {
                    checkChildren(child.children);
                }
            }
        };
        return found;
    }
    var result = checkChildren(this.pages);
    if (!result) {
        throw new Error('The group ' + key + ':' + value + ' could not be found.');
    }
    return result;
};

/*
 * Returns a flattened array of all components in the system
 *
 * @api public
 */

PageSource.prototype.flatten = function(){
    function list(items) {
        return _.flatten(_.map(items, function(item){
            return item.type === 'group' ? list(item.children) : item;
        }));
    }
    return new PageSource(list(this.pages), this.app).init();
};

/*
 * Returns a flattened array of all components in the system
 *
 * @api public
 */

PageSource.prototype.flattenWithGroups = function(){
    var grouped = [];
    var self = this;
    function group(items, labelPath) {
        _.each(items, function(item){
            var newPath = labelPath ? labelPath + '/' + item.label : item.label;
            if (item.type === 'group') {
                var subPages = item.getSubEntities();
                var subGroups = item.getSubGroups();
                if (subPages.length) {
                    var newGroup = _.clone(item);
                    item.children = subPages;
                    item.label = item.title = newPath;
                    item.depth = 0;
                    grouped.push(item);
                }
                if (subGroups.length) {
                    group(subGroups, newPath);
                }
            } else {
                grouped.push(item);
            }
        });
    }
    group(this.pages, null);
    return new PageSource(grouped, this.app).init();
};

/*
 * Returns a new page tree filtered by key:value
 *
 * @api public
 */

PageSource.prototype.filter = function(key, value){
    function filter(items){
        var ret = [];
        _.each(items, function(item){
            if (item.type === 'page') {
                if (item[key] === value) {
                    ret.push(item);
                }
            } else {
                // group
                var children = filter(item.children);
                if (children.length) {
                    ret.push(new Group(item._dir, item._config, children, item._app));
                }
            }
        });
        return _.compact(ret);
    }
    return new PageSource(filter(this.pages), this.app).init();
};

/*
 * Returns a JSON representation of all the pages
 *
 * @api public
 */

PageSource.prototype.toJSON = function(){
    return _.map(this.pages, function(entity){
        return entity.toJSON();
    });
};

/*
 * Get a JSON-formatted string representation of the pages.
 *
 * @api public
 */

PageSource.prototype.toString = function(){
    return JSON.stringify(this.toJSON(), null, 4);
};

/*
 * Merge a default PageSource into this one.
 *
 * @api public
 */

PageSource.prototype.setDefaults = function(defaults){
    var self = this;
    function addDefaults(source, items){
        _.each(items, function(item){
            var found = false;
            if (item.type === 'page') {
                try {
                    var sourcePage = self.findByPath(item.path);
                    if (! sourcePage.hidden) {
                        found = true;
                    }
                } catch(e) {}
                if (!found) {
                    if (source instanceof PageSource) {
                        source.pages.push(item);
                        source.pages = _.sortByOrder(source.pages, ['order','label'], ['asc','asc']);
                    } else {
                        source.children.push(item);
                        source.children = _.sortByOrder(source.children, ['order','label'], ['asc','asc']);
                    }
                }
            } else if (item.type === 'group') {
                try {
                    var group = self.findGroupByKey('path', item.path);
                    if (! group.hidden) {
                        found = true;
                    }
                } catch(e) {}
                if (!found) {
                    var group = new Group(item._dir, item._config, [], item._app);
                    if (source instanceof PageSource) {
                        source.pages.push(group);
                        source.pages = _.sortByOrder(source.pages, ['order','label'], ['asc','asc']);
                    } else {
                        source.children.push(group);
                        source.children = _.sortByOrder(source.children, ['order','label'], ['asc','asc']);
                    }
                }
                addDefaults(group, item.children);
            }
        });
        return source;
    }
    addDefaults(this, defaults.pages);
};

/*
 * Return a new PageSource instance from a directory path.
 *
 * @api public
 */

PageSource.build = function(path, app){
    return Directory.fromPath(path).then(function(dir){
        return PageSource.buildPageTree(dir, app).then(function(tree){
            return new PageSource(tree, app).init();
        });
    }).catch(function(e){
        console.log(e.stack);
        logger.warn('Could not create page tree - ' + e.message);
        return new PageSource([], app).init();
    });
};

/*
 * Takes a directory and recursively converts it into a tree of pages
 *
 * @todo
 * @public
 */

PageSource.buildPageTree = function(dir, app){

    var tree = [];

    function makeGroupPromise(directory){
        return PageSource.buildPageTree(directory, app).then(function(subtree){
            if (_.isArray(subtree)) {
                return Group.fromDirectory(directory, subtree, app);
            }
            return subtree;
        });
    }

    _.each(dir.children, function(entity){
        if (entity.type == 'file') {
            var matches = entity.matches(app.get('pages:match'));
            if (matches) {
                tree.push(Page.fromFile(entity, dir, app));
            }
        } else {
            if (entity.hasChildren()) {
                tree.push(makeGroupPromise(entity));
            }
        }
        return null;
    });

    return Promise.all(tree).then(function(items){
        var items = _.compact(items);
        return _.isArray(items) ? _.sortByOrder(items, ['order','label'], ['asc','asc']) : items;
    });
};

/*
 * Return an empty new PageSource instance
 *
 * @api public
 */

PageSource.emptySource = function(app){
    return Promise.resolve(new PageSource([], app).init());
};