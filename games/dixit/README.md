# Soliloquy — serverless WebRTC web build

A 3–6 player surreal storytelling card game (Dixit-inspired) with 100
ComfyUI-generated dream cards.

- **Play:** https://kobin3.github.io/2026_trip/games/dixit/
- **Host:** choose a name → `HOST VIA WEBRTC` → `INVITE` →
  `GENERATE INVITE CODE` → `COPY CODE` and send it to a friend.
- **Guest:** open the same page → `JOIN WITH CODE` → paste the invite →
  `CREATE ANSWER` → `COPY ANSWER`, then send the answer back.
- **Host:** paste the answer → `CONNECT FRIEND`. The room syncs over WebRTC.

No signaling server and no game server are used. The two long codes are the SDP
offer/answer with embedded ICE candidates. STUN is used only for candidate
discovery; there is no TURN relay, so symmetric NAT / CGNAT may fail.

The page must be served over HTTPS (GitHub Pages) or localhost. The first
`PASTE` may ask for clipboard permission; `COPY` always works.

Built with Godot 4.7.2 (Compatibility renderer, single-threaded web template).
Art is original, generated locally with ComfyUI/Qwen; UI font Sarabun (SIL OFL).
