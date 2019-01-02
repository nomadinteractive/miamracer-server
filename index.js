var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var mysql = require('mysql');
var shuffle = require('shuffle-array');
var md5 = require('md5');
var config = require('./config');
// console.log(config);


var colors = ['red','blue','green','orange','yellow','pink','purple','brown','gray','black','white','navy'];
var animals = ['fox','snake','bear','dog','cat','lion','bird','tiger','wolf','fish','duck','monkey','eagle','camel','frog','owl','puppy','chick','bee','crab','crow','goat','goose','hawk','mouse','shark','snail','swan','zebra','deer'];
var gameData = {};
var roundLength = 9000;


// DB Connection

const db = mysql.createConnection (config.mysql);

// connect to database
db.connect(function(err) {
    if (err) {
        throw err;
    }
    console.log('Connected to the mysql database');
});
global.db = db;



// Routes

app.get('/', function(req, res){
	res.status(200).json({ success: true, hello: 'world' });
});

app.get('/demo', function(req, res){
	res.sendFile(__dirname + '/index.html');
});

app.post('/api/register', function(req, res){
	var deviceId = req.header('token');
	// console.log('device id = ', deviceId);
	// return res.status(200).send('hi!');

	// check device id in the db
	var query = "SELECT * from `users` WHERE deviceId = ?";
	db.query(query, deviceId, function(err, result) {
		if (err) return res.status(500).json({ success: false, queryError: true, error: err });

		console.log('checking user - results: ', result);
		if (result.length > 0) {
			res.json({
				success: true,
				newUser: false,
				deviceId: result[0].deviceId,
				color: result[0].color,
				animal: result[0].animal,
				number: result[0].number,
			});
		}
		else {
			// pick a color, animal
			var userColor = shuffle.pick(colors);
			var userAnimal = shuffle.pick(animals);
			// console.log('userColor', userColor, 'userAnimal', userAnimal); 

			// get the last iteration from the table
			var query = "SELECT MAX(number) as nextNum FROM `users` WHERE color = ? AND animal = ?";
			var values = [userColor, userAnimal];
			db.query(query, values, function(err, result) {
				console.log('MAX(number)', result);
				if (err) return res.status(500).json({ success: false, queryError: true, error: err });

				var nextNumber = (result[0].nextNum > 0 ? parseInt(result[0].nextNum)+1 : 0);
				console.log('nextNum = ', nextNumber);

				// save new user record
				var query = "INSERT INTO `users` (deviceId, color, animal, number, createdAt) VALUES (?, ?, ?, ?, NOW());";
				var values = [deviceId, userColor, userAnimal, nextNumber];
				db.query(query, values, function(err, result) {
					// console.log(result);
					if (err) return res.status(500).json({ success: false, queryError: true, error: err });

					res.json({
						success: true,
						newUser: true,
						deviceId: deviceId,
						color: userColor,
						animal: userAnimal,
						number: nextNumber
					});
				});
			});
		}
	});
});


app.put('/api/game/solo', function(req, res){
	var deviceId = req.header('token');

	// create game room
	var channelName = 'game-solo-' + md5(deviceId).substr(0, 6) + '-' + Math.floor(Date.now() / 1000);

	var query = "INSERT INTO `games` (`type`, channel, createdAt) VALUES (?, ?, NOW());";
	var values = ['solo', channelName];
	db.query(query, values, function(err, result) {
		console.log('result = ', result);
		if (err) return res.status(500).json({ success: false, queryError: true, error: err });

		res.json({
			success: true,
			type: 'solo',
			channel: channelName
		});

		gameData[channelName] = {};
		gameData[channelName]['type'] = 'solo';
		gameData[channelName]['totalRounds'] = 3;
		gameData[channelName]['leaderboard'] = {};

		createGameLobby(channelName);
	});
});


function createGameLobby(channelName){
	console.log('created a game lobby...', channelName);
	setTimeout(function(){
		startSoloGame(channelName);
	}, 2000);
}

function questionRound(channelName, questionNumber){
	var expectedAnswer = shuffle.pick(colors);
	var question = {
		questionNumber: questionNumber,
		type: 'simple-color',
		answer: expectedAnswer,
		answerTiming: 3
	};
	console.log('sending question...', question);
	io.in(channelName).emit('question', question);
	gameData[channelName]['expectedAnswer'] = expectedAnswer;
	gameData[channelName]['questionNumber'] = questionNumber;
	console.log("latest game data:", gameData[channelName]);
}

function startSoloGame(channelName){
	var questionNumber = 1;
	questionRound(channelName, questionNumber); // first round
	questionNumber++;
	var rounds = setInterval(function(){
		if (questionNumber > gameData[channelName]['totalRounds']-1) {
			clearInterval(rounds);
			setTimeout(function(){ endGame(channelName); }, roundLength);
		}
		questionRound(channelName, questionNumber);
		questionNumber++;
	}, roundLength);
}

function processAnswer(answer){
	// console.log(gameData[answer.channel]['leaderboard'][answer.deviceId]);
	var userPoints = parseInt(gameData[answer.channel]['leaderboard'][answer.deviceId]['points']);
	if (isNaN(userPoints) || typeof userPoints === 'undefined' || userPoints === null) userPoints = 0;
	if (answer.selected == gameData[answer.channel]['expectedAnswer']) {
		userPoints++;
	}
	gameData[answer.channel]['leaderboard'][answer.deviceId]['points'] = userPoints;
}

function getLeaderboard(channelName){
	var players = gameData[channelName]['leaderboard'];
	return players;
}

function endGame(channelName){
	io.in(channelName).emit('game-ended', {
		leaderboard: getLeaderboard(channelName)
	});
	// write to mysql?
	// clean up game data
	gameData[channelName] = null;
	delete gameData[channelName];
}


// Socket events

io.on('connection', function(socket){
	console.log('a user connected');
	
	socket.on('disconnect', function(){
		console.log('user disconnected');
	});

	socket.on('join-game', function(data){
		console.log('user is joining to the game: ', data.channel);
		socket.join(data.channel);

		var query = "SELECT * from `users` WHERE deviceId = ?";
		db.query(query, data.deviceId, function(err, result) {
			gameData[data.channel]['leaderboard'][data.deviceId] = {};
			gameData[data.channel]['leaderboard'][data.deviceId].color = result[0].color;
			gameData[data.channel]['leaderboard'][data.deviceId].username = result[0].animal 
				+ (result[0].number > 0 ? result[0].number : '');
		});

		console.log("game data:", gameData[data.channel]);
	});
	
	socket.on('answer', function(data){
		console.log('answer received: ' + data);
		processAnswer(data);
	});
});

http.listen(4000, function(){
	console.log('listening on *:4000');
});