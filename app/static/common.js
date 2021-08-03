
// Returns Unix time (i.e. seconds since Epoch)
function time() {
	return Math.floor(Date.now()/1000);
}

// Format seconds as string "HH:MM:SS"
function formatTime(secs) {
	const h = Math.floor(secs/3600);
	const m = Math.floor(secs/60)%60;
	const s = Math.floor(secs%60);
	return `${("0"+h).slice(-2)}:${("0"+m).slice(-2)}:${("0"+s).slice(-2)}`;
}

// Generate a random ID
function randomId(length = 6) {
  const characters = '0123456789abcdefghijklmnopqrstuvwxyz';
  const pickRandom = () => characters.charAt(Math.floor(Math.random() * characters.length));
  return [...Array(length) ].map(pickRandom).join('');
}

function getJson(url, callback = () => {}, silent) {
	fetch(url).then((response) => {
		if(!response.ok) throw Error(`${response.status} ${response.statusText}`);
		if(response.status == 204) callback();
		else return response.json();
	}).then((responseData) => {
		callback(responseData);
	}).catch((error) => {
		console.error(error);
		if(!silent) alert('Erreur: La requête au serveur a échoué.');
	});
}

function postJson(url, data = {}, callback = () => {}, silent) {
	fetch(url, {
		method: 'POST',
		body: JSON.stringify(data),
		headers: {
			'Content-Type': 'application/json'
		}
	}).then((response) => {
		if(!response.ok) throw Error(`${response.status} ${response.statusText}`);
		if(response.status == 204) callback();
		else return response.json();
	}).then((responseData) => {
		callback(responseData);
	}).catch((error) => {
		console.error(error);
		if(!silent) alert('Erreur: La requête au serveur a échoué.');
	});
}
