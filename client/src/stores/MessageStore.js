'use strict';

import _         from 'lodash';
import Reflux    from 'reflux';
import Actions   from 'actions/SendMessageAction';
import NetworkActions  from 'actions/NetworkActions';
import ChannelActions  from 'actions/ChannelActions';
import SocketActions  from 'actions/SocketActions';

var channelPasswords = {};

var messagesBatchSize = 8;

var MessageStore = Reflux.createStore({
    listenables: [Actions, NetworkActions, SocketActions, ChannelActions],
    init: function() {
      this.messages    = {};
      this.contents    = {};
      this.socket      = null;
      this.loading     = false;
      this.canLoadMore = true;
      this.openChannels = {};
    },
    getLatestMessage: function(channel) {
      return this.messages[channel] && this.messages[channel].length > 0 ? this.messages[channel][0].hash : null;
    },
    getOldestMessage: function(channel) {
      return this.messages[channel] && this.messages[channel].length > 0 ? this.messages[channel][this.messages[channel].length - 1].hash : null;
    },
    onSocketConnected: function(socket) {
      console.log("MessageStore connected");
      this.socket = socket;
      this.socket.on('messages', (channel, messages) => {
        console.log("--> new messages in #", channel, messages);
        this.canLoadMore = true;
        this.loadMessages(channel, null, this.getLatestMessage(channel), 10000);
      });

      NetworkActions.leftChannel.listen((c) => {
        delete this.messages[c];
      });
    },
    onSocketDisconnected: function() {
      this.socket.removeAllListeners("messages");
      this.socket = null;
    },
    onDisconnect: function() {
      this.messages = {};
      this.contents = {};
    },
    onJoinedChannel: async function(channelInfo) {
      console.log("open #" + channelInfo.name);
      if(!this.messages[channelInfo.name]) this.messages[channelInfo.name] = [];
      this.openChannels[channelInfo.name] = channelInfo.name;
      this.loadMessages(channelInfo.name, null, null, messagesBatchSize);
    },
    onLeaveChannel: function(channel) {
      delete this.openChannels[channel];
    },
    loadMessages: function(channel, startHash, endHash, amount) {
      if(!this.socket) {
        console.error("Socket not connected");
        return;
      }

      Actions.startLoading(channel);

      console.log("--> channel.get: ", channel, startHash, endHash, this.messages[channel] && this.messages[channel].length > 0 ? this.messages[channel][0].hash : "");
      this.loading = true;
      if(this.messages[channel] && this.messages[channel].length > 0 && _.contains(this.messages[channel], startHash))
        this.trigger(channel, this.messages[channel]);
      else
        this.socket.emit('channel.get', channel, startHash, endHash, amount, this.addMessages);
    },
    addMessages: function(channel, newMessages) {
      if(newMessages && this.openChannels[channel]) {
        console.log("<-- messages: ", newMessages.length, newMessages);
        var merged    = this.messages[channel].concat(newMessages);
        var all       = _.uniq(merged, 'hash');
        var sorted    = _.sortByOrder(all, ["seq"], ["desc"]);
        this.messages[channel] = sorted;
        this.loading  = false;
        if(newMessages.length > 1) this.canLoadMore = true;
        Actions.stopLoading(channel);
        this.trigger(channel, this.messages[channel]);
      }
    },
    onLoadOlderMessages: function(channel) {
      console.log("load more messages from #" + channel);
      if(!this.loading && this.canLoadMore) {
        this.canLoadMore = false;
        this.loadMessages(channel, this.getOldestMessage(channel), null, messagesBatchSize);
      }
    },
    onLoadMessageContent: function(hash, callback) {
      if(!this.socket) {
        console.error("Socket not connected");
        return;
      }

      if(this.contents[hash]) {
        callback(this.contents[hash]);
        return;
      }

      Actions.startLoading("");
      this.socket.emit('message.get', hash, (result) => {
        if(result) {
          this.contents[hash] = JSON.parse(result.Data);
          Actions.stopLoading("");
          callback(this.contents[hash]);
        } else {
          callback(null);
        }
      });
    },
    onSendMessage: function(channel, message, callback) {
      if(!this.socket) {
        console.error("Socket not connected");
        return;
      }

      console.log("--> send message:", message);
      Actions.startLoading(channel);
      this.socket.emit('message.send', channel, message, (err) => {
        if(err) {
          console.log("Couldn't send message:", err.toString());
          Actions.raiseError(err.toString());
        }
      });
    },
    onAddFile: function(channel, filePath) {
      if(!this.socket) {
        console.error("Socket not connected");
        return;
      }

      console.log("--> add file:", filePath);
      Actions.startLoading(channel);
      this.socket.emit('file.add', channel, filePath, (err) => {
        if(err) {
          console.log("Couldn't add file:", err.toString());
          Actions.raiseError(err.toString());
        }
      });
    },
    // Actions listeners
    onSetChannelOptions: function(channel, newReadPassword, newWritePassword) {
      console.log("--> change password:", newReadPassword, newWritePassword);
      this.socket.emit('channel.password', channel, newReadPassword, newWritePassword, (err) => {
        console.log("--> passwords changed");
        if(err) {
          console.log("Couldn't set password:", err.toString());
          Actions.raiseError(err.toString());
        } else {
          this.readPassword = newReadPassword;
          NetworkActions.getChannelInfo(channel);
        }
      });
    },
    // TODO: move to SwarmStore
    onGetSwarm: function(callback) {
      console.log("--> swarm.get");
      this.socket.emit('swarm.get', callback);
    },
    onLoadDirectoryInfo: function(hash, cb) {
      console.log("--> list.get:", hash);
      if(hash) {
        this.socket.emit('list.get', hash, (result) => {
          if(result) {
            result = result.map((e) => {
              return {
                hash: e.Hash,
                size: e.Size,
                type: e.Type === 1 ? "list" : "file",
                name: e.Name
              };
            });
          }
          cb(result);
        });
      } else {
        cb(null);
      }
    }
});

export default MessageStore;
