# Agent Startup – Before You Begin

When starting a new task (bug fix, feature, refactor), follow these steps **before** implementing.

## 1. Set up a debugging tag

Add a consistent debug flag so you can conditionally log during development:

- Use an environment variable or a `DEBUG` constant at the top of the relevant files.
- Example: `const DEBUG = import.meta.env.DEV && true;` or `const DEBUG_TAG = 'visualstockfish:fen';`
- Guard any temporary logs with this flag, e.g. `if (DEBUG) console.log(...)`.

This keeps logs out of production and makes it easy to strip them later.

## 2. Create and checkout a git branch

Create a feature branch for your work:

```bash
git checkout -b fix/short-description
# or
git checkout -b feature/feature-name
```

Use a descriptive branch name. Work only on this branch until wrap-up.

## 3. Read the relevant docs

Read these documents **before** coding:

| Doc | When to read |
|-----|--------------|
| `docs/ARCHITECTURE.md` | Always – understand structure and data flow |
| `docs/COMMON_ISSUES.md` | For bugs – check known issues and fixes |
| `README.md` | Setup, features, and usage |
| `running instructions` | How to run and the two FEN/Stockfish flows |

For UI changes, also skim `src/routes/+page.svelte`. For Stockfish or chess logic, see `src/lib/stockfish-v2.ts` and `src/lib/chess.ts`. For camera/detection, see `src/lib/cameraChess/`.

## 4. Implement the fix or feature

- Make small, focused changes.
- Reuse existing patterns (e.g. Svelte 5 runes, error handling style).
- If you add logs for debugging, gate them with your DEBUG flag.

When done, run tests if available and manually verify behaviour. Then follow `docs/AGENT_WRAPUP.md` to finish.
