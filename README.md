# TrialReady · RegChain AI

RegChain AI is a browser prototype for country regulatory and clinical supply intelligence. Open a change from the regional overview to see evidence, study impact, regulatory review, and Quality follow-up in one case.

## Run locally

On Windows, open **Start-RegChain.cmd** from the repository folder. If Node.js is available, it starts the local dashboard at **http://127.0.0.1:4173/** and opens your default browser. Keep the launcher window open while using that address. Press **Ctrl+C** to stop it. Without Node.js, the launcher opens the standalone dashboard file in your browser.

From a terminal on any system with Node.js, run `node serve-regchain.cjs` from the repository folder and open **http://127.0.0.1:4173/**. Use the same address and browser profile to keep saved review decisions and replay settings across sessions. File-mode browser storage varies by browser and is separate from localhost.

The prototype uses historical examples, fictional portfolio records and simulated roles. The configurable schedule replays sample checks while the dashboard is open.

## AI step

The UK labeling case has a live AI check, at the top of its **Evidence & impact** tab. The local server fetches the official texts at run time: regulation 46 as in force on 27 April 2026 and from 28 April 2026 (legislation.gov.uk), Schedule 14 paragraph 6, and the MHRA guidance section on labelling transition (GOV.UK). Claude (`claude-opus-5-5`) drafts the change for `GB/IMP_LABELING`, and RegChain then checks the draft itself:

- every quote must appear word for word in the source it cites;
- the effective date must match the recorded rule (28 April 2026);
- the change status must agree with the text comparison.

If any check fails, Approve and Edit & approve are blocked for the Regulatory SME. The texts are never stored in the repository; the server keeps the last copy and the last result in `.regchain-cache/`, so a recorded check still shows without internet.

To turn it on:

1. Install Node.js 20.12 or later, which includes npm.
2. Create a file named `.env` next to `serve-regchain.cjs` containing `ANTHROPIC_API_KEY=` followed by your key. Git ignores this file.
3. Open **Start-RegChain.cmd**. The first time, it installs the Anthropic SDK with npm.

`npm run check:ai` tests the source fetching and RegChain's checks without calling the API.

- [Dashboard mockup](RegChain-AI-Dashboard-Mockup.png)
- [Research notes](RegChain-AI-Dashboard-Research.md)
- [Master specification](RegChain-AI-Master-Specification.md)
