# TrialReady · RegChain AI

RegChain AI is a browser prototype for country regulatory and clinical supply intelligence. Open a change from the regional overview to see evidence, study impact, regulatory review, and Quality follow-up in one case.

## Run locally

On Windows, open **Start-RegChain.cmd** from the repository folder. If Node.js is available, it starts the local dashboard at **http://127.0.0.1:4173/** and opens your default browser. Keep the launcher window open while using that address. Press **Ctrl+C** to stop it. Without Node.js, the launcher opens the standalone dashboard file in your browser.

From a terminal on any system with Node.js, run `node serve-regchain.cjs` from the repository folder and open **http://127.0.0.1:4173/**. Use the same address and browser profile to keep saved review decisions and replay settings across sessions. File-mode browser storage varies by browser and is separate from localhost.

The prototype uses historical examples, fictional portfolio records and simulated roles. The configurable schedule replays sample checks while the dashboard is open.

- [Dashboard mockup](RegChain-AI-Dashboard-Mockup.png)
- [Research notes](RegChain-AI-Dashboard-Research.md)
- [Master specification](RegChain-AI-Master-Specification.md)
