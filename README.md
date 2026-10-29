# Jarvis AI 🤖

Your own free AI assistant that runs completely in your browser. Chat, code, build websites and games, read your files, PDFs, links and YouTube videos, make AI videos up to 10 minutes long, edit videos, and practise with AI exam papers. It installs on your phone like an app.

**Live app:** https://anurag0224q.github.io/jarvis-ai/

It's free: Jarvis uses your own **free Google Gemini API key**. No server, no subscription, no tokens to buy. Your key and your chats stay on your device.

---

## Getting started (2 minutes)

1. Open the app.
2. Get a free key at **https://aistudio.google.com/apikey** (sign in with Google, then tap “Create API key”).
3. Paste it into Jarvis (the welcome box, or **Settings → AI model**) and tap **Test key**.
4. Say hi 👋

**Install on your phone:** open the site in Chrome, then use ⋮ → *Add to Home screen* (iPhone: Share → *Add to Home Screen*). It opens full screen like an app and the app itself works offline. AI answers still need internet.

## What it can do

### 💬 Chat
- Streaming answers with Markdown, tables, math (KaTeX) and highlighted code
- Stop, regenerate (keeps every version, switch with ◀ ▶), edit and resend, copy, delete, read aloud
- Chats saved on your device: search, rename, pin, delete, export (Markdown or a full backup JSON) and import
- Modes: General, Coder, Website builder, Game maker, App builder, Tutor, Writer, plus your own custom modes
- Memory: tell Jarvis facts about you once (Settings → Personalise)
- Thinking: see the model's thinking (optional)
- `/image a red sports car` makes a free AI image

### 🧑‍💻 Code, websites and games
- Every HTML/CSS/JS answer gets a **▶ Preview** button. It runs safely in a sandbox with a live console.
- Download as a file or a **ZIP**, or **push straight to your GitHub** (and turn on GitHub Pages) from the preview.
- “Ask Jarvis to fix” sends console errors back to Jarvis.

### 📚 Sources (like NotebookLM)
Add **files** (PDF, images, text, code, audio, video), **links** (web pages are read for you), **YouTube videos**, pasted text, or **GitHub repos/files** to a chat. Jarvis answers from them.

### 🎙️ Voice
- 🎤 voice typing, 🔊 read aloud (device voice or a natural Gemini voice)
- 🎧 **hands-free voice chat**: Jarvis listens, answers out loud, then listens again. Tap the voice bar to interrupt.
- Optional **“Hey Jarvis”** wake phrase (Settings → Voice, off by default). It only listens while the tab is open and on screen, and needs Chrome or Edge.

### 🧭 Browser actions
Say or type things like **“open YouTube”**, **“open Gmail”**, **“search YouTube for lofi”**, **“play Believer on YouTube”**, **“google best laptops under 50k”**. Jarvis opens them in a **new tab**. If your browser blocks pop-ups, Jarvis shows a button to tap instead (Settings → Browser actions explains how to allow pop-ups). A website can't control other apps on your phone or computer, so Jarvis only opens tabs.

### 🎬 AI Video Maker
Type a topic, pick a length **from 10 seconds to 10 minutes** (you choose the exact length and the video comes out exactly that long), a shape (16:9 YouTube, 9:16 Reels/Shorts, 1:1) and a style. Jarvis writes a script you can edit scene by scene. You can also write your own. Then it adds:
- a natural AI voice-over (Gemini voices) and captions
- free AI pictures and your own photos
- your background music

It renders **MP4** (H.264 + Opus) or **WebM** right on your device. Then you can **Download**, **Share** (on phones), or **Edit in the Video Editor**.
Tips: for videos over 5 minutes, 480p is faster and smaller (Jarvis suggests it, and switches automatically on phones). The free Gemini voice has a daily limit. If it runs out mid-video, the rest gets captions, and finished voice parts are saved for next time.

### ✂️ Video Editor
Add videos, photos, titles, text and music. Trim, split, reorder, change speed, fit/crop, fades, and choose 16:9 / 9:16 / 1:1. Export at 480p, 720p or 1080p, at the timeline length or a custom length (up to 10 min), to MP4 or WebM. Everything happens on your device, nothing is uploaded.

