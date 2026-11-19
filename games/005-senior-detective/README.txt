The Senior Detective — นักสืบวัยเก๋า
HTML5 prototype build
==============================

Run this folder through a local or remote HTTP server. Opening index.html with
file:// will not work because the browser blocks the .pck/.wasm fetch.

Quick local test:
  python -m http.server 8080
  http://localhost:8080/

This build is single-threaded (thread support disabled), so it does NOT require
Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy headers.

Contents:
  index.html                  entry point + warm loading screen
  index.js                    Godot web runtime
  index.wasm                  WebAssembly engine
  index.pck                   game data (art, voice, fonts, case JSON)
  index.audio.worklet.js      audio worklet
  index.audio.position.worklet.js
  index.icon.png / index.png  icons
  .htaccess                   MIME types for Apache (optional)

Save data is stored by the browser (IndexedDB/localStorage). Case 1 is free.
The in-game Settings panel offers 100/125/150% text scaling and Story Mode.

Senior-friendly design: large type, single-tap interaction, 96x96 hitboxes,
no timed QTEs, no drag-and-drop, Thai voiceover with replay, and a Case File
that explains objectives and evidence in plain language.
