
// Phrasings people really type for simple "open" commands. These must be handled instantly without the AI.
// Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand } from '../js/commands.js';
const cases = [
 ['open youtube','https://www.youtube.com/'], ['open YouTube','https://www.youtube.com/'], ['Open YouTube.','https://www.youtube.com/'],
 ['can you open youtube?','https://www.youtube.com/'], ['can u open youtube','https://www.youtube.com/'], ['Jarvis, can you please open YouTube for me?','https://www.youtube.com/'],
 ['hey jarvis open youtube','https://www.youtube.com/'], ['open youtube jarvis','https://www.youtube.com/'], ['pls open yt','https://www.youtube.com/'],
 ['youtube','https://www.youtube.com/'], ['YouTube kholo','https://www.youtube.com/'], ['youtube open karo','https://www.youtube.com/'], ['open youtube app','https://www.youtube.com/'],
 ['bro open youtube','https://www.youtube.com/'], ['open utube','https://www.youtube.com/'], ['go to youtube','https://www.youtube.com/'], ['open youtube.com','https://www.youtube.com/'],
 ['i want to open youtube','https://www.youtube.com/'], ['open the youtube website','https://www.youtube.com/'], ['launch youtube now','https://www.youtube.com/'],
 ['open youtube and play lofi music','https://www.youtube.com/results?search_query=lofi%20music'],
 ['open youtube and search java tutorial','https://www.youtube.com/results?search_query=java%20tutorial'],
 ['open youtube then search for java tutorial','https://www.youtube.com/results?search_query=java%20tutorial'],
 ['search youtube for lofi','https://www.youtube.com/results?search_query=lofi'], ['search lofi on youtube','https://www.youtube.com/results?search_query=lofi'],
 ['play lofi music on youtube','https://www.youtube.com/results?search_query=lofi%20music'], ['play arijit singh songs','https://www.youtube.com/results?search_query=arijit%20singh%20songs'],
 ['youtube lofi','https://www.youtube.com/results?search_query=lofi'], ['youtube pe lofi chalao','https://www.youtube.com/results?search_query=lofi'],
 ['open gmail','https://mail.google.com/'], ['open google','https://www.google.com/'], ['open instagram','https://www.instagram.com/'], ['open insta','https://www.instagram.com/'],
 ['open whatsapp web','https://web.whatsapp.com/'], ['open whatsapp','https://web.whatsapp.com/'], ['open maps','https://www.google.com/maps'], ['open google maps','https://www.google.com/maps'],
 ['open spotify','https://open.spotify.com/'], ['play believer on spotify','https://open.spotify.com/search/believer'],
 ['google cricket score','https://www.google.com/search?q=cricket%20score'], ['search for cricket score','https://www.google.com/search?q=cricket%20score'],
 ['open github.com/anurag0224q','https://github.com/anurag0224q'], ['open youtube music','https://music.youtube.com/'],
 ['open youtube, and then play lofi','https://www.youtube.com/results?search_query=lofi'], ['youtube and gmail','https://www.youtube.com/'], ['open youtube and open gmail','https://www.youtube.com/'], ['Hey Jarvis open YouTube please','https://www.youtube.com/'], ['open youtube bro','https://www.youtube.com/'], ['could you open up youtube','https://www.youtube.com/'],
 // not commands → AI
 ['what is youtube',null], ['how do i open youtube on my tv',null], ['play a game with me',null], ['why is youtube not opening',null], ['open youtube and tell me a joke',null],
 ['write code to open youtube in python',null], ['explain photosynthesis',null], ['https://www.youtube.com/watch?v=dQw4w9WgXcQ',null], ['hi',null], ['play tic tac toe',null],
];
test('open commands: every phrasing maps to the right URL (or goes to the AI)', () => {
  for (const [q, want] of cases) { const r = parseCommand(q); assert.equal(r ? r.url : null, want, JSON.stringify(q)); }
});
test('open commands: two sites in one message give two buttons', () => {
  const r = parseCommand('open youtube and gmail');
  assert.equal(r.url, 'https://www.youtube.com/'); assert.equal(r.more[0].url, 'https://mail.google.com/');
});