### 📝 Exam Mode
Pick a subject, topics, optional notes/PDFs, total marks, difficulty, question types (MCQ, numerical, short, long) and a time limit. Jarvis makes a paper whose marks add up **exactly** to your total.
- Take it one question at a time or as a full paper, flag questions for review. It auto-submits when the timer ends.
- MCQ and numerical answers are checked instantly. Short and long answers are graded by AI with **partial marks**.
- Results show score, %, grade, marks per question, full solutions, a topic-wise analysis, time per question and revision tips.
- **Retry wrong answers** or make a **new paper on your weak topics**. History is saved, and you can print or save as PDF.

### 👋 Startup intro and greeting
A HUD-style boot animation that ends with Jarvis greeting you: “Hello sir, I am Jarvis.” Customise it in **Settings → Startup & greeting**:
- your name (`{name}`), your own greeting text in any language (e.g. `नमस्ते {name}`), and placeholders `{greeting}`, `{time}`, `{day}`
- a list of saved greetings: always use one, pick randomly, or by time of day
- a Gemini voice (made once per text and saved) or a voice from your device, with a **Preview** button
- turn the animation or the voice off

Browsers don't allow sound before you tap, so the first launch ends on a ⏻ *Tap to start* button.

### 🔌 Other AI providers (optional)
Gemini is the default (free). In Settings you can also use **Groq**, **OpenRouter** (has free models) or any **OpenAI-compatible** endpoint with your own key.

## Free limits (Google's rules)
Google's free tier gives roughly **20 requests/day** on the best Flash models and **~500/day** on Flash-Lite. Jarvis automatically switches to the next free model when one runs out, and tells you. Google's web-search grounding needs a paid key on Gemini 3 models, so it's off by default. On the free tier, Google may use your prompts to improve its products, so don't paste private information.

## Privacy
- No backend. Your API keys, chats, files and videos are stored only in this browser (localStorage + IndexedDB).
- Requests go straight from your browser to the AI provider you chose. Web pages you add as sources are read through the free r.jina.ai reader, and AI pictures come from pollinations.ai.
- Settings → *Your data* lets you export everything, import it, or delete it.

## Run it yourself
It's a static site, no build step:
```bash
git clone https://github.com/ANURAG0224Q/jarvis-ai && cd jarvis-ai
python3 -m http.server 8000   # then open http://localhost:8000
```
Heavy libraries (Markdown, sanitizer, code highlighting, ZIP, video encoder) are in `lib/`. PDF.js and KaTeX load from a CDN when needed.

```
index.html, manifest.webmanifest, sw.js   app shell, PWA
css/app.css                               all styles (dark/light, mobile, print)
js/app.js        router, onboarding, PWA install
js/chat.js       chat, sources, voice, browser actions
js/providers.js  Gemini / Groq / OpenRouter / custom, TTS, images
js/settings.js   settings page
js/intro.js, js/greeting.js   startup animation + greeting
js/exam.js       Exam Mode
js/video/*       AI Video Maker, Video Editor, rendering engine
test/            unit tests (node --test)
```

## Tests
- `npm test` (or `node --test test/unit.test.mjs`) runs the unit tests: exam marks rebalancing, local grading, browser commands, video timing.
- During development every page was also tested end to end with Playwright on a phone (390×844) and desktop (1366/1440) screen: chat, preview, sources, commands, voice UI, the intro, exams with the timer, the editor, and AI video exports (15 s, 60 s, 5 min and 10 min, checked with ffprobe).

## Credits
Built with [marked](https://github.com/markedjs/marked) (MIT), [DOMPurify](https://github.com/cure53/DOMPurify) (Apache-2.0/MPL-2.0), [highlight.js](https://highlightjs.org/) (BSD-3), [JSZip](https://stuk.github.io/jszip/) (MIT), [Mediabunny](https://mediabunny.dev/) (MPL-2.0), [PDF.js](https://mozilla.github.io/pdf.js/) (Apache-2.0) and [KaTeX](https://katex.org/) (MIT). The AI comes from Google Gemini through your own key. The intro animation is original artwork, not affiliated with any film studio.

MIT License © 2026 Anurag
