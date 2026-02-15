# Bootstrap + Onboard Flow Review

**Reviewed:** Bootstrap first-run ritual vs current onboard flow.

## Summary: **Works**

Bootstrap is correctly wired for the normal path: onboard → Brain step → hatch (TUI or Web UI). First-run message and ritual context show when expected.

---

## 1. Onboard Brain step (progress 3/6)

- **No `soul.md`** → create `soul.md`, `user.md`, `memory.md` → `seedBootstrapIfNeeded(ROOT)` → **BOOTSTRAP.md** created.
- **`soul.md` exists but soul not established and no BOOTSTRAP** → `seedBootstrapIfNeeded(ROOT)` → **BOOTSTRAP.md** created.

So after onboard, we always have **BOOTSTRAP.md** when the soul isn’t established.

---

## 2. Hatch into TUI (choice [1])

- `cmdTui()` runs.
- **Guard:** `if (!hasEstablishedSoul(ROOT) && !isBootstrapActive(ROOT)) seedBootstrapIfNeeded(ROOT)` so BOOTSTRAP is created if we’re in “first run” state but it was missing (e.g. ran `aetherclaw tui` without going through onboard).
- **Display:** `if (isFirstRun(ROOT))` → show “You: Wake up!” and “Aether-Claw: [bootstrap first message]”.
- **Agent:** `createReplyDispatcher` → `buildSystemPromptForRun` → `if (isFirstRun(root)) system += getBootstrapContext(root)` so the model gets BOOTSTRAP.md + user/soul/identity in system prompt.

Result: User sees the scripted exchange and the first reply uses the ritual instructions.

---

## 3. Hatch into Web UI (choice [2])

- Dashboard is spawned in a separate process; no `cmdTui()`.
- Dashboard `/status` uses `isFirstRun(ROOT)` and `getBootstrapFirstMessage()` → returns `first_run`, `bootstrap_first_message`.
- UI fetches `/status` and, when `first_run && history.length === 0 && bootstrap_first_message`, prepopulates chat with “Wake up!” + bootstrap message.

Result: Same first-run experience in the browser.

---

## 4. Hatch “Later” (choice [3])

- Onboard exits with “Run later: aetherclaw tui …”.
- When user later runs `aetherclaw tui`, the guard in `cmdTui()` ensures BOOTSTRAP exists if soul isn’t established, then `isFirstRun(ROOT)` is true and the bootstrap message is shown.

Result: Deferred hatch still gets bootstrap.

---

## 5. Conditions (personality.js)

- **isFirstRun(root)** = `isBootstrapActive(root) && !hasEstablishedSoul(root)`.
- **isBootstrapActive** = BOOTSTRAP.md exists.
- **hasEstablishedSoul** = soul.md exists and is beyond the default template.

So first run ends when either: user completes the ritual (BOOTSTRAP deleted) or soul is customized.

---

## 6. Edge case: TUI without ever running onboard

- User runs `aetherclaw tui` on a fresh clone (no onboard).
- Guard runs: no soul → `hasEstablishedSoul` false, no BOOTSTRAP → `isBootstrapActive` false → `seedBootstrapIfNeeded(ROOT)` runs.
- `getBrainDir(ROOT)` creates `brain/`; we write **BOOTSTRAP.md** only (soul/user not created here).
- `isFirstRun(ROOT)` = true → bootstrap message is shown.
- When they send a message, `getBootstrapContext(root)` will include `[missing: soul.md]` / `[missing: user.md]` for the ritual files. Acceptable; optional improvement is to create default soul/user in this path (e.g. same as onboard Brain step) so the ritual has all files.

---

## Conclusion

- **Onboard → TUI:** Bootstrap is created in Brain step; TUI shows first-run message and agent gets bootstrap context. **OK.**
- **Onboard → Web UI:** Same brain state; dashboard exposes first_run and bootstrap_first_message and UI prepopulates. **OK.**
- **Onboard → Later → tui:** Guard in `cmdTui()` seeds BOOTSTRAP when needed; first-run message and context apply. **OK.**
- **TUI without onboard:** BOOTSTRAP is seeded, message shows; ritual files may be missing in context until user runs onboard or we add a fallback. **Acceptable.**

No code changes required for the current onboard flow; bootstrap and first-run behavior are consistent.
