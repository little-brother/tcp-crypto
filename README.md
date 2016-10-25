# tcp-crypto<br />
Provide encrypted point-to-point channel between server and client via tcp.
Server stores unsended data inside special folder while client is disconnect.
Client can send query and wait answer on callback.

## Install with [npm](npmjs.org)
``` bash
npm i tcp-crypto --save
```

## Usage
### Server side
``` javascript
'use strict'
const Server = require('tcp-crypto').Server;

let server = new Server({
	"port": 3000,
	"cipher": "aes192",
	"password": "secret",
	"dir": "./outbox"	
});

server.on('connection', function () {
	console.log('connect');
	server.send('your-server-event', 'Hello from server');
});
server.on('disconnection', () => console.log('disconnect'));
server.on('error', (err) => console.log(err));
server.on('send', (msg) => null);
server.on('your-client-event', (data, msg_id) => console.log(data));
server.on('your-client-event-with-callback', (data, msg_id) => 
	server.send('your-client-event-with-callback', 'Hello callback again', msg_id); // send reply
);

// send console input
let stdin = process.openStdin();
stdin.addListener('data', (data) => server.send('your-server-event', data.toString()));
```
### Client side
``` javascript
'use strict'
const Client = require('tcp-crypto').Client;

let client = new Client({
	"port": 3000,
	"cipher": "aes192",
	"password": "secret",
	"reconnect-delay": 10
});

client.on('connect', function () {
	console.log('Connect');	
	client.send('your-client-event', 'Hello from client');
	client.send('your-client-event-with-callback', 'Hello callback', (res) => console.log(res));	
});
client.on('disconnect', () => console.log('Disconnect'));	
server.on('send', (msg) => null);
client.on('error', (err) => null);
client.on('your-server-event', (data) => console.log(data));

// send console input
let stdin = process.openStdin();
stdin.addListener('data', (data) => client.send('your-client-event', data.toString()));
```