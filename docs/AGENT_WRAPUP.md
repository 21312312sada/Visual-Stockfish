# Agent Wrap-up – Before Finishing

When you have completed your fix or feature and it has been tested, follow these steps to finalize.

## 1. Clean up debugging and logs

- Remove or disable any temporary debugging code.
- Minimize `console.log` / `console.debug` / `console.info`:
  - Delete temporary logs that were only for development.
  - Keep only essential, intentional logs (e.g. startup info, critical errors) where they add value.
- If you added a `DEBUG` flag, either remove it or ensure it is off by default and logs are gated.

## 2. Update the relevant docs

- **If you changed architecture or flow**: Update `docs/ARCHITECTURE.md`.
- **If you fixed a bug or introduced a new known issue**: Update `docs/COMMON_ISSUES.md`.
- **If you changed setup, features, or usage**: Update `README.md` or `running instructions` as needed.

Be concise; avoid unnecessary edits.

## 3. Git commit, merge, and push

Assume the work has already been tested. Then:

```bash
git add -A
git status
git commit -m "fix: short description"   # or "feat:", "docs:", "chore:" as appropriate
git checkout main
git merge fix/short-description          # or your branch name
git push
```

Use a clear commit message (e.g. `fix: Stockfish timeout on slow networks`). If your workflow uses different branches (e.g. `develop`), adjust the merge target accordingly.
