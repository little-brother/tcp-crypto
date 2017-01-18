'use strict';
const net = require('net');
const fs = require('fs');
const crypto = require('crypto');
const EventEmitter = require('events');
const util = require('util');

function encode (text, cipher, password) { 
	let c = crypto.createCipher(cipher, password); 
	return c.update(text, 'utf8', 'base64') + c.final('base64'); 
}

function decode (data, cipher, password) { 
	let c = crypto.createDecipher(cipher, password); 
	return c.update(data, 'base64', 'utf8') + c.final('utf8'); 
}

function genId() {	
	return (new Date()).getTime() + '-' + Math.floor(Math.random() * 10000);
}

// opts = {host, port, cipher, password}
function Client (opts) {
	this.id = opts.id;
	this.opts = opts;
	this.send = send; 
	this.isConnected = false;
	let client = this;

	let queue = [];
	let callbacks = {};
	let isBusy = true;
	let socket;

	connect(opts);

	function send (event, data, callback) {
		if (!client.isConnected && callback)
			return callback(new Error('CONNECTION'));

		queue.push({event, data, callback});
		next();
	}

	function next() {
		if (isBusy)
			return;
		
		isBusy = true;

		if (queue.length == 0) 
			return (isBusy = false);

		if (socket) {
			let msg = {
				id: genId(),
				event: queue[0].event, 
				data: queue[0].data
			}

			socket.write((!!opts.cipher ? encode(JSON.stringify(msg), opts.cipher, opts.password) : JSON.stringify(msg)) + '|', function (err) {
				if (err)
					return socket.emit('error', err);

				if (queue[0].callback)		
					callbacks[msg.id] = queue[0].callback;

				client.emit('send', queue[0]);
				queue.shift(); 
				isBusy = false;
				next();
			});
		}	
	}
	
	function connect (opts) {
		socket = net.connect({host: opts.host, port: opts.port});
		queue = [];
		callbacks = {};
		isBusy = true;

		socket.on('connect', function () {
			isBusy = false;
			client.isConnected = true;
			client.emit('connect', opts.id);
		});

		let buffer = '';
		socket.on('data', function(chunk) {
			buffer += chunk;
			let msgs = buffer.split('|');
			buffer = msgs.pop();

			msgs.forEach(function(packet){

				let msg;
				try { 
					msg = JSON.parse(!!opts.cipher ? decode(packet, opts.cipher, opts.password) : packet);
				} catch(err) { 
					return socket.emit('error', err);
				}

				client.emit('receive', msg);
	
				if (msg.id in callbacks) {	
					callbacks[msg.id](msg.data);
					delete callbacks[msg.id];			
					return;
				}
				
				if (msg.event != 'ACK') {
					client.emit(msg.event, msg.data);
					send('ACK', {id: msg.id, event: msg.event});
					return;
				}
			});
		});	

		socket.on('close', () => {
			setTimeout(connect, opts['reconnect-delay'] * 1000 || 30000, opts);
			if (client.isConnected) {
				client.isConnected = false;
				client.emit('disconnect', opts.id);	
			}
			client.isConnected = false;
		});

		socket.on('error', (err) => client.emit('error', err));		
	}	
}
util.inherits(Client, EventEmitter);

// opts = {port, cipher, password, dir}
function Server (opts) { 
	let server = this;
	server.send = send;
	let isBusy = true;
	
	let queue = [];
	if (!!opts.dir) {
		try {
			fs.mkdirSync(opts.dir); // default './outbox'
		} catch(err) {
			if (err.code != 'EEXIST') 
				throw err;
		}	
	
		queue = fs.readdirSync(opts.dir)
			.map(function (f) { 
				return {
					id: f.split('.')[0], 
					event: f.split('.')[1], 
					data: fs.readFileSync(`${opts.dir}/${f}`)
				};
			})
			.map(function (msg) { 
				try { 
					msg.data = JSON.parse(msg.data);
				} catch (err) { 
					server.emit('error', 'Error on parse ${msg.id}: ' + err.message); 
					msg.data = ''
				}; 
				return msg;
			})
			.filter((msg) => !!msg.data);	
		queue.add = function (msg) {
			this.push(msg);
			fs.writeFileSync(`${opts.dir}/${msg.id}.${msg.event}`, JSON.stringify(msg.data), {'flags': 'a'});
		}

	} else {
		queue.add = function (msg) {
			this.push(msg);
		}
	}

	function send(event, data, id) {
		queue.add({event, data, id: id || genId()});
		if (server.next)
			server.next();
	}

	let netServer = net.createServer(function(socket){
		isBusy = false;
		server.next = next;
		server.emit('connection', opts.id);
		next();
		
		function next() {
			if (isBusy)
				return;

			isBusy = true;

			if (queue.length == 0) 
				return (isBusy = false);
	
			if (socket)
				socket.write((!!opts.cipher ? encode(JSON.stringify(queue[0]), opts.cipher, opts.password) : JSON.stringify(queue[0])) + '|', () => { 
					server.emit('send', queue[0]);
					queue.shift();
					isBusy = false; 
					next(); 
				});
		}
		
		let buffer = '';
		socket.on('data', function(chunk) {
			buffer += chunk;
			if (buffer.indexOf('|') == -1)
				return;
	
			let msgs = buffer.split('|');
			buffer = msgs.pop();

			msgs.forEach(function(packet){

				let msg;
				try { 
					msg = JSON.parse(!!opts.cipher ? decode(packet, opts.cipher, opts.password) : packet);
				} catch(err) { 
					return socket.emit('error', err);
				}	
				server.emit('receive', msg);
				
				if (msg.event == 'ACK' && !!opts.dir) {
					fs.unlink(`${opts.dir}/${msg.data.id}.${msg.data.event}`, (err) => err ? console.log(err) : null);
					return;
				}
		
				server.emit(msg.event, msg.data, msg.id);
			});	
		});
	
		socket.on('close', () => { 
			server.emit('disconnection', opts.id) 
			socket = undefined; 
		});
	
		socket.on('error', (err) => server.emit('error', err));
	});
	netServer.maxConnections = 1;
	netServer.listen(opts.port, (err) => console.log(err ? err : 'Listen on ' + opts.port));	
	netServer.on('close', () => process.exit(1));
}
util.inherits(Server, EventEmitter);

module.exports = {Client, Server};