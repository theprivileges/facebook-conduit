/*
Copyright (c) 2011 Nolan Caudill

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/
/*
 * Facebook-conduit 
 * This is a simple script that receives events from a facebook callback and then republishes these events through and emitter.
 * I took Nolan Caudill's flickr-conduit idea and stripped the pieces specific for Flick and replaced them with Facebooks. 
 *
 * @author Luiz Lopes (http://twitter.com/theprivileges)
 * @see http://search.npmjs.org/#/flickr-conduit
*/
var EventEmitter, urlParser, http, Conduit, parsePost;

EventEmitter = require('events').EventEmitter;
urlParser = require('url').parse;
http = require('http');

Conduit = function() {
    var emitter;

    // Create new emitter
    emitter = new EventEmitter();
    emitter.setMaxListeners(0);
    this.emitter = emitter;

    this.usersLastSeen = {};
    this.userLastSeenThreshold = 30 * 1000; // 5 minutes (since that's the lease length)
};

exports.Conduit = Conduit;

// Recevies parsed URL object and returns true or false
Conduit.prototype.unsubscribeCallback = function(urlParts) {
    return true;
};

// Recevies parsed URL object and returns true or false
Conduit.prototype.subscribeCallback = function(urlParts) {
    return true;
};

// Assumes that there's a URL query parameter called 'sub' that
// maps to the subscription name in redis. Override this if you like.
Conduit.prototype.getEventName = function(urlParts) {
    return urlParts.query.sub;
};

Conduit.prototype.heartbeat = function(callbackId) {
    this.usersLastSeen[callbackId] = Date.now();
};

parsePost = function(content, callback) {
    var postObjs, entries, data;
    postObjs = [];
    try {
        data = JSON.parse(content);
        // We possibly get multiple entries per POST
        entries = Array.isArray(data.data) ? data.data : [data.data];
        
        for (var i in entries) {
            if (entries.hasOwnProperty(i)) {

                postObjs.push({
                    author: entries[i].from.name,
                    updated: entries[i].updated_time,
                    raw: entries[i]
                });
            }
        }
    } catch (e) {
        // Noop
        console.debug(e.description);
    }
    callback(postObjs);
};


var pushHandler = function(req, res) {
    var me, now, urlParts, content, callbackId, lastSeen, mode;
    
    me = this;
    now = Date.now();

    urlParts = urlParser(req.url, true);

    content = '';
    callbackId = me.getEventName(urlParts);

    // Since we are storing this in-process, in case
    // we restart the node server, people will eventually
    // get set to someting.
    if (me.usersLastSeen[callbackId] === undefined) {
        me.usersLastSeen[callbackId] = now;
    }

    lastSeen = parseInt(me.usersLastSeen[callbackId], 10);

    req.on('data', function(data) {
        content += data;
    });

    req.on('end', function() {
        mode = urlParts.query.mode;
        if (mode == 'unsubscribe') {
            if (me.unsubscribeCallback(urlParts)) {
                res.write(urlParts.query.challenge);
            }
        } else if (mode == 'subscribe') {
            if (me.subscribeCallback(urlParts)) {
                if (lastSeen + me.userLastSeenThreshold < now) {
                    res.writeHead(404);
                } else { 
                    res.write(urlParts.query.challenge);
                }
            }
        } else {
            parsePost(content, function(imgObjs) {
                for (var i in imgObjs) {
                    if(imgObjs.hasOwnProperty(i)) {
                        me.emitter.emit(callbackId, imgObjs[i]);
                    }
                }
            });
        } 
        res.end();
    });
};

Conduit.prototype.on = function(ev, listener) {
    return this.emitter.on(ev, listener);
};

Conduit.prototype.listen = function(port) {
    var me, callback;
   
    me = this;
    callback = function () {
        return pushHandler.apply(me, arguments);
    };

    http.createServer(callback).listen(port);
};
